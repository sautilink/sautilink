package com.sautilink.nativeapp.feature.videos

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.MainActivity
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

class HomeShortsInteractionLiveProbe {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun tappedVideoContinuesAndActionsRespondBeforeServerThenRestore() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("live_home_shorts")=="true")
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val session=AtomicReference<NativeShortsSession?>()
        val previous=NativeShortsSession.testObserver
        NativeShortsSession.testObserver={session.set(it)}
        var activity:MainActivity?=null
        val startup=java.util.concurrent.CopyOnWriteArrayList<com.sautilink.nativeapp.ui.components.NativeVideoStartupEvent>()
        val oldStartup=com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.observer
        com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.observer={startup+=it}

        fun players(view:View):List<PlayerView> = buildList {
            if(view is PlayerView)add(view)
            if(view is ViewGroup)for(i in 0 until view.childCount)addAll(players(view.getChildAt(i)))
        }
        fun position(media:String?=null):Pair<String,Long>? {
            var value:Pair<String,Long>?=null
            instrumentation.runOnMainSync {
                players(activity!!.window.decorView).firstNotNullOfOrNull { it.player?.takeIf {p ->
                    p.isPlaying && (media==null || p.currentMediaItem?.mediaId==media)
                } }?.let { value=it.currentMediaItem!!.mediaId to it.currentPosition }
            }
            return value
        }
        val originals=mutableMapOf<String,Boolean>()
        var post:String?=null
        try {
            activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://sautilink.com/home"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            compose.waitUntil(25_000) {session.get()!=null}
            // The live feed can begin with photos/text; find a genuinely playing inline video.
            repeat(8) {
                if(position()==null) {
                    try {compose.waitUntil(7_000) {position()!=null}} catch(_:ComposeTimeoutException) { }
                    if(position()==null) compose.onAllNodes(hasScrollAction() and
                        SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)).onFirst()
                        .performTouchInput {swipeUp(startY=height*.76f,endY=height*.28f,durationMillis=400)}
                }
            }
            compose.waitUntil(20_000) {position()!=null}
            SystemClock.sleep(1000)
            val home=requireNotNull(position())
            var originalPlayer:androidx.media3.common.Player?=null
            var homeViewWidth=0; var homeViewHeight=0; var homeResizeMode=0
            instrumentation.runOnMainSync {
                val view=players(activity!!.window.decorView).first {it.player?.isPlaying==true}
                originalPlayer=view.player
                homeViewWidth=view.width;homeViewHeight=view.height;homeResizeMode=view.resizeMode
            }
            startup.clear()
            val handoffStart=SystemClock.elapsedRealtime()
            val handoffNanos=System.nanoTime()
            compose.onNodeWithTag("open-shorts:${home.first}").performClick()
            compose.waitUntil(30_000) {
                position(home.first)!=null && compose.onAllNodes(hasContentDescription("Video options")).fetchSemanticsNodes().isNotEmpty()
            }
            val viewer=requireNotNull(position(home.first))
            if(InstrumentationRegistry.getArguments().getString("require_player_handoff")=="true")
                compose.waitUntil(3_000) {startup.any {it.mediaId==home.first && it.stage==com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.FIRST_FRAME}}
            val handoffMs=SystemClock.elapsedRealtime()-handoffStart
            var retainedPlayer=false
            instrumentation.runOnMainSync {retainedPlayer=players(activity!!.window.decorView).any {it.player===originalPlayer}}
            val handoffDescriptors=startup.count {it.mediaId==home.first && it.stage==com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.DESCRIPTOR_BEGIN}
            val stages=startup.filter {it.mediaId==home.first && (it.stage.name.startsWith("HANDOFF") || it.stage.name.startsWith("SURFACE") || it.stage.name=="FIRST_FRAME" || it.stage.name=="SOURCE_PREPARE")}
                .joinToString {"${it.stage}=${(it.elapsedNanos-handoffNanos)/1_000_000}ms"}
            val actualTap=startup.firstOrNull {it.mediaId==home.first && it.stage.name=="HANDOFF_TAP"}?.elapsedNanos ?: handoffNanos
            val actualFrame=startup.firstOrNull {it.mediaId==home.first && it.stage.name=="FIRST_FRAME"}?.elapsedNanos
            val frameMs=actualFrame?.let {(it-actualTap)/1_000_000} ?: handoffMs
            instrumentation.sendStatus(0,Bundle().apply {putString("handoffTiming","frameMs=$frameMs automationMs=$handoffMs samePlayer=$retainedPlayer descriptorRequests=$handoffDescriptors stages=[$stages]")})

            if(InstrumentationRegistry.getArguments().getString("require_player_handoff")=="true") {
                assertTrue("Home's prepared player must be transferred",retainedPlayer)
                assertEquals("Warm entry must not request another descriptor",0,handoffDescriptors)
                // Keep the historical default; comparison runs can supply a
                // device budget calibrated against the unchanged 4:5 control.
                val budget=InstrumentationRegistry.getArguments().getString("handoff_budget_ms")
                    ?.toLongOrNull()?.coerceIn(500L,3000L) ?: 1500L
                assertTrue("Warm entry first frame took ${frameMs}ms (budget ${budget}ms)",frameMs<budget)
                compose.waitUntil(3_000) {startup.any {it.mediaId==home.first && it.stage==com.sautilink.nativeapp.ui.components.NativeVideoStartupStage.FIRST_FRAME}}
            }
            assertTrue("Viewer must resume, not restart the video: Home=${home.second} viewer=${viewer.second}",viewer.second>=home.second-600)
            val active=requireNotNull(session.get());val entry=requireNotNull(active.entry)
            assertEquals(home.first,entry.mediaId)
            if(InstrumentationRegistry.getArguments().getString("home_video_frame")=="true") {
                val media=entry.posts.flatMap {it.media}.first {it.id==home.first}
                val expected=com.sautilink.nativeapp.feature.home.homeFeedVideoFrame(media.width,media.height)
                assertEquals("Inline video must keep its full-width Home frame",expected.aspectRatio,
                    homeViewWidth.toFloat()/homeViewHeight,.01f)
                assertEquals("Only over-tall Home videos should crop",if(expected.crop)
                    androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM else
                    androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT,homeResizeMode)
                instrumentation.sendStatus(0,Bundle().apply {putString("homeVideoFrame",
                    "source=${media.width}x${media.height} frame=${homeViewWidth}x${homeViewHeight} crop=${expected.crop}")})
            }
            assertNotNull("A decoded Home frame should cover the handoff",entry.poster)
            post=entry.posts.first {p->p.media.any {it.id==home.first}}.id
            val counts=entry.posts.first {it.id==post}
            val timings=mutableListOf<String>()
            for(kind in listOf("like","repost","save")) {
                compose.waitUntil(25_000) {active.actions.state(post!!,kind)?.confirmed!=null}
                val original=active.actions.state(post!!,kind)!!.confirmed!!
                originals[kind]=original
                val label=when(kind){"like"->if(original)"Unlike" else "Like";"save"->if(original)"Unsave" else "Save";else->if(original)"Undo repost" else "Repost"}
                val began=SystemClock.elapsedRealtime()
                compose.onNodeWithContentDescription(label).performClick()
                assertEquals("Local feedback must not wait for server",!original,active.actions.state(post!!,kind)?.desired)
                timings+="$kind=${SystemClock.elapsedRealtime()-began}ms"
                compose.waitUntil(25_000) {active.actions.state(post!!,kind)?.let {!it.pending && !it.uncertain && it.confirmed==!original}==true}
                assertNotNull("Reactions must keep playback running",position(home.first))
                instrumentation.runOnMainSync {active.actions.request(post!!,kind,original,if(kind=="like")counts.likes else counts.reposts,original)}
                compose.waitUntil(25_000) {active.actions.state(post!!,kind)?.let {!it.pending && !it.uncertain && it.confirmed==original}==true}
            }
            // Exercise the actual viewer gesture while the first Like may still be pending.
            instrumentation.runOnMainSync {active.actions.request(post!!,"like",false,counts.likes,originals["like"])}
            compose.waitUntil(25_000) {active.actions.state(post!!,"like")?.let {!it.pending && !it.uncertain && it.confirmed==false}==true}
            val gesture=compose.onNode(SemanticsMatcher("Video Like gesture") {node ->
                node.config.getOrNull(SemanticsActions.CustomActions)?.any {it.label=="Like post"}==true
            })
            val gestureActions=gesture.fetchSemanticsNode().config[SemanticsActions.CustomActions]
            compose.runOnIdle {repeat(3) {assertTrue(gestureActions.first {it.label=="Like post"}.action())}}

            assertEquals(true,active.actions.state(post!!,"like")?.desired)
            compose.waitUntil(25_000) {active.actions.state(post!!,"like")?.let {!it.pending && !it.uncertain && it.confirmed==true}==true}
            instrumentation.runOnMainSync {active.actions.request(post!!,"like",originals.getValue("like"),counts.likes,originals["like"])}
            compose.waitUntil(25_000) {active.actions.state(post!!,"like")?.let {!it.pending && !it.uncertain && it.confirmed==originals["like"]}==true}
            instrumentation.sendStatus(0,Bundle().apply {putString("homeShorts","sameMedia=pass resume=pass frameCover=pass ${timings.joinToString(" ")} confirmedAndRestored=pass additiveDoubleTap=pass")})
            if(InstrumentationRegistry.getArguments().getString("handoff_swipe")=="true") {
                val beforeSwipe=requireNotNull(position(home.first)).second
                compose.onNodeWithTag("shorts-pager").performTouchInput {swipeUp(durationMillis=450)}
                compose.waitUntil(30_000) {position()?.first?.let {it!=home.first}==true}
                assertTrue("Swipe must retire the donated player",entry.playback?.closed==true)
                compose.onNodeWithTag("shorts-pager").performTouchInput {swipeDown(durationMillis=450)}
                compose.waitUntil(30_000) {position(home.first)!=null}
                assertTrue("Returning must keep the donated player's last position",requireNotNull(position(home.first)).second>=beforeSwipe-600)
                instrumentation.sendStatus(0,Bundle().apply {putString("handoffSwipe","next=pass returnPosition=pass donatedRetired=pass")})
            }
            instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            compose.waitUntil(30_000) {position(home.first)!=null && compose.onAllNodes(hasContentDescription("Video options")).fetchSemanticsNodes().isEmpty()}
            compose.onNodeWithTag("open-shorts:${home.first}").assertExists()
            if(InstrumentationRegistry.getArguments().getString("require_player_handoff")=="true")
                assertTrue("The transferred player must retire on exit",entry.playback?.closed==true)
        } finally {
            session.get()?.let {active ->post?.let {id -> originals.forEach { (kind,value) ->
                if(active.actions.state(id,kind)?.let {it.confirmed!=value || it.desired!=value || it.uncertain}==true) {
                    instrumentation.runOnMainSync {active.actions.request(id,kind,value,0,value)}
                    compose.waitUntil(25_000) {active.actions.state(id,kind)?.let {!it.pending && !it.uncertain && it.confirmed==value}==true}
                }
            } } }
            NativeShortsSession.testObserver=previous
            com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe.observer=oldStartup
            instrumentation.runOnMainSync {activity?.finish()}
        }
    }
}
