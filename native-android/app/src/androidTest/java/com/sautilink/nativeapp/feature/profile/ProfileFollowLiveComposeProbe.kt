package com.sautilink.nativeapp.feature.profile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.MainActivity
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.Collections

/** Explicit opt-in only, official SautiLink account only. Restores initial state. */
class ProfileFollowLiveComposeProbe {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun confirmedFollowLeavesTheProfileAndPublicFeedMounted() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("live_profile_follow")=="true")
        val reads=Collections.synchronizedList(mutableListOf<String>())
        val previous=ProfileContentReadProbe.observer
        ProfileContentReadProbe.observer={ reads.add(it) }
        fun button(label:String)=hasText(label) and hasClickAction() and isEnabled()
        fun present(label:String)=compose.onAllNodes(button(label)).fetchSemanticsNodes().isNotEmpty()
        fun await(label:String) { compose.waitUntil(25_000) { present(label) } }
        var original:String?=null;var changed=false
        var activity:MainActivity?=null
        try {
            activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://sautilink.com/u/sautilink"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            compose.waitUntil(30_000) { present("Follow") || present("Following") }
            // Initial profile activity is independent of the header read. Never
            // miscount its first delayed load as a reload caused by Follow.
            compose.waitUntil(30_000) { synchronized(reads) { "activity-ready" in reads } }
            original=if(present("Follow"))"Follow" else "Following"
            SystemClock.sleep(1500)
            val baseline=reads.size
            compose.onNode(button(original!!)).performClick();changed=true
            val next=if(original=="Follow")"Following" else "Follow"
            await(next)
            SystemClock.sleep(1500)
            val extra=synchronized(reads) { reads.drop(baseline).filter { it=="profile" || it.startsWith("content:") } }
            instrumentation.sendStatus(0,Bundle().apply { putString("profileFollow",
                "profileReloads=${extra.count { it=="profile" }} contentReloads=${extra.count { it.startsWith("content:") }}") })
            assertEquals("Following must not reload profile or public posts",emptyList<String>(),extra)
        } finally {
            try {
                if(changed && original!=null) {
                    val next=if(original=="Follow")"Following" else "Follow"
                    await(next);compose.onNode(button(next)).performClick();await(original!!)
                }
            } finally {
                ProfileContentReadProbe.observer=previous
                instrumentation.runOnMainSync { activity?.finish() }
            }
        }
    }
}
