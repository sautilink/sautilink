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
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
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
import com.sautilink.nativeapp.ui.components.SautiSkeletonBlock
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
            SautiSkeletonBlock(Modifier.fillMaxSize(), 6.dp)
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

/** Media dimensions are known from social_post_media before the poster request:
 * ratio >= 4:5 is natural; extra-tall items letterbox inside a fixed 4:5 frame.
 * The layout never changes its height when image bytes finish loading.
 */
private fun stableFeedAspect(media: FeedMedia): Float {
    val original = if (media.width > 0 && media.height > 0)
        media.width.toFloat() / media.height else .8f
    return original.coerceIn(.8f, 3f)
}

@Composable
internal fun PostMediaGallery(auth: StagingAuthClient, media: List<FeedMedia>) {
    if (media.isEmpty()) return
    var expandedPhoto by remember(auth) { mutableStateOf<FeedMedia?>(null) }
    val pager = androidx.compose.foundation.pager.rememberPagerState(pageCount = { media.size })
    // Use one measured frame across carousel pages, preventing vertical layout jumps on swipe.
    val carouselAspect = media.minOf(::stableFeedAspect)
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth()) {
            androidx.compose.foundation.pager.HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxWidth().aspectRatio(carouselAspect),
                key = { index -> media[index].id }
            ) { page ->
                val item = media[page]
                Box(
                    Modifier.fillMaxSize()
                        .background(Color.Black)
                        .clip(RoundedCornerShape(7.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    if (item.kind == "video") {
                        InlineFeedVideo(auth, item, Modifier.fillMaxSize(), isCurrent = pager.currentPage == page)
                    } else {
                        Box(Modifier.fillMaxSize().clickable { expandedPhoto = item }) {
                            AuthorizedImage(auth, "/api/sauti-media/${item.id}?w=960",
                                "Photo ${page + 1} of ${media.size}",
                                modifier = Modifier.fillMaxSize(),
                                crop = false)
                        }
                    }
                }
            }
            if (media.size > 1) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = Color.Black.copy(alpha = .55f),
                    modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)
                ) {
                    Text("${pager.currentPage + 1}/${media.size}", color = Color.White,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp))
                }
            }
        }
        if (media.size > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                media.forEachIndexed { index, _ ->
                    Spacer(
                        Modifier.padding(horizontal = 3.dp)
                            .size(if (index == pager.currentPage) 7.dp else 5.dp)
                            .clip(CircleShape)
                            .background(
                                if (index == pager.currentPage) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .35f)
                            )
                    )
                }
            }
        }
    }
    // Images retain the old full-size viewer; videos never open a second player.
    expandedPhoto?.let { photo ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { expandedPhoto = null }) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("Photo", style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f))
                        IconButton(onClick = { expandedPhoto = null }) {
                            Icon(Icons.Rounded.Close, contentDescription = "Close photo")
                        }
                    }
                    AuthorizedImage(auth, "/api/sauti-media/${photo.id}?w=1280",
                        "Expanded photo", Modifier.fillMaxWidth()
                            .aspectRatio(stableFeedAspect(photo)), crop = false)
                }
            }
        }
    }
}

/** Same-player inline video, no popup/Dialog and no route transition.
 * Poster is kept visible until the first decoded frame, removing sudden video flashes.
 */
