package com.sautilink.nativeapp.feature.videos

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.MainActivity
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Opt-in integration check. Uses the existing Preview session, never submits social actions. */
class ShortsLiveComposeProbe {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun livePlayerOptionsNavigationAndOfflineDownloadWorkTogether() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("live_shorts")=="true")
        val context=instrumentation.targetContext
        var activity:MainActivity?=null
        fun exists(matcher:SemanticsMatcher)=compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
        fun await(matcher:SemanticsMatcher) { compose.waitUntil(30_000) { exists(matcher) } }
        fun clickText(text:String) { val matcher=hasText(text) and hasClickAction();await(matcher);compose.onNode(matcher).performClick() }
        fun options() { val matcher=hasContentDescription("Video options");await(matcher);compose.onNode(matcher).performClick();await(hasText("Go to Post")) }
        fun back() { instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);compose.waitForIdle() }
        try {
            activity=instrumentation.startActivitySync(Intent(context,MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("https://sautilink.com/videos"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            await(hasContentDescription("Pause video"))
            options();clickText("1.5x");back()
            await(hasText("1.5x"))
            options();clickText("1x")
            clickText("Quality");await(hasText("Highest available"));clickText("Auto")
            back()
            compose.onNodeWithContentDescription("Fullscreen").performClick()
            await(hasContentDescription("Exit fullscreen"))
            compose.onNodeWithContentDescription("Exit fullscreen").performClick()
            await(hasContentDescription("Fullscreen"))
            options();clickText("Go to Post")
            await(hasText("Post",substring=false))
            back();await(hasContentDescription("Video options"))
            options()
            if(exists(hasText("Add to Offline"))) clickText("Add to Offline") else clickText("Watch offline")
            await(hasText("Offline videos"))
            val root=File(context.filesDir,"offline-shorts")
            fun saved()=root.listFiles().orEmpty().flatMap { folder ->
                runCatching { NativeOfflineShorts.list(context,folder.name) }.getOrDefault(emptyList())
            }
            val deadline=SystemClock.elapsedRealtime()+120_000
            var item=saved().firstOrNull()
            while(item==null && SystemClock.elapsedRealtime()<deadline) { SystemClock.sleep(500);item=saved().firstOrNull() }
            val local=requireNotNull(item) { "Offline download did not produce a verified local video" }
            var player:ExoPlayer?=null
            try {
                instrumentation.runOnMainSync {
                    player=ExoPlayer.Builder(context).build().apply {
                        volume=0f;setMediaItem(MediaItem.fromUri(Uri.fromFile(local.file)));prepare();playWhenReady=true
                    }
                }
                var decoded=false
                val decodeDeadline=SystemClock.elapsedRealtime()+20_000
                while(!decoded && SystemClock.elapsedRealtime()<decodeDeadline) {
                    SystemClock.sleep(250)
                    instrumentation.runOnMainSync { decoded=player?.let { it.currentPosition>250 && it.duration>0 && it.playerError==null }==true }
                }
                assertTrue("Saved video must decode directly from its local file",decoded)
                instrumentation.sendStatus(0,Bundle().apply { putString("shortsLive","speed=pass quality=pass fullscreen=pass postNavigation=pass offlineDownload=pass localPlayback=pass") })
            } finally { instrumentation.runOnMainSync { player?.release() } }
            compose.waitUntil(10_000) { exists(hasText("Saved video")) }
            compose.onAllNodes(hasText("Saved video") and hasClickAction()).onFirst().performClick()
            SystemClock.sleep(1000)
            back();back()
        } finally { instrumentation.runOnMainSync { activity?.finish() } }
    }
}
