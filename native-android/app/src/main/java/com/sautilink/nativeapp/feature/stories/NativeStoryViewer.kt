package com.sautilink.nativeapp.feature.stories

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.components.NativeStoryVideo
import com.sautilink.nativeapp.ui.components.NativeStoryPlaybackWindow
import com.sautilink.nativeapp.ui.components.rememberNativePlaybackSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeStoryViewer(auth: StagingAuthClient, stories: List<Pair<NativeStoryAuthor, NativeStory>>,
    initialId: String, serverOffsetMs: Long, onClose: () -> Unit, onOpenProfile: (String) -> Unit,
    onChanged: () -> Unit) {
    val accountId = auth.account?.id
    val client = remember(auth) { NativeStoriesClient(auth) }
    val scope = rememberCoroutineScope()
    var currentId by remember(accountId, initialId) { mutableStateOf(initialId) }
    val index = stories.indexOfFirst { it.second.id == currentId }
    val entry = stories.getOrNull(index)
    if (entry == null || accountId == null) { LaunchedEffect(Unit) { onClose() }; return }
    val (author, story) = entry
    val owner = story.ownerId == accountId
    var held by remember(currentId) { mutableStateOf(false) }
    var manuallyPaused by remember(currentId) { mutableStateOf(false) }
    var ready by remember(currentId) { mutableStateOf(false) }
    var mediaRetry by remember(currentId) { mutableIntStateOf(0) }
    var position by remember(currentId) { mutableLongStateOf(0L) }
    var duration by remember(currentId) { mutableLongStateOf(if (story.kind == "image") NativeStoryPolicy.PHOTO_DISPLAY_MS else story.durationMs) }
    var reaction by remember(currentId, story.reaction) { mutableStateOf(story.reaction) }
    var busy by remember(currentId) { mutableStateOf(false) }
    var error by remember(currentId) { mutableStateOf<String?>(null) }
    var actionError by remember(currentId) { mutableStateOf<String?>(null) }
    var options by remember(currentId) { mutableStateOf(false) }
    var delete by remember(currentId) { mutableStateOf(false) }
    var edit by remember(currentId) { mutableStateOf(false) }
    var caption by remember(currentId, story.caption) { mutableStateOf(story.caption) }
    var viewers by remember(currentId) { mutableStateOf(false) }
    var viewerCount by remember(currentId, story.viewerCount) { mutableIntStateOf(story.viewerCount) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val foreground = lifecycle.isAtLeast(Lifecycle.State.RESUMED)
    val paused = held || manuallyPaused || options || delete || edit || viewers || busy || !foreground
    val playbackWindow = remember(auth, accountId) { NativeStoryPlaybackWindow() }
    val currentPlayback = if (story.kind == "video") playbackWindow.forStory(story.id) else null
    val nextVideo = stories.getOrNull(index + 1)?.second?.takeIf {
        it.kind == "video" && NativeStoryPolicy.active(it.expiresAt, System.currentTimeMillis() + serverOffsetMs)
    }
    if (nextVideo != null) key(nextVideo.id) {
        val nextPlayback = playbackWindow.forStory(nextVideo.id)
        // Wait for current media's first frame before one bounded metadata-only
        // warm-up. Pause/background/navigation cancels it; no second video loads.
        rememberNativePlaybackSource(auth, nextVideo.id, nextVideo.playbackPath,
            enabled = foreground && ready && !paused && error == null, retainedRead = nextPlayback)
    }
    fun advance() {
        val next = NativeStoryPolicy.next(index, stories.size)
        if (next == null) onClose() else currentId = stories[next].second.id
    }
    LaunchedEffect(currentId) {
        while (true) {
            if (!NativeStoryPolicy.active(story.expiresAt, System.currentTimeMillis() + serverOffsetMs)) {
                error = "This story has expired."; ready = false; return@LaunchedEffect
            }
            delay(1_000)
        }
    }
    LaunchedEffect(currentId, ready, paused) {
        if (story.kind != "image" || !ready || paused || error != null) return@LaunchedEffect
        var last = android.os.SystemClock.elapsedRealtime()
        while (true) {
            delay(40)
            val now = android.os.SystemClock.elapsedRealtime()
            position = (position + (now - last)).coerceAtMost(duration)
            last = now
            if (position >= duration) { advance(); break }
        }
    }
    LaunchedEffect(currentId, ready) {
        if (!ready || owner) return@LaunchedEffect
        delay(500)
        try { client.markViewed(story.id) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* Viewing remains usable; no fabricated viewer count. */ }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false,
        decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding()) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val width = constraints.maxWidth
                Box(Modifier.fillMaxSize().pointerInput(story.id) {
                    detectTapGestures(onPress = {
                        held = true
                        try { tryAwaitRelease() } finally { held = false }
                    }, onTap = { point ->
                        if (point.x < width * .3f) currentId = stories[NativeStoryPolicy.previous(index, stories.size)].second.id
                        else advance()
                    })
                }) {
                    key(story.id, mediaRetry) {
                    if (story.kind == "video" && error == null) {
                        if (!ready && story.thumbnailPath.isNotBlank()) AuthorizedImage(auth, story.thumbnailPath,
                            "Story video preview", Modifier.fillMaxSize(), crop = false)
                        NativeStoryVideo(auth, story.id, story.playbackPath,
                            active = foreground, paused = paused, modifier = Modifier.fillMaxSize(),
                            onProgress = { actual, total -> position = actual; if (total > 0) duration = total },
                            onEnded = { if (!paused) advance() }, onError = { error = it }, onReady = { ready = true },
                            playbackRead = currentPlayback)
                    }
                    else if (story.kind == "image" && error == null) AuthorizedImage(auth, story.mediaPath,
                        "${author.displayName}'s story", Modifier.fillMaxSize(), crop = false, onReady = { ready = true })
                    }
                }
            }
            Column(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .75f), Color.Transparent)))
                .padding(horizontal = 12.dp, vertical = 10.dp)) {
                val authorStories = stories.filter { it.first.id == author.id }.map { it.second }
                val localIndex = authorStories.indexOfFirst { it.id == story.id }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    authorStories.forEachIndexed { itemIndex, _ ->
                        LinearProgressIndicator(progress = { when { itemIndex < localIndex -> 1f; itemIndex > localIndex -> 0f; else -> NativeStoryPolicy.progress(position, duration) } },
                            modifier = Modifier.weight(1f).height(3.dp), color = Color.White, trackColor = Color.White.copy(alpha = .3f), gapSize = 0.dp)
                    }
                }
                Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StoryAuthorAvatar(auth, author, Modifier.size(38.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(if (owner) "Your story" else author.displayName, color = Color.White, fontWeight = FontWeight.SemiBold,
                                maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                            SautiVerificationBadge(author.verified, author.badgeType, author.displayName, size = 16.dp, interactive = false)
                        }
                        Text(relativePostTime(story.createdAt), color = Color.White.copy(alpha = .7f), style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = { manuallyPaused = !manuallyPaused }) { Icon(if (manuallyPaused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause,
                        if (manuallyPaused) "Resume story" else "Pause story", tint = Color.White) }
                    if (owner) IconButton(onClick = { options = true }) { Icon(Icons.Rounded.MoreHoriz, "Story options", tint = Color.White) }
                    IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close story", tint = Color.White) }
                }
            }
            if (!ready && error == null) CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
            if (error != null) Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(error.orEmpty(), color = Color.White)
                if (NativeStoryPolicy.active(story.expiresAt, System.currentTimeMillis() + serverOffsetMs)) {
                    TextButton(onClick = { error = null; ready = false; position = 0; mediaRetry++ }) { Text("Retry story", color = Color.White) }
                }
                TextButton(onClick = ::advance) { Text("Next story", color = Color.White) }
            }
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .8f))))
                .padding(horizontal = 20.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (caption.isNotBlank()) Text(caption, color = Color.White, style = MaterialTheme.typography.bodyLarge)
                if (actionError != null && !edit && !delete) Text(actionError.orEmpty(), color = Color(0xFFFFB4AB),
                    style = MaterialTheme.typography.bodySmall)
                if (owner) TextButton(onClick = { viewers = true }, enabled = !busy) {
                    Icon(Icons.Rounded.Visibility, null, tint = Color.White); Spacer(Modifier.width(8.dp))
                    Text("$viewerCount ${if (viewerCount == 1) "viewer" else "viewers"}", color = Color.White)
                } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("React to this story", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .8f), modifier = Modifier.weight(1f))
                    listOf("love", "dislike").forEach { value ->
                        FilledTonalIconButton(onClick = {
                            val next = NativeStoryPolicy.reaction(reaction, value)
                            busy = true; actionError = null; scope.launch {
                                try { reaction = client.react(story.id, next) }
                                catch (cancelled: CancellationException) { throw cancelled }
                                catch (failure: Exception) { actionError = failure.message ?: "Reaction could not be saved. Try again." }
                                finally { busy = false }
                            }
                        }, enabled = !busy && ready && error == null,
                            colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Color.White.copy(alpha = .15f))) {
                            Icon(if (value == "love") if (reaction == value) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder else Icons.Rounded.ThumbDownOffAlt,
                                if (value == "love") "Love story" else "Dislike story", tint = if (reaction == value) Color(0xFFFF4A71) else Color.White)
                        }
                    }
                }
            }
        }
    }
    if (options) ModalBottomSheet(onDismissRequest = { options = false }) {
        Text("Your story", Modifier.padding(horizontal = 24.dp, vertical = 12.dp), style = MaterialTheme.typography.titleLarge)
        TextButton(onClick = { options = false; edit = true }, Modifier.fillMaxWidth()) { Icon(Icons.Rounded.Edit, null); Spacer(Modifier.width(8.dp)); Text("Edit caption") }
        Text("The original 24-hour expiry stays the same.", Modifier.padding(horizontal = 24.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { options = false; delete = true }, Modifier.fillMaxWidth()) { Icon(Icons.Rounded.DeleteOutline, null); Spacer(Modifier.width(8.dp)); Text("Delete story") }
        Spacer(Modifier.height(24.dp))
    }
    if (edit) {
        var draft by remember(story.id) { mutableStateOf(caption) }
        AlertDialog(onDismissRequest = { if (!busy) edit = false }, title = { Text("Edit story") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = draft, onValueChange = { draft = it.take(NativeStoryPolicy.MAX_CAPTION) }, label = { Text("Caption") }, enabled = !busy)
                Text("Editing keeps the original expiry and daily quota.", style = MaterialTheme.typography.bodySmall)
                if (actionError != null) Text(actionError.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            } }, confirmButton = { TextButton(onClick = { busy = true; actionError = null; scope.launch {
                try { client.edit(story.id, draft); caption = draft.trim(); edit = false; onChanged() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { actionError = failure.message ?: "Caption could not be saved. Try again." }
                finally { busy = false }
            } }, enabled = !busy) { Text("Save") } }, dismissButton = { TextButton(onClick = { edit = false }, enabled = !busy) { Text("Cancel") } })
    }
    if (delete) AlertDialog(onDismissRequest = { if (!busy) delete = false }, title = { Text("Delete this story?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("It will no longer be available to viewers. Deleting does not reset your daily upload limit.")
            if (actionError != null) Text(actionError.orEmpty(), color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(onClick = { busy = true; actionError = null; scope.launch {
            try { client.delete(story.id); delete = false; onChanged(); onClose() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { actionError = failure.message ?: "Story could not be deleted. Try again." }
            finally { busy = false }
        } }, enabled = !busy) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { delete = false }, enabled = !busy) { Text("Cancel") } })
    if (viewers) StoryViewersSheet(auth, story.id, onClose = { viewers = false }, onTotal = { viewerCount = it }, onOpenProfile = onOpenProfile)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StoryViewersSheet(auth: StagingAuthClient, storyId: String, onClose: () -> Unit,
    onTotal: (Int) -> Unit, onOpenProfile: (String) -> Unit) {
    val client = remember(auth) { NativeStoriesClient(auth) }
    var items by remember(storyId, auth.account?.id) { mutableStateOf<List<NativeStoryViewer>>(emptyList()) }
    var cursor by remember(storyId) { mutableStateOf<String?>(null) }
    var requestedCursor by remember(storyId) { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(storyId, requestedCursor, refresh) {
        loading = true; error = null
        try {
            val page = client.viewers(storyId, requestedCursor)
            items = (if (requestedCursor == null) page.viewers else items + page.viewers).distinctBy { it.author.id }
            cursor = page.nextCursor; onTotal(page.total)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Viewers could not load." }
        finally { loading = false }
    }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(Modifier.fillMaxWidth().heightIn(min = 180.dp, max = (LocalConfiguration.current.screenHeightDp * .55f).dp)) {
            Text("Story viewers", Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) { Text(error.orEmpty(), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error); TextButton(onClick = { refresh++ }) { Text("Retry") } }
            if (!loading && items.isEmpty() && error == null) Text("No viewers yet.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(Modifier.weight(1f, fill = false)) {
                items(items, key = { it.author.id }) { row ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StoryAuthorAvatar(auth, row.author, Modifier.size(42.dp))
                        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(row.author.displayName, Modifier.weight(1f, fill = false), maxLines = 1, fontWeight = FontWeight.SemiBold)
                            SautiVerificationBadge(row.author.verified, row.author.badgeType, row.author.displayName, size = 15.dp, interactive = false)
                        }
                        OutlinedButton(onClick = { onClose(); onOpenProfile(row.author.username) }, contentPadding = PaddingValues(horizontal = 12.dp)) { Text("View profile", style = MaterialTheme.typography.labelSmall) }
                    }
                }
                if (cursor != null) item { TextButton(onClick = { requestedCursor = cursor }, enabled = !loading, modifier = Modifier.fillMaxWidth()) { Text("Load more") } }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
