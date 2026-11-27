package com.sautilink.nativeapp.feature.videos

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.MainActivity
import com.sautilink.nativeapp.ui.components.NativeVideoStartupProbe
import com.sautilink.nativeapp.ui.components.NativeVideoStartupStage
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.Collections

class ShortsRevisitLiveProbe {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun nextBackReusesPlaybackAndEndingNeverChangesThePage() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("live_shorts_revisit")=="true")
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val events=Collections.synchronizedList(mutableListOf<Pair<String?,NativeVideoStartupStage>>())
        val seekRequests=Collections.synchronizedList(mutableListOf<Long>())
        val previousSeek=NativeShortsSession.seekObserver
        NativeShortsSession.seekObserver={seekRequests.add(it)}
        val details=Collections.synchronizedList(mutableListOf<String>())
        val previous=NativeVideoStartupProbe.observer
        NativeVideoStartupProbe.observer={
            events+=it.mediaId to it.stage
            details+="${it.stage}:${it.request}:status=${it.status}:bytes=${it.bytes}"
        }
        var activity:MainActivity?=null
        fun views(v:View):List<PlayerView> = buildList {
            if(v is PlayerView)add(v)
            if(v is ViewGroup)for(i in 0 until v.childCount)addAll(views(v.getChildAt(i)))
        }
        var player:Player?=null
        fun current():Pair<String,Long>? {
            var result:Pair<String,Long>?=null
            instrumentation.runOnMainSync {
                player=views(activity!!.window.decorView).firstNotNullOfOrNull {it.player?.takeIf {p->p.isPlaying}}
                player?.let {result=it.currentMediaItem!!.mediaId to it.currentPosition}
            }
            return result
        }
        fun descriptorCount(id:String)=synchronized(events) {events.count {it.first==id && it.second==NativeVideoStartupStage.DESCRIPTOR_BEGIN}}
        try {
            activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://sautilink.com/videos"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            compose.waitUntil(40_000) {current()!=null}
            val first=requireNotNull(current()).first
            val originalPlayer=player
            compose.waitUntil(25_000) {current()?.let {it.first==first && it.second>2000}==true}
            val position=requireNotNull(current()).second
            val descriptors=descriptorCount(first)
            compose.onNodeWithTag("shorts-pager").performTouchInput {swipeUp(durationMillis=450)}
            compose.waitUntil(30_000) {current()?.first?.let {it!=first}==true}
            assertSame(originalPlayer,player)
            SystemClock.sleep(1000)
            compose.onNodeWithTag("shorts-pager").performTouchInput {swipeDown(durationMillis=450)}
            compose.waitUntil(30_000) {current()?.first==first}
            assertSame(originalPlayer,player)
            assertTrue("Return should retain the viewed position",current()!!.second>=position-700)
            assertEquals("A healthy next/back must not request the descriptor again",descriptors,descriptorCount(first))
            var duration=0L
            instrumentation.runOnMainSync {duration=player!!.duration;assertEquals(Player.REPEAT_MODE_ONE,player!!.repeatMode);player!!.seekTo((duration-400).coerceAtLeast(0))}
            compose.waitUntil(30_000) {current()?.let {it.first==first && it.second<duration-1000}==true}
            assertEquals("Finishing a clip must not advance the pager",first,current()?.first)
            val timeline=compose.onNodeWithContentDescription("Video progress")
            timeline.performTouchInput {down(androidx.compose.ui.geometry.Offset(width*.3f,height/2f));moveTo(androidx.compose.ui.geometry.Offset(width*.4f,height/2f),delayMillis=80);moveTo(androidx.compose.ui.geometry.Offset(width*.7f,height/2f),delayMillis=220)}
            var previewPosition=0L;var previewPlaying=true
            // Compose delay/animation work uses the test clock while a finger is held.
            compose.mainClock.advanceTimeBy(500)
            compose.waitForIdle()
            SystemClock.sleep(200)
            instrumentation.runOnMainSync {previewPosition=originalPlayer!!.currentPosition;previewPlaying=originalPlayer.playWhenReady}
            assertFalse("Scrubbing should pause the decoder until release",previewPlaying)
            val progressLabel=timeline.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription]
            instrumentation.sendStatus(0,Bundle().apply {putString("scrubProbe","label=$progressLabel position=$previewPosition duration=$duration seeks=$seekRequests")})
            assertTrue("Dragging should preview the selected position: $progressLabel actual=$previewPosition duration=$duration seeks=$seekRequests",previewPosition>duration/2)
            timeline.performTouchInput {up()}
            compose.waitUntil(30_000) {current()?.first==first}
            instrumentation.sendStatus(0,Bundle().apply {putString("shortsRevisit","samePlayer=pass position=pass descriptorRequestsOnReturn=0 manualPaging=pass loop=pass liveScrubPreview=pass resumeAfterSeek=pass")})
        } finally {
            instrumentation.runOnMainSync {
                val status=activity?.let {views(it.window.decorView).mapNotNull {view ->view.player?.let {p ->
                    "state=${p.playbackState} playing=${p.isPlaying} requested=${p.playWhenReady} suppression=${p.playbackSuppressionReason} pos=${p.currentPosition} buffered=${p.totalBufferedDuration} duration=${p.duration} error=${p.playerError?.errorCode}"
                }}}.orEmpty()
                instrumentation.sendStatus(0,Bundle().apply {putString("playbackProbe",status.joinToString(" | "))})
            }
            instrumentation.sendStatus(0,Bundle().apply {putString("startupProbe",synchronized(details) {details.takeLast(14).joinToString(" | ")})})
            NativeShortsSession.seekObserver=previousSeek
            NativeVideoStartupProbe.observer=previous
            instrumentation.runOnMainSync {activity?.finish()}
        }
    }
}