@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun InlineFeedVideo(
    auth: StagingAuthClient, media: FeedMedia, modifier: Modifier = Modifier,
    isCurrent: Boolean
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val windowHeight = with(density) { configuration.screenHeightDp.dp.toPx() }
    var visibleFraction by remember(auth, media.id) { mutableFloatStateOf(0f) }
    var started by remember(auth, media.id) { mutableStateOf(false) }
    var wantsToPlay by remember(auth, media.id) { mutableStateOf(false) }
    var manualPaused by remember(auth, media.id) { mutableStateOf(false) }
    var accessToken by remember(auth, media.id) { mutableStateOf<String?>(null) }
    var requestError by remember(auth, media.id) { mutableStateOf<String?>(null) }
    val muted = NativePlaybackPreferences.sessionMuted
    var firstFrame by remember(auth, media.id) { mutableStateOf(false) }
    LaunchedEffect(visibleFraction, isCurrent, NativePlaybackPreferences.autoplayEnabled) {
        val visible = visibleFraction >= .58f && isCurrent
        if (NativePlaybackPreferences.autoplayEnabled && visible && !manualPaused) {
            started = true
            wantsToPlay = true
        } else if (!visible) {
            wantsToPlay = false
            manualPaused = false
        } else if (!NativePlaybackPreferences.autoplayEnabled) {
            wantsToPlay = false
        }
    }
    LaunchedEffect(started, auth.account?.id, media.id) {
        if (!started) return@LaunchedEffect
        try { accessToken = auth.accessTokenForStagingRead() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { requestError = "Video unavailable. Sign in and try again." }
    }
    val token = accessToken
    val player = remember(auth, media.id, token) {
        token?.let {
            val http = DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(mapOf("Authorization" to "Bearer $it"))
                .setAllowCrossProtocolRedirects(false)
            ExoPlayer.Builder(context)
                .setMediaSourceFactory(DefaultMediaSourceFactory(http))
                .build().apply {
                    volume = if (muted) 0f else 1f
                    setMediaItem(MediaItem.fromUri("${auth.mediaOrigin}/api/sauti-media/${media.id}"))
                    prepare()
                    playWhenReady = false
                }
        }
    }
    var playing by remember(player) { mutableStateOf(false) }
    DisposableEffect(player, owner) {
        if (player == null) return@DisposableEffect onDispose { }
        val listener = object : androidx.media3.common.Player.Listener {
            override fun onRenderedFirstFrame() { firstFrame = true }
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                requestError = "Video could not play. Tap retry."
            }
        }
        player.addListener(listener)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        owner.lifecycle.addObserver(observer)
        onDispose {
            owner.lifecycle.removeObserver(observer)
            player.removeListener(listener)
            player.release()
        }
    }
    LaunchedEffect(player, muted) { player?.volume = if (muted) 0f else 1f }
    LaunchedEffect(player, isCurrent, wantsToPlay, requestError) {
        if (player != null) {
            if (!isCurrent) player.pause()
            else if (wantsToPlay && requestError == null) player.play()
            else if (!wantsToPlay) player.pause()
        }
    }
    Box(modifier.background(Color.Black).onGloballyPositioned { coordinates ->
        val rect = coordinates.boundsInWindow()
        val shownTop = rect.top.coerceAtLeast(0f)
        val shownBottom = rect.bottom.coerceAtMost(windowHeight)
        visibleFraction = ((shownBottom - shownTop).coerceAtLeast(0f) /
            rect.height.coerceAtLeast(1f)).coerceIn(0f, 1f)
    }, contentAlignment = Alignment.Center) {
        if (player != null) {
            AndroidView(
                factory = { ctx -> PlayerView(ctx).apply {
                    useController = false
                    this.player = player
                    resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
                } },
                update = { it.player = player },
                onRelease = { it.player = null },
                modifier = Modifier.fillMaxSize()
                    .graphicsLayer { alpha = if (firstFrame) 1f else 0f }
            )
        }
        // Poster overlays any decoder/player surface until a real frame has arrived.
        if (!firstFrame) {
            AuthorizedImage(auth, "/api/sauti-media/${media.id}?poster=1",
                "Video cover", modifier = Modifier.fillMaxSize(), crop = false)
        }
        if (!playing && (firstFrame || !NativePlaybackPreferences.autoplayEnabled || requestError != null || !started)) {
            Surface(
                onClick = {
                    requestError = null
                    started = true
                    manualPaused = false
                    wantsToPlay = true
                    if (player?.playerError != null) player.prepare()
                    player?.play()
                },
                shape = CircleShape,
                color = Color.Black.copy(alpha = .58f),
                modifier = Modifier.size(60.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.PlayArrow, contentDescription = "Play video in post",
                        tint = Color.White, modifier = Modifier.size(32.dp))
                }
            }
        } else {
            Box(
                Modifier.fillMaxSize().clickable {
                    wantsToPlay = false
                    manualPaused = true
                    player?.pause()
                }
            )
        }
        if (started && token == null && requestError == null) {
            CircularProgressIndicator(Modifier.size(30.dp),
                color = Color.White, strokeWidth = 2.dp)
        }
        if (requestError != null) {
            Surface(
                color = Color.Black.copy(alpha = .72f),
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                Text(requestError.orEmpty(), color = Color.White,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(10.dp))
            }
        }
        if (player != null && firstFrame) {
            IconButton(
                onClick = NativePlaybackPreferences::toggleSessionSound,
                modifier = Modifier.align(Alignment.BottomStart).padding(7.dp)
                    .background(Color.Black.copy(alpha = .56f), CircleShape)
                    .size(44.dp)
            ) {
                Icon(if (muted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                    contentDescription = if (muted) "Unmute video" else "Mute video",
                    tint = Color.White, modifier = Modifier.size(23.dp))
            }
        }
    }
}
