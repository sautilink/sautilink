package com.sautilink.nativeapp.feature.music

import com.sautilink.nativeapp.ui.components.NativeSearchField
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.sautilink.nativeapp.ui.components.NativePublicAssets
import androidx.compose.ui.unit.sp
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.NativePlaybackPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class NativeMusicComposer(val create: () -> Unit) {
    var selection by mutableStateOf<NativeAudioSelection?>(null)
    var details by mutableStateOf<NativeAudioSelection?>(null)
    internal val visiblePosts = mutableStateMapOf<String, VisiblePostAudio>()
    var commentsOpen by mutableStateOf(false)
    var manualPost by mutableStateOf<String?>(null)
}
internal data class VisiblePostAudio(val postId: String, val audio: NativeAudioSelection?,
    val visiblePercent: Int, val distance: Int)
val LocalNativeMusicComposer = staticCompositionLocalOf<NativeMusicComposer?> { null }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeMusicSession(auth: StagingAuthClient, onCreate: () -> Unit, feedEnabled: Boolean = true,
    content: @Composable () -> Unit) {
    val currentCreate by rememberUpdatedState(onCreate)
    val controller = remember(auth.account?.id) { NativeMusicComposer { currentCreate() } }
    val player = rememberPreviewPlayer(handleFocus = false)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var foreground by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, _ -> foreground = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val blocked = com.sautilink.nativeapp.ui.components.LocalNativePlaybackBlocked.current
    val coordinator = remember(auth.account?.id) { com.sautilink.nativeapp.feature.home.NativeFeedPlaybackCoordinator() }
    val active = controller.visiblePosts[coordinator.activeGroup]
    DisposableEffect(player, coordinator) { onDispose { coordinator.release("feed-music") } }
    val audio = active?.audio
    val allowed = feedEnabled && foreground && !blocked && !coordinator.isPaused(active?.postId) && !controller.commentsOpen && controller.details == null &&
        (NativePlaybackPreferences.autoplayEnabled || controller.manualPost == active?.postId)
    LaunchedEffect(audio, feedEnabled, allowed, active?.postId, NativePlaybackPreferences.sessionMuted) {
        if (audio == null || !feedEnabled) { player.stop(); return@LaunchedEffect }
        val uri = audio.previewUrl()
        if (player.currentMediaItem?.localConfiguration?.uri?.toString() != uri) {
            player.pause()
            player.repeatMode = Player.REPEAT_MODE_ONE
            player.setMediaItem(MediaItem.fromUri(uri))
            player.prepare()
        }
        player.volume = if (NativePlaybackPreferences.sessionMuted) 0f else 1f
        if (allowed && audio != null && active != null) coordinator.play("feed-music", active.postId, player::pause) { player.play() }
        else player.pause()
    }
    CompositionLocalProvider(LocalNativeMusicComposer provides controller,
        com.sautilink.nativeapp.feature.home.LocalNativeFeedPlayback provides coordinator) {
        CompositionLocalProvider(com.sautilink.nativeapp.ui.components.LocalNativePlaybackBlocked provides
            (blocked || controller.commentsOpen || controller.details != null)) { content() }
        controller.details?.let { selection ->
            NativeSoundDetails(auth, selection, { controller.details = null }) {
                controller.selection = selection
                controller.details = null
                controller.create()
            }
        }
    }
}

/** One shared soundtrack follows the visible post and pauses behind overlays. */
@Composable
fun Modifier.postAudioVisibility(postId: String, audio: NativeAudioSelection?): Modifier {
    val session = LocalNativeMusicComposer.current ?: return this
    val coordinator = com.sautilink.nativeapp.feature.home.LocalNativeFeedPlayback.current
    if (audio == null) return this
    val key = remember(postId) { "audio:$postId:${java.util.UUID.randomUUID()}" }
    DisposableEffect(session, postId, key) { onDispose { session.visiblePosts.remove(postId); coordinator?.remove(key) } }
    return onGloballyPositioned { coordinates ->
        if (!coordinates.isAttached) return@onGloballyPositioned
        val bounds = coordinates.boundsInRoot()
        val viewport = coordinates.findRootCoordinates().size.height.toFloat()
        val shownTop = bounds.top.coerceAtLeast(0f)
        val shownBottom = bounds.bottom.coerceAtMost(viewport)
        val visible = ((shownBottom - shownTop).coerceAtLeast(0f) /
            minOf(coordinates.size.height.toFloat(), viewport).coerceAtLeast(1f) * 100).toInt()
        coordinator?.update(key, com.sautilink.nativeapp.feature.home.NativeFeedPlaybackCoordinator.Candidate(
            postId, visible / 100f, kotlin.math.abs((shownTop + shownBottom) / 2 - viewport / 2)))
        session.visiblePosts[postId] = VisiblePostAudio(postId, audio, visible,
            kotlin.math.abs((shownTop + shownBottom) / 2 - viewport / 2).toInt())
    }
}

