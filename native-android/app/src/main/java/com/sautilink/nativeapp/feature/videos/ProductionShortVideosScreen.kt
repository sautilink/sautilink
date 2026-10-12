package com.sautilink.nativeapp.feature.videos

import android.content.Context
import android.net.ConnectivityManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import com.sautilink.nativeapp.feature.home.StagingFeedPost
import com.sautilink.nativeapp.feature.home.rememberNetworkAvailable
import com.sautilink.nativeapp.ui.theme.SautiShape

private data class LiveClip(val post: StagingFeedPost, val mediaId: String)

/** RLS-backed short-video feed. One authorized decoder is shared by all visible pages. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductionShortVideosScreen(
    auth: StagingAuthClient,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit
) {
    val context = LocalContext.current
    val online = rememberNetworkAvailable()
    val owner = LocalLifecycleOwner.current
    val client = remember(auth) { StagingFeedClient(auth) }
    val preferences = remember(context) { context.getSharedPreferences("sautilink_live_video", Context.MODE_PRIVATE) }
    var clips by remember(auth) { mutableStateOf<List<LiveClip>>(emptyList()) }
    var nextOffset by remember(auth) { mutableIntStateOf(0) }
    var hasMore by remember(auth) { mutableStateOf(false) }
    var loading by remember(auth) { mutableStateOf(false) }
    var error by remember(auth) { mutableStateOf<String?>(null) }
    var reload by remember(auth) { mutableIntStateOf(0) }
    var pageRetry by remember(auth) { mutableIntStateOf(0) }
    var token by remember(auth) { mutableStateOf<String?>(null) }
    var muted by remember { mutableStateOf(true) }
    var autoplay by remember { mutableStateOf(preferences.getBoolean("autoplay", true)) }
    var quality by remember { mutableStateOf(preferences.getString("quality", "auto") ?: "auto") }
    var qualityOpen by remember { mutableStateOf(false) }
    var buffering by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var resumeAfterBackground by remember { mutableStateOf(false) }

    LaunchedEffect(auth, auth.account?.id, reload, online) {
        val cached = if (auth.account != null) client.cached("short_videos") else null
        clips = cached?.posts?.toLiveClips().orEmpty()
        nextOffset = cached?.nextOffset ?: 0
        hasMore = cached?.hasMore ?: false
        error = null; token = null
        if (auth.account == null) return@LaunchedEffect
        if (!online) { error = "Offline. Reconnect to play Short Videos."; return@LaunchedEffect }
        loading = true
        try {
            token = auth.accessTokenForStagingRead()
            val page = client.load("short_videos", 0)
            clips = page.posts.toLiveClips()
            nextOffset = page.nextOffset
            hasMore = page.hasMore
        } catch (e: Exception) { error = e.message ?: "Could not load short videos." }
        finally { loading = false }
    }

    val pager = rememberPagerState(pageCount = { clips.size })
    LaunchedEffect(clips.getOrNull(pager.settledPage)?.mediaId) {
        if (clips.getOrNull(pager.settledPage) != null) {
            try { token = auth.accessTokenForStagingRead() }
            catch (e: Exception) { error = e.message ?: "Sign in again to watch videos." }
        }
    }
    LaunchedEffect(pager.settledPage, clips.size, hasMore, pageRetry) {
        if (!online || clips.isEmpty() || !hasMore || loading || pager.settledPage < clips.lastIndex - 3) return@LaunchedEffect
        loading = true
        try {
            val page = client.load("short_videos", nextOffset)
            clips = (clips + page.posts.toLiveClips()).distinctBy { it.mediaId }
            nextOffset = page.nextOffset
            hasMore = page.hasMore
        } catch (e: Exception) { error = e.message ?: "Could not load more videos." }
        finally { loading = false }
    }

    val accessToken = token
    val player = remember(auth, accessToken) {
        if (accessToken == null) null else {
            val http = DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(mapOf("Authorization" to "Bearer $accessToken"))
                .setAllowCrossProtocolRedirects(false)
            ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(http))
                .setLoadControl(DefaultLoadControl.Builder()
                    .setBufferDurationsMs(3_000, 15_000, 750, 1_500).build())
                .build().apply { repeatMode = Player.REPEAT_MODE_ONE; volume = 0f }
        }
    }
    DisposableEffect(player) {
        if (player == null) onDispose { } else {
            val listener = object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) { buffering = state == Player.STATE_BUFFERING }
                override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
                override fun onPlayerError(e: PlaybackException) {
                    playbackError = "This video could not be played."
                    buffering = false
                }
            }
            player.addListener(listener)
            onDispose { player.removeListener(listener); player.release() }
        }
    }
    DisposableEffect(owner, player, online, autoplay) {
        val observer = LifecycleEventObserver { _, event ->
            if (player != null) when (event) {
                Lifecycle.Event.ON_STOP -> { resumeAfterBackground = player.playWhenReady; player.pause() }
                Lifecycle.Event.ON_START -> {
                    if (resumeAfterBackground && autoplay && online) player.play()
                    resumeAfterBackground = false
                }
                else -> Unit
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(player, muted) { player?.volume = if (muted) 0f else 1f }
    val clip = clips.getOrNull(pager.settledPage)
    val selectedQuality = when (quality) {
        "240", "360", "480", "720", "1080" -> quality
        "original" -> null
        else -> {
            val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (connectivity.isActiveNetworkMetered) "360" else "720"
        }
    }
    LaunchedEffect(player, clip?.mediaId, selectedQuality, online) {
        if (player == null || clip == null || !online) { player?.pause(); return@LaunchedEffect }
        val sameClip = player.currentMediaItem?.mediaId == clip.mediaId
        val position = if (sameClip) player.currentPosition.coerceAtLeast(0) else 0L
        val route = "/api/sauti-media/${clip.mediaId}" +
            (selectedQuality?.let { "?quality=$it" } ?: "")
        playbackError = null
        player.setMediaItem(MediaItem.Builder().setMediaId(clip.mediaId)
            .setUri(auth.mediaOrigin + route).build())
        player.prepare()
        if (position > 0) player.seekTo(position)
        player.playWhenReady = autoplay && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }
    LaunchedEffect(player, autoplay, online) {
        if (player == null) return@LaunchedEffect
        player.playWhenReady = autoplay && online && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF07101B))) {
        if (auth.account == null) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Sign in to watch Short Videos", color = Color.White, style = MaterialTheme.typography.titleLarge)
                Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else if (clips.isEmpty()) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (loading) CircularProgressIndicator(color = Color.White)
                else Text(error ?: "No short videos yet.", color = Color.White)
                if (!loading) Button(onClick = { reload++ }) { Text("Retry") }
            }
        } else {
            VerticalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                val item = clips[page]
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    if (page == pager.settledPage && player != null && online) {
                        AndroidView(factory = { viewContext -> PlayerView(viewContext).apply {
                            useController = false
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                            this.player = player
                        } }, update = { it.player = player; it.keepScreenOn = playing },
                            onRelease = { it.player = null }, modifier = Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().clickable {
                            if (player.isPlaying) player.pause() else player.play()
                        }, contentAlignment = Alignment.Center) {
                            if (buffering && playbackError == null) CircularProgressIndicator(color = Color.White)
                            else if (!playing && playbackError == null) Icon(Icons.Rounded.PlayArrow,
                                "Play video", Modifier.size(58.dp), tint = Color.White)
                            else if (playbackError != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(playbackError.orEmpty(), color = Color.White)
                                TextButton(onClick = {
                                    playbackError = null
                                    player.prepare(); player.play()
                                }) { Text("Retry playback") }
                            }
                        }
                    }
                    if (!online && page == pager.settledPage) {
                        Text("Offline. Reconnect to play this video.", color = Color.White,
                            modifier = Modifier.align(Alignment.Center).padding(24.dp))
                    }
                    Box(Modifier.fillMaxWidth().height(220.dp).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .85f)))))
                    Column(Modifier.align(Alignment.BottomStart).padding(start = 20.dp, end = 20.dp, bottom = 42.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(item.post.authorName, color = Color.White, style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.clickable(enabled = item.post.authorHandle.isNotBlank()) {
                                onOpenProfile(item.post.authorHandle)
                            })
                        if (item.post.body.isNotBlank()) Text(item.post.body, color = Color.White,
                            maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (error != null) TextButton(onClick = { error = null; pageRetry++ },
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp)) { Text("Retry more videos") }
        }
        Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White) }
            Text("Short Videos", color = Color.White, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f))
            IconButton(onClick = { qualityOpen = true }) { Icon(Icons.Rounded.HighQuality, "Video quality", tint = Color.White) }
            IconButton(onClick = { muted = !muted }) { Icon(if (muted) Icons.AutoMirrored.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp,
                if (muted) "Unmute" else "Mute", tint = Color.White) }
        }
    }
    if (qualityOpen) ModalBottomSheet(onDismissRequest = { qualityOpen = false }, shape = SautiShape.Sheet) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Playback", style = MaterialTheme.typography.titleLarge)
            Text("Quality", style = MaterialTheme.typography.titleSmall)
            listOf("auto" to "Auto · Wi-Fi 720p, mobile 360p", "240" to "240p", "360" to "360p",
                "480" to "480p", "720" to "720p", "1080" to "1080p", "original" to "Original").forEach { (key, label) ->
                Row(Modifier.fillMaxWidth().clickable {
                    quality = key; preferences.edit().putString("quality", key).apply(); qualityOpen = false
                }.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = quality == key, onClick = {
                        quality = key; preferences.edit().putString("quality", key).apply(); qualityOpen = false
                    })
                    Text(label)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Autoplay", modifier = Modifier.weight(1f))
                Switch(checked = autoplay, onCheckedChange = {
                    autoplay = it; preferences.edit().putBoolean("autoplay", it).apply()
                    if (!it) player?.pause()
                })
            }
        }
    }
}

private fun List<StagingFeedPost>.toLiveClips(): List<LiveClip> = mapNotNull { post ->
    post.media.firstOrNull { it.kind == "video" }?.let { LiveClip(post, it.id) }
}
