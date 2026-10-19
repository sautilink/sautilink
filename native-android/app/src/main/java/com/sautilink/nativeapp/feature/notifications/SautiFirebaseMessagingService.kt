package com.sautilink.nativeapp.feature.notifications

import android.app.PendingIntent
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sautilink.nativeapp.MainActivity
import com.sautilink.nativeapp.R

class SautiFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        NativePushManager.onNewToken(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (!NativePushManager.permissionGranted(this)) return
        NativePushManager.createChannel(this)
        val route = NativePushManager.safeRoute(message.data["route"]) ?: "/notifications"
        val copy = nativePushCopy(message.data, message.notification?.title, message.notification?.body)
        val intent = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_PUSH_ROUTE, route)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val id = (System.currentTimeMillis() and 0x7fffffff).toInt()
        val pending = PendingIntent.getActivity(this, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, NativePushManager.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sautilink)
            .setContentTitle(copy.title).setContentText(copy.body)
            .setContentIntent(pending).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            NotificationManagerCompat.from(this).notify(id, notification)
        } catch (_: SecurityException) {
            // Permission can be revoked between the check and posting the notification.
        }
    }
}
