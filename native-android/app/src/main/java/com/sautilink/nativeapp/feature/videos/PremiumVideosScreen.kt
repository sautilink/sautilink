package com.sautilink.nativeapp.feature.videos

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager
import androidx.media3.exoplayer.source.preload.TargetPreloadStatusControl
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.R
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.delay
import kotlin.math.abs

private data class VideoClip(
    val key: String,
    val title: String,
    val creator: String,
    val location: String,
    val uri: Uri,
    val isImported: Boolean = false
)

/**
 * Preload a short window around the active item, without allocating another video decoder.
 * Media3 shares preload resources with the ExoPlayer built by the SAME builder.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private class SautiPreloadPolicy(var activeIndex: Int = 0) :
    TargetPreloadStatusControl<Int, DefaultPreloadManager.PreloadStatus> {
    override fun getTargetPreloadStatus(index: Int): DefaultPreloadManager.PreloadStatus {
        val distance = index - activeIndex
        return when {
            distance == 1 -> DefaultPreloadManager.PreloadStatus.specifiedRangeLoaded(2500L)
            distance == -1 -> DefaultPreloadManager.PreloadStatus.specifiedRangeLoaded(1000L)
            abs(distance) == 2 -> DefaultPreloadManager.PreloadStatus.PRELOAD_STATUS_TRACKS_SELECTED
            else -> DefaultPreloadManager.PreloadStatus.PRELOAD_STATUS_NOT_PRELOADED
        }
    }
}

/**
 * A **real** local Media3 player test, not a live SautiLink feed.
 * Single player shared across pages: only the settled page has a decoder / player surface.
 * Bundled clips are original abstract animations; phone-picked clips stay local to the device.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PremiumVideosScreen(onBack: () -> Unit, onOpenMedia: (Int) -> Unit, onNotice: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val defaultClips = remember(context) {
        listOf(
            VideoClip("sample-blue", "A little moment of calm", "SautiLink Studio", "Blue Hour · Offline demo",
                Uri.parse("android.resource://${context.packageName}/${R.raw.sauti_blue_hour}")),
            VideoClip("sample-gold", "Every story deserves motion", "SautiLink Studio", "Golden Sky · Offline demo",
                Uri.parse("android.resource://${context.packageName}/${R.raw.sauti_golden_sky}"))
        )
    }
    var localClips by remember { mutableStateOf<List<VideoClip>>(emptyList()) }
    val clips = if (localClips.isEmpty()) defaultClips else localClips
    val pager = rememberPagerState(pageCount = { clips.size })
    var liked by remember { mutableStateOf(setOf<String>()) }
    // Sound always starts muted when opening Short Videos, even if previously unmuted.
    var muted by remember { mutableStateOf(true) }
    val preferences = remember(context) { context.getSharedPreferences("sautilink_video_preview", Context.MODE_PRIVATE) }
    var autoPlay by remember { mutableStateOf(preferences.getBoolean("autoplay", true)) }
    var playbackSpeed by remember { mutableFloatStateOf(preferences.getFloat("speed", 1f)) }
    var playbackOptionsOpen by remember { mutableStateOf(false) }
    var seeking by remember { mutableStateOf(false) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var commentsOpen by remember { mutableStateOf(false) }
    var isPlaying by remember { mutableStateOf(false) }
    var buffering by remember { mutableStateOf(true) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var playbackProgress by remember { mutableFloatStateOf(0f) }
    var resumeAfterBackground by remember { mutableStateOf(false) }
    val activeClip = clips.getOrNull(pager.settledPage) ?: clips.first()

    val pickVideos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(5)) { picked ->
        if (picked.isNotEmpty()) {
            localClips = picked.mapIndexed { index, uri ->
                VideoClip("local-$index-${uri.hashCode()}", "Your video ${index + 1}", "From your phone", "Private local preview", uri, true)
            }
        }
    }

    val policy = remember { SautiPreloadPolicy() }
    val preloadBuilder = remember(context) { DefaultPreloadManager.Builder(context, policy) }
    val preloadManager = remember(preloadBuilder) { preloadBuilder.build() }
    val player = remember(preloadBuilder) {
        preloadBuilder.buildExoPlayer().apply {
            repeatMode = Player.REPEAT_MODE_ONE
            volume = 0f // Never play unexpected audio when opening Short Videos.
        }
    }
    val mediaItems = remember(clips) {
        clips.map { clip -> MediaItem.Builder().setUri(clip.uri).setMediaId(clip.key).build() }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                buffering = state == Player.STATE_BUFFERING || state == Player.STATE_IDLE
            }
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onPlayerError(error: PlaybackException) {
                playbackError = "This video could not be played on your device."
                buffering = false
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
            preloadManager.release()
        }
    }
    DisposableEffect(owner, player) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    resumeAfterBackground = player.playWhenReady
                    player.pause()
                }
                Lifecycle.Event.ON_START -> {
                    if (resumeAfterBackground && playbackError == null) player.play()
                    resumeAfterBackground = false
                }
                else -> Unit
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    // Reset only when the clip list changes (e.g., user picks videos from their phone).
    // By adding items before playback effects, swipe changes can reuse preloaded samples.
    LaunchedEffect(mediaItems) {
        player.stop()
        preloadManager.reset()
        mediaItems.forEachIndexed { index, item -> preloadManager.add(item, index) }
        if (localClips.isNotEmpty() || pager.currentPage >= mediaItems.size) pager.scrollToPage(0)
        policy.activeIndex = pager.settledPage
        preloadManager.setCurrentPlayingIndex(policy.activeIndex)
        preloadManager.invalidate()
    }
    // Only one ExoPlayer/decoder is kept. The manager preloads samples for nearby clips.
    LaunchedEffect(activeClip.key, mediaItems) {
        val index = clips.indexOfFirst { it.key == activeClip.key }.coerceAtLeast(0)
        val item = mediaItems[index]
        playbackError = null
        playbackProgress = 0f
        durationMs = 0L
        buffering = true
        player.stop()
        val preloadedSource = preloadManager.getMediaSource(item)
        if (preloadedSource != null) player.setMediaSource(preloadedSource) else player.setMediaItem(item)
        player.prepare()
        player.playWhenReady = autoPlay && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        policy.activeIndex = index
        preloadManager.setCurrentPlayingIndex(index)
        preloadManager.invalidate()
    }
    LaunchedEffect(muted) { player.volume = if (muted) 0f else 1f }
    LaunchedEffect(playbackSpeed) { player.setPlaybackSpeed(playbackSpeed) }
    LaunchedEffect(player) {
        while (true) {
            // Reduce periodic UI work when playback is paused or stopped.
            delay(if (player.isPlaying) 250L else 750L)
            val duration = player.duration
            durationMs = duration.coerceAtLeast(0L)
            if (!seeking) playbackProgress =
                if (duration > 0L) (player.currentPosition.toFloat() / duration).coerceIn(0f, 1f) else 0f
        }
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF070C16))) {
        VerticalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            val clip = clips[page]
            Box(Modifier.fillMaxSize().background(Color(0xFF0C1A32))) {
                // The view is only attached to the active settled page; other pages are lightweight.
                if (page == pager.settledPage) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { viewContext ->
                            PlayerView(viewContext).apply {
                                useController = false
                                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                                keepScreenOn = false
                                this.player = player
                            }
                        },
                        onRelease = { view -> view.player = null },
                        update = { view ->
                            if (view.player !== player) view.player = player
                            view.keepScreenOn = isPlaying
                        }
                    )
                }
                Box(Modifier.fillMaxWidth().height(180.dp).align(Alignment.TopCenter)
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .64f), Color.Transparent))))
                Box(Modifier.fillMaxWidth().height(340.dp).align(Alignment.BottomCenter)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .86f)))))

                if (page == pager.settledPage) {
                    // Tap the video itself to pause/resume; controls remain clickable on top.
                    Box(Modifier.fillMaxSize().clickable {
                        if (player.isPlaying) player.pause() else player.play()
                    }, contentAlignment = Alignment.Center) {
                        AnimatedVisibility(visible = !isPlaying && !buffering && playbackError == null,
                            enter = fadeIn(), exit = fadeOut()) {
                            Surface(color = Color.Black.copy(alpha = .40f), shape = CircleShape) {
                                Icon(Icons.Rounded.PlayArrow, contentDescription = "Paused; tap to play",
                                    tint = Color.White, modifier = Modifier.padding(17.dp).size(39.dp))
                            }
                        }
                    }
                    if (buffering && playbackError == null) CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center).size(36.dp), color = Color.White, strokeWidth = 3.dp)
                    if (playbackError != null) {
                        Column(Modifier.align(Alignment.Center).padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = Color.White)
                            Text(playbackError.orEmpty(), color = Color.White, style = MaterialTheme.typography.bodyMedium)
                            Button(onClick = { playbackError = null; player.prepare(); player.play() }, shape = SautiShape.Pill) {
                                Text("Retry playback")
                            }
                        }
                    }
                }
                Row(
                    Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                        .padding(start = 18.dp, end = 12.dp, bottom = 31.dp),
                    verticalAlignment = Alignment.Bottom
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(37.dp).clip(CircleShape).background(SautiColors.Blue), contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PlayCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(clip.creator, style = MaterialTheme.typography.titleMedium, color = Color.White)
                        }
                        Text(clip.title, style = MaterialTheme.typography.titleLarge, color = Color.White,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(clip.location, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .85f))
                        Surface(color = Color.Black.copy(alpha = .32f), shape = SautiShape.Pill) {
                            Text(if (clip.isImported) "Device video · not uploaded" else "Offline demonstration clip",
                                Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                                style = MaterialTheme.typography.labelSmall, color = Color.White)
                        }
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        VideoAction(
                            if (clip.key in liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                            if (clip.key in liked) "Unlike sample" else "Like sample",
                            if (clip.key in liked) "1" else "0",
                            tint = if (clip.key in liked) SautiColors.Red else Color.White,
                            onClick = { liked = if (clip.key in liked) liked - clip.key else liked + clip.key }
                        )
                        VideoAction(Icons.Rounded.ChatBubbleOutline, "Comments preview", "Chat", onClick = { commentsOpen = true })
                        VideoAction(Icons.Rounded.Share, "Share preview", "Share", onClick = {
                            onNotice("Sharing will be enabled after API integration")
                        })
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(horizontal = 7.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBackIosNew, contentDescription = "Back", tint = Color.White)
            }
            Spacer(Modifier.weight(1f))
            Text("Short Videos", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = {
                pickVideos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
            }) {
                Icon(Icons.Rounded.VideoLibrary, contentDescription = "Choose up to five videos from phone", tint = Color.White)
            }
            IconButton(onClick = { playbackOptionsOpen = true }) {
                Icon(Icons.Rounded.Tune, contentDescription = "Playback options", tint = Color.White)
            }
            IconButton(onClick = { muted = !muted }) {
                Icon(if (muted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                    contentDescription = if (muted) "Unmute video" else "Mute video", tint = Color.White)
            }
        }
        Row(Modifier.align(Alignment.TopCenter).padding(top = 62.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            clips.indices.forEach { index ->
                Box(Modifier.width(if (pager.settledPage == index) 29.dp else 8.dp).height(4.dp)
                    .clip(SautiShape.Pill).background(if (pager.settledPage == index) Color.White else Color.White.copy(alpha = .4f)))
            }
        }
        // Interactive seek track; media stays locally on device.
        if (durationMs > 0L) {
            Slider(
                value = playbackProgress.coerceIn(0f, 1f),
                onValueChange = { seeking = true; playbackProgress = it },
                onValueChangeFinished = {
                    player.seekTo((playbackProgress * durationMs).toLong())
                    seeking = false
                },
                modifier = Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .height(28.dp).padding(horizontal = 9.dp),
                colors = SliderDefaults.colors(
                    thumbColor = Color.White, activeTrackColor = Color.White,
                    inactiveTrackColor = Color.White.copy(alpha = .40f)
                )
            )
        }
    }
    if (playbackOptionsOpen) {
        ModalBottomSheet(
            onDismissRequest = { playbackOptionsOpen = false },
            shape = SautiShape.Sheet
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                Text("Playback", style = MaterialTheme.typography.titleLarge)
                Text("Speed", style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf(.75f, 1f, 1.25f, 1.5f).forEach { rate ->
                        FilterChip(
                            selected = playbackSpeed == rate,
                            onClick = {
                                playbackSpeed = rate
                                preferences.edit().putFloat("speed", rate).apply()
                            },
                            label = { Text("${rate}×") }
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Autoplay", style = MaterialTheme.typography.titleMedium)
                        Text("Automatically play after switching videos", style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(
                        checked = autoPlay,
                        onCheckedChange = { enabled ->
                            autoPlay = enabled
                            preferences.edit().putBoolean("autoplay", enabled).apply()
                            if (!enabled) player.pause()
                            else if (playbackError == null && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) player.play()
                        }
                    )
                }
                if (localClips.isNotEmpty()) {
                    OutlinedButton(
                        onClick = {
                            localClips = emptyList()
                            playbackOptionsOpen = false
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = SautiShape.Pill
                    ) { Text("Return to offline demo videos") }
                }
                Text(
                    "Preview only. Videos from your phone stay on this device. Adaptive streaming quality will be added with the SautiLink video API.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(12.dp))
            }
        }
    }
    if (commentsOpen) {
        ModalBottomSheet(onDismissRequest = { commentsOpen = false }, shape = SautiShape.Sheet) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Comments", style = MaterialTheme.typography.titleLarge)
                Text("This is a native playback prototype. Comments are not connected to SautiLink yet.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { commentsOpen = false }, modifier = Modifier.fillMaxWidth(), shape = SautiShape.Pill) {
                    Text("Close")
                }
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
private fun VideoAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    caption: String,
    tint: Color = Color.White,
    onClick: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(onClick = onClick, modifier = Modifier.size(51.dp)) {
            Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(29.dp))
        }
        Text(caption, color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
    }
}
