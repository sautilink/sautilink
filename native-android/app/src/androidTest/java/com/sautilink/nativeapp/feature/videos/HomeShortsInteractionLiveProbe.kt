package com.sautilink.nativeapp.feature.videos

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
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
                .setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://sautilink.com"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            compose.waitUntil(45_000) {position()!=null}
            SystemClock.sleep(1800)
            val home=requireNotNull(position())
            compose.onNodeWithTag("open-shorts:${home.first}").performClick()
            compose.waitUntil(30_000) {
                position(home.first)!=null && compose.onAllNodes(hasContentDescription("Video options")).fetchSemanticsNodes().isNotEmpty()
            }
            val viewer=requireNotNull(position(home.first))
            assertTrue("Viewer must resume, not restart the video: Home=${home.second} viewer=${viewer.second}",viewer.second>=home.second-600)
            val active=requireNotNull(session.get());val entry=requireNotNull(active.entry)
            assertEquals(home.first,entry.mediaId)
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
            instrumentation.sendStatus(0,Bundle().apply {putString("homeShorts","sameMedia=pass resume=pass frameCover=pass ${timings.joinToString(" ")} confirmedAndRestored=pass")})
            instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            compose.waitUntil(30_000) {position(home.first)!=null && compose.onAllNodes(hasContentDescription("Video options")).fetchSemanticsNodes().isEmpty()}
            compose.onNodeWithTag("open-shorts:${home.first}").assertExists()
        } finally {
            session.get()?.let {active ->post?.let {id -> originals.forEach { (kind,value) ->
                if(active.actions.state(id,kind)?.let {it.confirmed!=value || it.desired!=value || it.uncertain}==true) {
                    instrumentation.runOnMainSync {active.actions.request(id,kind,value,0,value)}
                    compose.waitUntil(25_000) {active.actions.state(id,kind)?.let {!it.pending && !it.uncertain && it.confirmed==value}==true}
                }
            } } }
            NativeShortsSession.testObserver=previous
            instrumentation.runOnMainSync {activity?.finish()}
        }
    }
}
