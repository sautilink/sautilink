package com.sautilink.nativeapp.feature.videos

import com.sautilink.nativeapp.ui.components.SautiVerificationBadge

import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.ConnectivityManager
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import com.sautilink.nativeapp.feature.home.PostCommentsSheet
import com.sautilink.nativeapp.ui.components.SautiPostIcons
import androidx.compose.ui.Alignment
import com.sautilink.nativeapp.ui.components.sautiActionFeedback
import androidx.compose.ui.unit.sp
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
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.home.PostInteractionsClient
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import com.sautilink.nativeapp.feature.home.NativePlaybackPreferences
import com.sautilink.nativeapp.feature.home.StagingFeedPost
import com.sautilink.nativeapp.feature.home.rememberNetworkAvailable
import com.sautilink.nativeapp.ui.components.SautiSkeletonBlock
import com.sautilink.nativeapp.ui.components.SautiVideoGestureSurface
import com.sautilink.nativeapp.ui.components.videoSeekTarget
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.util.Locale

private data class LiveClip(val post: StagingFeedPost, val mediaId: String)

/** RLS-backed short-video feed. One authorized decoder is shared by all visible pages. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val scope = rememberCoroutineScope()
    val feedback = remember { SnackbarHostState() }
    val preferences = remember(context) { context.getSharedPreferences("sautilink_live_video", Context.MODE_PRIVATE) }
    var clips by remember(auth) { mutableStateOf<List<LiveClip>>(emptyList()) }
    var nextOffset by remember(auth) { mutableIntStateOf(0) }
    var hasMore by remember(auth) { mutableStateOf(false) }
    var loading by remember(auth, auth.account?.id) { mutableStateOf(auth.account != null) }
    var error by remember(auth) { mutableStateOf<String?>(null) }
    var reload by remember(auth) { mutableIntStateOf(0) }
    var pageRetry by remember(auth) { mutableIntStateOf(0) }
    var token by remember(auth) { mutableStateOf<String?>(null) }
    val muted = NativePlaybackPreferences.sessionMuted
    var autoplay by remember { mutableStateOf(preferences.getBoolean("autoplay", true)) }
    var quality by remember { mutableStateOf(preferences.getString("quality", "auto") ?: "auto") }
    var qualityOpen by remember { mutableStateOf(false) }
    var buffering by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var resumeAfterBackground by remember { mutableStateOf(false) }
    // All interaction state is server-confirmed. Unknown state never implies an Unlike/Undo.
    var likeStates by remember(auth, auth.account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var saveStates by remember(auth, auth.account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var repostStates by remember(auth, auth.account?.id) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var busyActions by remember(auth, auth.account?.id) { mutableStateOf<Set<String>>(emptySet()) }
    var commentsFor by remember(auth, auth.account?.id) { mutableStateOf<StagingFeedPost?>(null) }
    var commentCountSyncVersion by remember(auth, auth.account?.id) { mutableIntStateOf(0) }
    val commentStateHolder = key(auth.backend.id, auth.account?.id) { rememberSaveableStateHolder() }
    val canInteract = auth.backend == SautiBackend.PRODUCTION && auth.account != null && online

    fun togglePostAction(post: StagingFeedPost, kind: String) {
        if (!canInteract) {
            scope.launch { feedback.showSnackbar("Reconnect to interact with this video.") }
            return
        }
        val key = "$kind:${post.id}"
        if (key in busyActions) return
        val before = when (kind) {
            "like" -> likeStates[post.id]
            "save" -> saveStates[post.id]
            "repost" -> repostStates[post.id]
            else -> return
        }
        val desired = before != true
        val accountId = auth.account?.id
        busyActions = busyActions + key
        scope.launch {
            try {
                withTimeout(20_000L) {
                    when (kind) {
                        "like" -> actions.setLike(post.id, desired)
                        "save" -> actions.setSaved(post.id, desired)
                        "repost" -> actions.setRepost(post.id, desired)
                    }
                }
                if (auth.account?.id != accountId) return@launch
                when (kind) {
                    "like" -> {
                        likeStates = likeStates + (post.id to desired)
                        if (before != null) clips = clips.map { clip ->
                            if (clip.post.id == post.id) clip.copy(post = clip.post.copy(
                                likes = (clip.post.likes + if (before) -1 else 1).coerceAtLeast(0)))
                            else clip
                        }
                    }
                    "save" -> saveStates = saveStates + (post.id to desired)
                    "repost" -> {
                        repostStates = repostStates + (post.id to desired)
                        // Resolve counts from the source of truth; a replay or unknown prior
                        // state must never invent a repost total.
                        try {
                            val total = withTimeout(12_000L) { actions.loadRepostCount(post.id) }
                            if (auth.account?.id == accountId) clips = clips.map { clip ->
                                if (clip.post.id == post.id) clip.copy(post = clip.post.copy(reposts = total)) else clip
                            }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { /* Feed refresh reconciles a delayed count. */ }
                    }
                }
            } catch (cancelled: TimeoutCancellationException) {
                // A timed-out request may have succeeded; discard uncertain status.
                when (kind) {
                    "like" -> likeStates = likeStates - post.id
                    "save" -> saveStates = saveStates - post.id
                    "repost" -> repostStates = repostStates - post.id
                }
                feedback.showSnackbar("${kind.replaceFirstChar { it.uppercase() }} timed out. Check status before trying again.")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) {
                feedback.showSnackbar(e.message ?: "Could not update this video. Please try again.")
            } finally {
                busyActions = busyActions - key
            }
        }
    }

    fun shareClip(post: StagingFeedPost, copyOnly: Boolean) {
        try {
            val url = actions.postShareUrl(post.id)
            if (copyOnly) {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("SautiLink video", url))
                scope.launch { feedback.showSnackbar("Link copied") }
            } else {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, url)
                }
                context.startActivity(Intent.createChooser(intent, "Share SautiLink video"))
            }
        } catch (_: Exception) {
            scope.launch { feedback.showSnackbar("Could not share this video.") }
        }
    }

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
                .build().apply { repeatMode = Player.REPEAT_MODE_ONE; volume = if (muted) 0f else 1f }
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
    LaunchedEffect(auth.account?.id, clip?.post?.id, online) {
        val postId = clip?.post?.id ?: return@LaunchedEffect
        val accountId = auth.account?.id ?: return@LaunchedEffect
        if (!canInteract) return@LaunchedEffect
        // Independent reads: a slow Save lookup never prevents Like or Repost.
        if (postId !in likeStates) launch {
            try {
                val states = withTimeout(18_000L) { actions.getLikeStates(listOf(postId)) }
                if (auth.account?.id == accountId) likeStates = states + likeStates
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* An explicit Like remains possible. */ }
        }
        if (postId !in saveStates) launch {
            try {
                val states = withTimeout(18_000L) { actions.getSavedStates(listOf(postId)) }
                if (auth.account?.id == accountId) saveStates = states + saveStates
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* An explicit Save remains possible. */ }
        }
        if (postId !in repostStates) launch {
            try {
                val states = withTimeout(18_000L) { actions.getRepostStates(listOf(postId)) }
                if (auth.account?.id == accountId) repostStates = states + repostStates
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* An explicit Repost remains possible. */ }
        }
    }
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

    BoxWithConstraints(Modifier.fillMaxSize().background(Color(0xFF07101B))) {
        // Keep full-sized actions below the toolbar when landscape reduces height.
        val compactRail = maxHeight < 380.dp
        if (auth.account == null) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Sign in to watch Short Videos", color = Color.White, style = MaterialTheme.typography.titleLarge)
                Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else if (clips.isEmpty()) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (loading) SautiSkeletonBlock(Modifier.fillMaxWidth().height(180.dp))
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
                        SautiVideoGestureSurface(Modifier.fillMaxSize(),
                            playbackLabel = if (playing) "Pause video" else "Play video",
                            onPlayback = { if (player.isPlaying) player.pause() else player.play() },
                            onTap = { _, _ -> if (player.isPlaying) player.pause() else player.play() },
                            onSeek = { delta ->
                                if (player.isCurrentMediaItemSeekable) {
                                    player.seekTo(videoSeekTarget(player.currentPosition, delta, player.duration)); true
                                } else false
                            },
                            onLike = if (canInteract && "like:${item.post.id}" !in busyActions) ({
                                if (likeStates[item.post.id] != true) togglePostAction(item.post, "like")
                            }) else null) {
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
                    Box(Modifier.fillMaxWidth().height(160.dp).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .85f)))))
                    Column(Modifier.align(Alignment.BottomStart).padding(start = 16.dp,
                        end = if (compactRail) 132.dp else 76.dp, bottom = 22.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(item.post.authorName, color = Color.White, style = MaterialTheme.typography.labelLarge,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false).clickable(enabled = item.post.authorHandle.isNotBlank()) {
                                    onOpenProfile(item.post.authorHandle)
                                })
                            SautiVerificationBadge(item.post.verified, item.post.badgeType,
                                item.post.authorName, size = 13.dp, onDarkSurface = true)
                        }
                        if (item.post.body.isNotBlank()) com.sautilink.nativeapp.ui.components.SautiPostText(item.post.body, color = Color.White,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    val railActions: @Composable () -> Unit = {
                        val post = item.post
                        val liked = likeStates[post.id] == true
                        val saved = saveStates[post.id] == true
                        val reposted = repostStates[post.id] == true
                        VideoRailAction(
                            if (liked) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbUpOffAlt,
                            "Like", formatVideoCount(post.likes), liked,
                            enabled = canInteract && "like:${post.id}" !in busyActions
                        ) { togglePostAction(post, "like") }
                        VideoRailAction(Icons.Rounded.ChatBubbleOutline, "Comments",
                            formatVideoCount(post.comments)) { commentsFor = post }
                        VideoRailAction(if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                            "Save", null, saved,
                            enabled = canInteract && "save:${post.id}" !in busyActions
                        ) { togglePostAction(post, "save") }
                        VideoRailAction(Icons.Rounded.Repeat, "Repost", formatVideoCount(post.reposts),
                            reposted, enabled = canInteract && "repost:${post.id}" !in busyActions
                        ) { togglePostAction(post, "repost") }
                        VideoRailAction(SautiPostIcons.Share, "Share") { shareClip(post, false) }
                        VideoRailAction(Icons.Rounded.ContentCopy, "Copy link") { shareClip(post, true) }
                    }
                    if (compactRail) {
                        FlowRow(Modifier.align(Alignment.BottomEnd)
                            .padding(end = 4.dp, bottom = 20.dp).width(113.dp),
                            maxItemsInEachRow = 2,
                            horizontalArrangement = Arrangement.spacedBy(0.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp)) {
                            railActions()
                        }
                    } else {
                        Column(Modifier.align(Alignment.BottomEnd)
                            .padding(end = 4.dp, bottom = 20.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            railActions()
                        }
                    }
                }
            }
            if (error != null) TextButton(onClick = { error = null; pageRetry++ },
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp)) { Text("Retry more videos") }
        }
        SnackbarHost(hostState = feedback,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 54.dp))
        Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White) }
            Text("Short Videos", color = Color.White, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f))
            IconButton(onClick = { qualityOpen = true }) { Icon(Icons.Rounded.HighQuality, "Video quality", tint = Color.White) }
            IconButton(onClick = NativePlaybackPreferences::toggleSessionSound) { Icon(if (muted) Icons.AutoMirrored.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp,
                if (muted) "Unmute" else "Mute", tint = Color.White) }
        }
    }
    val selectedPost = commentsFor
    if (selectedPost != null) commentStateHolder.SaveableStateProvider(selectedPost.id) {
        PostCommentsSheet(post = selectedPost, actions = actions, allowWrite = canInteract,
            signedInUserId = auth.account?.id, onDismiss = { commentsFor = null },
            onRootPosted = {}, onRootDeleted = {}, onCommentChanged = {
                val accountId = auth.account?.id
                val sequence = ++commentCountSyncVersion
                scope.launch {
                    try {
                        val total = withTimeout(12_000L) { actions.loadCommentCount(selectedPost.id) }
                        if (auth.account?.id == accountId && sequence == commentCountSyncVersion) {
                            clips = clips.map { item ->
                                if (item.post.id == selectedPost.id) item.copy(post = item.post.copy(comments = total)) else item
                            }
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Keep the last confirmed count until feed refresh. */ }
                }
            })
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


private fun formatVideoCount(value: Int): String = when {
    value >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000.0)
    else -> value.coerceAtLeast(0).toString()
}

/** Tap animation + explicit semantics for TalkBack and large-screen navigation. */
@Composable
private fun VideoRailAction(
    icon: ImageVector,
    label: String,
    count: String? = null,
    active: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val tint by animateColorAsState(if (active) Color(0xFFFF5964) else Color.White,
        tween(150), label = "Video action color")
    Column(Modifier.width(56.dp).heightIn(min = 48.dp)
        .clickable(interactionSource = interaction, indication = null,
            enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(vertical = 1.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        Icon(icon, contentDescription = label,
            modifier = Modifier.size(24.dp).sautiActionFeedback(interaction),
            tint = tint)
        Spacer(Modifier.height(2.dp))
        Text(count ?: label, color = Color.White,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), maxLines = 1)
    }
}
