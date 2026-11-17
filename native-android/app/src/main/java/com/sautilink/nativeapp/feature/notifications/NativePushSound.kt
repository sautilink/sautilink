package com.sautilink.nativeapp.feature.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.annotation.RawRes
import com.sautilink.nativeapp.R

internal enum class NativePushSound(
    val channelId: String,
    val channelName: String,
    val description: String,
    @RawRes val resource: Int
) {
    ACTIVITY("sautilink_activity_v1", "SautiLink activity",
        "Likes, replies, followers and other SautiLink updates", R.raw.sautilink_activity),
    MESSAGE("sautilink_messages_v1", "SautiLink messages",
        "New direct messages", R.raw.sautilink_message);

    fun uri(context: Context): Uri =
        Uri.Builder().scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
            .authority(context.packageName).appendPath("raw")
            .appendPath(context.resources.getResourceEntryName(resource)).build()

    companion object {
        fun forType(type: String?): NativePushSound = if (type == "message") MESSAGE else ACTIVITY
    }
}

internal fun createNativePushChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    val legacy = manager.getNotificationChannel("sautilink_updates")
    val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    val hasLegacySoundChoice = legacy != null && (
        (Build.VERSION.SDK_INT >= 30 && legacy.hasUserSetSound()) ||
            legacy.sound != Settings.System.DEFAULT_NOTIFICATION_URI
    )
    for (tone in NativePushSound.entries) {
        if (manager.getNotificationChannel(tone.channelId) != null) continue
        manager.createNotificationChannel(NotificationChannel(tone.channelId, tone.channelName,
            legacy?.importance ?: NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = tone.description
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            if (legacy != null) {
                enableVibration(legacy.shouldVibrate())
                setShowBadge(legacy.canShowBadge())
            }
            // Carry explicit sound and mute choices forward on upgrade. New defaults use SautiLink tones.
            setSound(if (hasLegacySoundChoice) legacy?.sound else tone.uri(context),
                if (hasLegacySoundChoice) legacy?.audioAttributes ?: attrs else attrs)
        })
    }
}
