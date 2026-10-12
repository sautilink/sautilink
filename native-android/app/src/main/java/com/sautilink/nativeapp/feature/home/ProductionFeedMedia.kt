package com.sautilink.nativeapp.feature.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ImageNotSupported
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** No image disk cache or persistence: a bounded, per-visible-item loader for RLS-backed media. */
@Composable
internal fun AuthorizedImage(
    auth: StagingAuthClient,
    route: String,
    description: String,
    modifier: Modifier = Modifier,
    crop: Boolean = true,
    naturalAspectRatio: Boolean = false,
    fallback: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.ImageNotSupported, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
        }
    }
) {
    var bitmap by remember(auth, route) { mutableStateOf<Bitmap?>(null) }
    var loading by remember(auth, route) { mutableStateOf(true) }
    LaunchedEffect(auth, route, auth.account?.id) {
        bitmap = null
        loading = true
        try {
            val token = auth.accessTokenForStagingRead()
            bitmap = withContext(Dispatchers.IO) { fetchBoundedBitmap(auth.mediaOrigin + route, token) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { bitmap = null }
        finally { loading = false }
    }
    // In-feed single media keeps its actual poster/image proportions rather than
    // forcing the previous cropped 1.35:1 tile used by the prototype.
    val naturalAspect = bitmap?.let { image ->
        if (image.height > 0) (image.width.toFloat() / image.height).coerceIn(.65f, 2.25f) else 1.35f
    } ?: 1.35f
    Box(if (naturalAspectRatio) modifier.aspectRatio(naturalAspect) else modifier,
        contentAlignment = Alignment.Center) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), contentDescription = description,
                contentScale = if (crop) ContentScale.Crop else ContentScale.Fit,
                modifier = Modifier.fillMaxSize())
        } else if (loading) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }
        } else fallback()
    }
}

private fun fetchBoundedBitmap(url: String, token: String): Bitmap {
    val target = URL(url)
    require(target.protocol == "https" && target.host in setOf("sautilink.com", "test.sautilink.com"))
    val conn = target.openConnection() as HttpURLConnection
    try {
        conn.requestMethod = "GET"
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.useCaches = false
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Accept", "image/*")
        if (conn.responseCode !in 200..299) throw IllegalStateException("Media unavailable")
        if (conn.contentType?.substringBefore(';')?.trim()?.lowercase()?.startsWith("image/") != true) {
            throw IllegalStateException("Response was not an image")
        }
        // Hard cap image response size (12 MiB), including for chunked transfer encoding.
        val bytes = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        conn.inputStream.use { stream ->
            var total = 0
            while (true) {
                val n = stream.read(buf)
                if (n < 0) break
                total += n
                if (total > 12 * 1024 * 1024) throw IllegalStateException("Image is too large")
                bytes.write(buf, 0, n)
            }
        }
        val raw = bytes.toByteArray()
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, opts)
        if (opts.outWidth <= 0 || opts.outHeight <= 0) throw IllegalStateException("Invalid image")
        var sample = 1
        while (opts.outWidth / sample > 1440 || opts.outHeight / sample > 1440) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size,
            BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 })
        return decoded ?: throw IllegalStateException("Image not supported")
    } finally { conn.disconnect() }
}

@Composable
internal fun PostMediaGallery(auth: StagingAuthClient, media: List<FeedMedia>) {
    var expanded by remember(auth) { mutableStateOf<FeedMedia?>(null) }
    val single = media.singleOrNull()
    if (single != null) {
        val route = "/api/sauti-media/${single.id}" +
            if (single.kind == "video") "?poster=1" else "?w=960"
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .clickable { expanded = single }) {
            AuthorizedImage(
                auth, route, "Post ${single.kind}",
                modifier = Modifier.fillMaxWidth(),
                crop = false, naturalAspectRatio = true
            )
            if (single.kind == "video") {
                Surface(color = Color.Black.copy(alpha = .58f), shape = CircleShape,
                    modifier = Modifier.align(Alignment.Center)) {
                    Icon(Icons.Rounded.PlayArrow, "Play video",
                        Modifier.padding(12.dp).size(30.dp), tint = Color.White)
                }
            }
        }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            media.chunked(2).forEach { group ->
                Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    group.forEach { item ->
                        val route = "/api/sauti-media/${item.id}" +
                            if (item.kind == "video") "?poster=1" else "?w=960"
                        Box(Modifier.weight(1f).aspectRatio(if (group.size == 1) 1.4f else 1f)
                            .clip(RoundedCornerShape(8.dp)).clickable { expanded = item }) {
                            AuthorizedImage(auth, route, "Post ${item.kind}", Modifier.fillMaxSize())
                            if (item.kind == "video") {
                                Surface(color = Color.Black.copy(alpha = .58f), shape = CircleShape,
                                    modifier = Modifier.align(Alignment.Center)) {
                                    Icon(Icons.Rounded.PlayArrow, "Play video",
                                        Modifier.padding(10.dp).size(25.dp), tint = Color.White)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    expanded?.let { item ->
        Dialog(onDismissRequest = { expanded = null }) {
            Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth()) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, top = 6.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(if (item.kind == "video") "SautiLink video" else "SautiLink photo",
                            style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        IconButton(onClick = { expanded = null }) { Icon(Icons.Rounded.Close, "Close viewer") }
                    }
                    if (item.kind == "video") {
                        AuthorizedVideoPlayer(auth, item.id)
                    } else {
                        AuthorizedImage(auth, "/api/sauti-media/${item.id}?w=1280", "Full post image",
                            modifier = Modifier.fillMaxWidth().heightIn(min = 230.dp, max = 475.dp), crop = false)
                    }
                    Spacer(Modifier.height(10.dp))
                }
            }
        }
    }
}

/** Single play-on-demand Media3 decoder. Streams with a short-lived authorized header; no token logging. */
@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun AuthorizedVideoPlayer(auth: StagingAuthClient, mediaId: String) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var token by remember(auth, mediaId) { mutableStateOf<String?>(null) }
    var error by remember(auth, mediaId) { mutableStateOf<String?>(null) }
    LaunchedEffect(auth, mediaId) {
        token = null
        error = null
        try { token = auth.accessTokenForStagingRead() }
        catch (_: Exception) { error = "Sign in again to watch this video." }
    }
    if (error != null) {
        Box(Modifier.fillMaxWidth().height(250.dp), contentAlignment = Alignment.Center) {
            Text(error.orEmpty(), Modifier.padding(20.dp))
        }
        return
    }
    val accessToken = token
    if (accessToken == null) {
        Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val player = remember(auth, mediaId, accessToken) {
        val http = DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer $accessToken"))
            .setAllowCrossProtocolRedirects(false)
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build().apply {
                volume = 0f // Always starts muted. The viewer controls may unmute.
                setMediaItem(MediaItem.fromUri("${auth.mediaOrigin}/api/sauti-media/$mediaId"))
                prepare()
                playWhenReady = true
            }
    }
    DisposableEffect(player, owner) {
        val watcher = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        owner.lifecycle.addObserver(watcher)
        onDispose {
            owner.lifecycle.removeObserver(watcher)
            player.release()
        }
    }
    var muted by remember(player) { mutableStateOf(true) }
    LaunchedEffect(player, muted) { player.volume = if (muted) 0f else 1f }
    Column {
        AndroidView(
            factory = { ctx -> PlayerView(ctx).apply { useController = true; this.player = player } },
            update = { it.player = player },
            modifier = Modifier.fillMaxWidth().height(300.dp).background(Color.Black)
        )
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Muted by default", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { muted = !muted }) { Text(if (muted) "Unmute" else "Mute") }
        }
    }
}
