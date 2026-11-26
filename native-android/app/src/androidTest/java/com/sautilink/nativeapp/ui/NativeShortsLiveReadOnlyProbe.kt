package com.sautilink.nativeapp.ui

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.MainActivity
import com.sautilink.nativeapp.ui.components.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.Collections

/** Explicit operator opt-in only. Uses the already signed-in Preview session;
 * navigation/playback only, never taps any social action or opens account data. */
class NativeShortsLiveReadOnlyProbe {
    @Test fun measureFourReadOnlyShortsHandoffs() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("live_read_only") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val events = Collections.synchronizedList(mutableListOf<NativeVideoStartupEvent>())
        val old = NativeVideoStartupProbe.observer
        NativeVideoStartupProbe.observer = { events.add(it) }
        fun snapshot() = synchronized(events) { events.toList() }
        fun shell(command: String) { instrumentation.uiAutomation.executeShellCommand(command).use {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes()
        } }
        fun find(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
            if (node == null) return null
            if (node.contentDescription?.toString() == "Short Videos") return node
            for (index in 0 until node.childCount) find(node.getChild(index))?.let { return it }
            return null
        }
        try {
            instrumentation.targetContext.startActivity(Intent(instrumentation.targetContext, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val deadline = SystemClock.elapsedRealtime() + 20000
            var target: AccessibilityNodeInfo? = null
            while (target == null && SystemClock.elapsedRealtime() < deadline) {
                target = find(instrumentation.uiAutomation.rootInActiveWindow)
                if (target == null) SystemClock.sleep(200)
            }
            var clickable = requireNotNull(target) { "Preview home navigation was unavailable" }
            while (!clickable.isClickable && clickable.parent != null) clickable = clickable.parent
            assertTrue(clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            var previousId: String? = null
            for (page in 0..4) {
                val started = SystemClock.elapsedRealtime()
                val stageStart = snapshot().size
                if (page > 0) {
                    val metrics = instrumentation.targetContext.resources.displayMetrics
                    val x = metrics.widthPixels / 2
                    shell("input swipe $x ${metrics.heightPixels * 7 / 10} $x ${metrics.heightPixels / 10} 350")
                }
                val expiry = started + 30000
                var frame: NativeVideoStartupEvent? = null
                while (frame == null && SystemClock.elapsedRealtime() < expiry) {
                    frame = snapshot().drop(stageStart).firstOrNull {
                        it.stage == NativeVideoStartupStage.FIRST_FRAME && it.mediaId != previousId }
                    if (frame == null) SystemClock.sleep(100)
                }
                val elapsed = SystemClock.elapsedRealtime()-started
                val recent = snapshot().drop(stageStart)
                val requests = recent.filter { it.stage == NativeVideoStartupStage.HTTP_BEGIN }.groupingBy { it.request }.eachCount()
                instrumentation.sendStatus(0, Bundle().apply { putString("shortsReadOnly",
                    "page=$page firstFrameMs=$elapsed ready=${frame != null} requestTypes=$requests descriptorBegins=${recent.count { it.stage == NativeVideoStartupStage.DESCRIPTOR_BEGIN }}") })
                instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
                    java.io.File(instrumentation.targetContext.cacheDir, "shorts-probe-page-$page.png").outputStream().use {
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
                    }
                    bitmap.recycle()
                }
                assertNotNull("Short $page did not render within 30 seconds", frame)
                previousId = frame?.mediaId
                SystemClock.sleep(6000)
            }
        } finally { NativeVideoStartupProbe.observer = old }
    }
}