private fun audioTime(ms: Long) = "${ms / 60000}:${(ms / 1000 % 60).toString().padStart(2, '0')}"

@Composable
private fun rememberPreviewPlayer(handleFocus: Boolean = true): ExoPlayer {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val player = remember(context) { ExoPlayer.Builder(context).build().apply {
        setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), handleFocus)
        setHandleAudioBecomingNoisy(true)
    } }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); player.release() }
    }
    return player
}

@Composable
private fun NativeMusicCover(id: String, modifier: Modifier = Modifier) {
    val url = "$MUSIC_ORIGIN/v1/tracks/$id/cover"
    var bitmap by remember(id) { mutableStateOf(NativePublicAssets.bitmap(url)) }
    LaunchedEffect(id) {
        if (bitmap != null) return@LaunchedEffect
        try {
            bitmap = withContext(Dispatchers.IO) {
                val bytes = NativePublicAssets.load(url, 1_000_000)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 512) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                    ?.also { NativePublicAssets.cacheBitmap(url, it) }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { }
    }
    Box(modifier.clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center) {
        val art = bitmap
        if (art != null) Image(art.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
        else Icon(Icons.Rounded.MusicNote, null)
    }
}

@Composable
fun NativeMusicIdentity(username: String, timestamp: String, selection: NativeAudioSelection?, postId: String = "",
    showTimestamp: Boolean = true) {
    val session = LocalNativeMusicComposer.current
    val coordinator = com.sautilink.nativeapp.feature.home.LocalNativeFeedPlayback.current
    var showMusic by remember(selection?.trackId) { mutableStateOf(false) }
    LaunchedEffect(selection?.trackId) {
        if (selection != null) while (true) { delay(2600); showMusic = !showMusic }
    }
    val identity = "${if (username.isNotBlank()) "@$username" else ""}${if (showTimestamp) " · $timestamp" else ""}"
    val label = if (showMusic && selection != null) "♫ ${selection.title} · ${selection.artist}" else identity
    Row(Modifier.fillMaxWidth().height(24.dp).then(if (selection != null) Modifier.clickable { session?.details = selection } else Modifier),
        verticalAlignment = Alignment.CenterVertically) {
        AnimatedContent(label, Modifier.weight(1f), contentAlignment = Alignment.CenterStart,
            transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "Post music credit") { value ->
            Text(value, Modifier.fillMaxWidth(), maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, lineHeight = 16.sp))
        }
        if (selection != null) IconButton(onClick = {
            if (NativePlaybackPreferences.sessionMuted) {
                session?.manualPost = postId
                coordinator?.selectGroupManually(postId)
            }
            NativePlaybackPreferences.toggleSessionSound()
        }, modifier = Modifier.size(24.dp)) {
            Icon(if (NativePlaybackPreferences.sessionMuted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                if (NativePlaybackPreferences.sessionMuted) "Unmute post audio" else "Mute post audio", Modifier.size(14.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeAudioPicker(auth: StagingAuthClient, onDismiss: () -> Unit, onSelect: (NativeAudioSelection) -> Unit) {
    val client = remember(auth) { NativeMusicClient(auth) }
    val scope = rememberCoroutineScope()
    val player = rememberPreviewPlayer()
    var query by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf("For you") }
    var rows by remember { mutableStateOf<List<NativeMusicTrack>>(emptyList()) }
    var selected by remember { mutableStateOf<NativeMusicTrack?>(null) }
    var start by remember { mutableFloatStateOf(0f) }
    var length by remember { mutableFloatStateOf(30_000f) }
    var playing by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    var saving by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    LaunchedEffect(tab, query) { listState.scrollToItem(0) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(failure: PlaybackException) { error = "This audio could not play. Try another track."; playing = null }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (!isPlaying) playing = null }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(query, retry) {
        loading = true; error = null
        try { delay(250); rows = client.catalog(query) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Music could not load." }
        finally { loading = false }
    }
    val shown = when (tab) {
        "Saved" -> rows.filter { it.saved }
        "Trending" -> rows.sortedWith(compareByDescending<NativeMusicTrack> { it.uses }.thenBy { it.title })
        "Original audio" -> rows.filter { it.original }
        else -> rows
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().height(600.dp).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Audio", style = MaterialTheme.typography.titleLarge)
            NativeSearchField(query, { query = it.take(160) }, Modifier.fillMaxWidth(), placeholder = "Search music")
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("For you", "Trending", "Saved", "Original audio").forEach { label ->
                    FilterChip(tab == label, { tab = label }, label = { Text(label) })
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(error.orEmpty(), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { retry++ }) { Text("Retry") }
            }
            LazyColumn(Modifier.weight(1f), state = listState, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                items(shown, key = { it.id }) { track ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable {
                        selected = track; start = track.windowStartMs.toFloat()
                        length = minOf(30_000L, track.maxClipMs, track.windowEndMs - track.windowStartMs).toFloat()
                    }.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        NativeMusicCover(track.id, Modifier.size(49.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(track.title, Modifier.weight(1f, fill = false), maxLines = 1,
                                    overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                                if (track.isNew) Text("  New", color = MaterialTheme.colorScheme.primary,
                                    style = MaterialTheme.typography.labelSmall)
                            }
                            Text("${track.artist} · ${audioTime(track.durationMs)}", maxLines = 1,
                                overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("${track.uses} ${if (track.uses == 1L) "use" else "uses"}", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = {
                            if (playing == track.id) { player.pause(); playing = null }
                            else { player.setMediaItem(MediaItem.fromUri(track.selection().previewUrl())); player.prepare(); player.play(); playing = track.id }
                        }) { Icon(if (playing == track.id) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, "Preview ${track.title}") }
                        IconButton(enabled = saving == null, onClick = {
                            saving = track.id
                            scope.launch {
                                try { client.save(track.id, !track.saved); rows = rows.map { if (it.id == track.id) it.copy(saved = !track.saved) else it } }
                                catch (failure: Exception) { error = failure.message }
                                finally { saving = null }
                            }
                        }) { Icon(if (track.saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, "Save ${track.title}") }
                    }
                }
                if (!loading && error == null && shown.isEmpty()) item { Text("No audio found.", Modifier.padding(vertical = 20.dp)) }
            }
            selected?.let { track ->
                Text(track.title, fontWeight = FontWeight.SemiBold)
                val maxLength = minOf(track.maxClipMs, track.windowEndMs - track.windowStartMs).toFloat()
                Text("Clip ${audioTime(start.toLong())} · ${audioTime(length.toLong())}", style = MaterialTheme.typography.bodySmall)
                val latestStart = (track.windowEndMs - length.toLong()).coerceAtLeast(track.windowStartMs).toFloat()
                if (latestStart > track.windowStartMs) Slider(start.coerceIn(track.windowStartMs.toFloat(), latestStart),
                    { start = it; player.pause() }, valueRange = track.windowStartMs.toFloat()..latestStart)
                if (maxLength > 1000) Slider(length, { length = it; start = minOf(start, track.windowEndMs - it); player.pause() },
                    valueRange = 1000f..maxLength)
                Button(onClick = { player.pause(); onSelect(track.selection(start.toLong(), length.toLong())) }, Modifier.fillMaxWidth()) {
                    Text("Use audio")
                }
            }
            Spacer(Modifier.navigationBarsPadding())
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeSoundDetails(auth: StagingAuthClient, audio: NativeAudioSelection,
    onDismiss: () -> Unit, onCreate: () -> Unit) {
    val client = remember(auth) { NativeMusicClient(auth) }
    val player = rememberPreviewPlayer()
    val scope = rememberCoroutineScope()
    var saved by remember(audio.trackId) { mutableStateOf<Boolean?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var plays by remember { mutableStateOf(false) }
    LaunchedEffect(audio.trackId) {
        try { saved = audio.trackId in client.savedIds() }
        catch (failure: Exception) { error = failure.message }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(failure: PlaybackException) { error = "Audio is unavailable for playback."; plays = false }
            override fun onIsPlayingChanged(isPlaying: Boolean) { plays = isPlaying }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                NativeMusicCover(audio.trackId, Modifier.size(72.dp))
                Column(Modifier.weight(1f)) {
                    Text(audio.title, style = MaterialTheme.typography.titleLarge)
                    Text(audio.artist, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(audioTime(audio.durationMs), style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = {
                    if (plays) player.pause() else {
                        player.setMediaItem(MediaItem.fromUri(audio.previewUrl())); player.prepare(); player.play()
                    }
                }) { Icon(if (plays) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, "Listen to audio") }
            }
            if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
            Button(onClick = onCreate, modifier = Modifier.fillMaxWidth()) { Text("Create post with") }
            OutlinedButton(enabled = !busy && saved != null, onClick = {
                busy = true; error = null
                scope.launch {
                    try { client.save(audio.trackId, saved != true); saved = saved != true }
                    catch (failure: Exception) { error = failure.message }
                    finally { busy = false }
                }
            }, modifier = Modifier.fillMaxWidth()) {
                Icon(if (saved == true) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, null)
                Spacer(Modifier.width(8.dp)); Text(if (saved == true) "Saved" else "Save")
            }
            Spacer(Modifier.navigationBarsPadding())
        }
    }
}
