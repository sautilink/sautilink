package com.sautilink.nativeapp.validation

import com.sautilink.nativeapp.feature.notifications.nativePushCopy
import com.sautilink.nativeapp.feature.safety.NativeAppealRules

/** Offline checks against the production display/input rules; no FCM sends or API writes. */
fun main() {
    val activity = nativePushCopy(mapOf("title" to "SautiLink activity", "body" to "Someone liked your post."), null, null)
    check(activity.title == "SautiLink activity" && activity.body == "Someone liked your post.")
    val normal = nativePushCopy(mapOf("title" to "Data title", "body" to "Data body"), "Notification title", "Notification body")
    check(normal.title == "Notification title" && normal.body == "Notification body")
    val blank = nativePushCopy(emptyMap(), "  ", null)
    check(blank.title == "SautiLink" && blank.body == "New activity on SautiLink.")
    for (body in listOf(null, "Server message text")) {
        val private = nativePushCopy(mapOf("type" to "message", "body" to "Private message text"), "New message", body)
        check(private.body == "You have a new message.")
    }
    val bounded = nativePushCopy(mapOf("title" to "a".repeat(200), "body" to "b".repeat(300)), null, null)
    check(bounded.title.length == 90 && bounded.body.length == 180)

    for (id in listOf("1", "1234567890123456789")) check(NativeAppealRules.validActionId(id))
    for (id in listOf("", "0", "01", "-1", "1.1", "1/other", "12345678901234567890")) {
        check(!NativeAppealRules.validActionId(id))
    }
    check(NativeAppealRules.reasonError("  ") != null)
    check(NativeAppealRules.reasonError("a".repeat(2001)) != null)
    check(NativeAppealRules.reasonError("  Please review this decision.  ") == null)
    check(NativeAppealRules.reasonError("a".repeat(2000)) == null)
    check(NativeAppealRules.decisionLabel("content_removed") == "Content removed")
    check(NativeAppealRules.statusLabel("open") == "Awaiting review")
    check(NativeAppealRules.statusLabel("reviewing") == "Under review")
    check(NativeAppealRules.statusLabel("upheld") == "Upheld")
    check(NativeAppealRules.statusLabel("reversed") == "Reversed")
    println("NATIVE_NOTIFICATION_APPEALS_RULES_PASS")
}
