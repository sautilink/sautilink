package com.sautilink.nativeapp.feature.videos

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.SystemClock
import android.provider.MediaStore
import android.view.View
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.sautilink.nativeapp.MainActivity
import com.sautilink.nativeapp.R
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.TimeUnit

/** User-started, non-exported, non-restoring download. No auth material is put
 * into an Intent, notification, file, saved state or log. The old auth owner must
 * remain current before/after every 64 KiB read and before final publication.
 */
class NativeShortVideoDownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var ticket: NativeShortVideoDownloadTicket? = null
    private var work: Job? = null
    private var foreground = false
    private var lastStartId = 0
    private val manager get() = getSystemService(NotificationManager::class.java)

    override fun onCreate() {
        super.onCreate()
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Video downloads", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Progress of videos you choose to save"
            setSound(null, null); enableVibration(false); enableLights(false)
        })
        promoteForeground()
    }

    private fun promoteForeground(): Boolean = try {
        val notification = notification("Preparing download", 0, true)
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(NOTIFICATION, notification)
        foreground = true
        true
    } catch (_: Exception) { false }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        if (intent?.action == ACTION_CANCEL) {
            ticket?.cancel()
            if (work == null) { foreground = false; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(startId) }
            return START_NOT_STICKY
        }
        val selected = NativeShortVideoDownloads.find(intent?.getStringExtra(EXTRA_TICKET))
        if (intent?.action != ACTION_START || selected == null || !selected.active()) {
            selected?.let { it.cancel(); NativeShortVideoDownloads.release(it) }
            if (work == null) { foreground = false; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(startId) }
            return START_NOT_STICKY
        }
        if (work != null) {
            if (selected !== ticket) { selected.cancel(); NativeShortVideoDownloads.release(selected) }
            return START_NOT_STICKY
        }
        if (!foreground && !promoteForeground()) {
            selected.cancel(); NativeShortVideoDownloads.release(selected); stopSelf(startId)
            return START_NOT_STICKY
        }
        ticket = selected
        work = scope.launch { download(selected) }
        return START_NOT_STICKY
    }

    private suspend fun download(selected: NativeShortVideoDownloadTicket) {
        val ownerWatch = scope.launch {
            while (isActive) {
                if (!selected.active()) { selected.cancel(); break }
                delay(250)
            }
        }
        var target: PendingVideo? = null
        var complete = false
        var saved: Uri? = null
        try {
            val url = nativeShortVideoDownloadUrl(selected.auth.mediaOrigin, selected.mediaId)
            suspend fun request(method: String, etag: String? = null): okhttp3.Response {
                ensureCurrent(selected)
                val bearer = selected.auth.accessTokenForStagingRead()
                ensureCurrent(selected)
                val builder = Request.Builder().url(url).header("Authorization", "Bearer $bearer")
                    .header("Cache-Control", "no-store").method(method, null)
                if (etag != null) builder.header("If-Match", etag)
                val call = client.newCall(builder.build())
                selected.cancelNetwork = { call.cancel() }
                if (!selected.active()) { call.cancel(); throw IOException("Download cancelled") }
                return call.execute()
            }
            val metadata = request("HEAD").use { response ->
                ensureCurrent(selected)
                nativeShortVideoDownloadMetadata(response.code, response.header("Content-Type"),
                    response.header("Content-Length"), response.header("ETag"))
            }
            request("GET", metadata.etag).use { response ->
                val actual = nativeShortVideoDownloadMetadata(response.code, response.header("Content-Type"),
                    response.header("Content-Length"), response.header("ETag"))
                if (actual != metadata) throw IOException("Video version changed")
                ensureCurrent(selected)
                val body = response.body ?: throw IOException("Missing video")
                target = createPendingVideo(selected)
                val output = checkNotNull(target).output
                var notifiedAt = 0L
                output.use {
                    copyNativeShortVideoDownload(body.byteStream(), output, metadata.bytes, selected::active) { bytes ->
                        val now = SystemClock.elapsedRealtime()
                        if (now - notifiedAt >= 500 || bytes == metadata.bytes) {
                            notifiedAt = now
                            val percent = (bytes * 100 / metadata.bytes).toInt().coerceIn(0, 100)
                            notifyProgress(notification("$percent% · ${sizeLabel(bytes)} / ${sizeLabel(metadata.bytes)}", percent, false))
                        }
                    }
                }
                ensureCurrent(selected)
                saved = checkNotNull(target).publish(selected::active)
                ensureCurrent(selected)
                complete = true
            }
        } catch (_: Exception) {
            // Fixed user-facing status below; transport exception text may carry
            // request details and is deliberately never logged or displayed.
        } finally {
            withContext(NonCancellable) {
                ownerWatch.cancel()
                selected.cancelNetwork = null
                if (!complete) runCatching { target?.abort() }
                // Serialize release and service shutdown with onStartCommand.
                // A second ticket cannot be stranded against the finishing job.
                withContext(Dispatchers.Main.immediate) {
                    ticket = null
                    work = null
                    foreground = false
                    try {
                        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
                        if (complete) runCatching { notifyProgress(notification("Saved to Movies/SautiLink", 100, false, finished = true, saved = saved)) }
                        else if (!selected.cancelled.get() && selected.active()) runCatching { notifyProgress(notification("Download failed. Try again.", 0, false, finished = true, failed = true)) }
                    } finally {
                        NativeShortVideoDownloads.release(selected)
                        stopSelf(lastStartId)
                    }
                }
            }
        }
    }

    private fun ensureCurrent(selected: NativeShortVideoDownloadTicket) {
        if (!selected.active()) throw IOException("Download cancelled")
    }

    private interface PendingVideo {
        val output: OutputStream
        fun publish(active: () -> Boolean): Uri?
        fun abort()
    }

    private fun createPendingVideo(selected: NativeShortVideoDownloadTicket): PendingVideo {
        val name = "SautiLink-${selected.mediaId}-${selected.id.take(8)}.mp4"
        if (Build.VERSION.SDK_INT >= 29) return createMediaStoreVideo(name)
        return createLegacyVideo(name, selected.id)
    }

    @RequiresApi(29)
    private fun createMediaStoreVideo(name: String): PendingVideo {
        val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        // A killed process cannot restore its ticket or credentials. Purge only
        // this package's abandoned hidden outputs before beginning a new one.
        runCatching {
            contentResolver.query(collection, arrayOf(MediaStore.Video.Media._ID),
                "${MediaStore.Video.Media.IS_PENDING}=1 AND ${MediaStore.Video.Media.RELATIVE_PATH}=? AND ${MediaStore.Video.Media.OWNER_PACKAGE_NAME}=?",
                arrayOf("Movies/SautiLink/", packageName), null)?.use { cursor ->
                var removed = 0
                while (cursor.moveToNext() && removed++ < 20) contentResolver.delete(
                    android.content.ContentUris.withAppendedId(collection, cursor.getLong(0)), null, null)
            }
        }
        val uri = contentResolver.insert(collection, ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, name); put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/SautiLink/"); put(MediaStore.Video.Media.IS_PENDING, 1)
        }) ?: throw IOException("Storage unavailable")
        val stream = try { contentResolver.openOutputStream(uri, "w") ?: throw IOException("Storage unavailable") }
        catch (error: Exception) { contentResolver.delete(uri, null, null); throw error }
        return object : PendingVideo {
            override val output = stream
            override fun publish(active: () -> Boolean): Uri {
                if (!active()) throw IOException("Download cancelled")
                if (contentResolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null) != 1)
                    throw IOException("Could not publish video")
                return uri
            }
            override fun abort() { runCatching { stream.close() }; contentResolver.delete(uri, null, null) }
        }
    }

    @Suppress("DEPRECATION")
    private fun createLegacyVideo(name: String, nonce: String): PendingVideo {
        val privateRoot = File(cacheDir, "short-video-downloads").apply { if (!isDirectory && !mkdirs()) throw IOException("Storage unavailable") }
        val folder = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "SautiLink")
        privateRoot.listFiles().orEmpty().filter { it.name.matches(Regex("[a-f0-9-]{36}\\.part")) }.forEach { abandoned ->
            // Match a hidden public copy to its private ticket marker only.
            // Never sweep unrelated user files from the shared directory.
            val suffix = Regex.escape("-${abandoned.name.removeSuffix(".part").take(8)}.mp4.pending")
            val pendingName = Regex("\\.SautiLink-[a-f0-9-]{36}$suffix")
            folder.listFiles().orEmpty().filter { it.name.matches(pendingName) }.forEach { it.delete() }
            abandoned.delete()
        }
        val temporary = File(privateRoot, "$nonce.part")
        val stream = try { FileOutputStream(temporary) } catch (error: Exception) { temporary.delete(); throw error }
        var hidden: File? = null
        var published: File? = null
        return object : PendingVideo {
            override val output = stream
            override fun publish(active: () -> Boolean): Uri? {
                if (!active()) throw IOException("Download cancelled")
                if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Storage unavailable")
                val staging = File(folder, ".$name.pending"); hidden = staging
                FileInputStream(temporary).use { input -> FileOutputStream(staging).use { destination ->
                    copyNativeShortVideoDownload(input, destination, temporary.length(), active)
                } }
                if (!active()) throw IOException("Download cancelled")
                val destination = File(folder, name)
                if (destination.exists() || !staging.renameTo(destination)) throw IOException("Could not publish video")
                published = destination
                temporary.delete()
                MediaScannerConnection.scanFile(this@NativeShortVideoDownloadService, arrayOf(destination.absolutePath), arrayOf("video/mp4"), null)
                return null
            }
            override fun abort() { runCatching { stream.close() }; temporary.delete(); hidden?.delete(); published?.delete() }
        }
    }

    @SuppressLint("MissingPermission")
    private fun notifyProgress(notification: Notification) {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            runCatching { manager.notify(NOTIFICATION, notification) }
    }

    private fun notification(status: String, percent: Int, indeterminate: Boolean, finished: Boolean = false,
        failed: Boolean = false, saved: Uri? = null): Notification {
        val cancel = PendingIntent.getService(this, 0, Intent(this, NativeShortVideoDownloadService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val view = RemoteViews(packageName, R.layout.native_short_video_download_notification).apply {
            setTextViewText(R.id.short_download_title, if (finished) if (failed) "Download failed" else "Video downloaded" else "Downloading video")
            setTextViewText(R.id.short_download_status, status)
            setProgressBar(R.id.short_download_progress, 100, percent, indeterminate)
            setViewVisibility(R.id.short_download_progress, if (finished) View.GONE else View.VISIBLE)
            setViewVisibility(R.id.short_download_cancel, if (finished) View.GONE else View.VISIBLE)
            setOnClickPendingIntent(R.id.short_download_cancel, cancel)
        }
        val launch = if (saved != null) Intent(Intent.ACTION_VIEW).setDataAndType(saved, "video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            else Intent(this, MainActivity::class.java)
        val content = PendingIntent.getActivity(this, 1, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_sautilink)
            .setContentTitle(if (finished) "SautiLink video download" else "Downloading SautiLink video").setContentText(status)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(view).setCustomBigContentView(view)
            .setContentIntent(content).setOngoing(!finished).setAutoCancel(finished).setOnlyAlertOnce(true).setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_PROGRESS).build()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    @RequiresApi(35)
    override fun onTimeout(startId: Int, fgsType: Int) { ticket?.cancel(); work?.cancel(); stopSelf() }
    override fun onDestroy() { ticket?.cancel(); scope.cancel(); super.onDestroy() }

    companion object {
        internal const val ACTION_START = "com.sautilink.nativeapp.download.START"
        private const val ACTION_CANCEL = "com.sautilink.nativeapp.download.CANCEL"
        internal const val EXTRA_TICKET = "download_ticket"
        private const val CHANNEL = "sautilink_video_downloads"
        private const val NOTIFICATION = 5106
        private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).cache(null)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(20, TimeUnit.MINUTES).build()
        private fun sizeLabel(bytes: Long): String = String.format(java.util.Locale.US, "%.1f MiB", bytes / (1024.0 * 1024.0))
    }
}
