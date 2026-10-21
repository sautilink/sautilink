package com.sautilink.nativeapp.feature.stories

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
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
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.profile.NativeProfilesClient
import com.sautilink.nativeapp.feature.profile.NativeProfile
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException

internal val StoryGradient = Brush.linearGradient(listOf(Color(0xFFFF6A32), Color(0xFFFF225B)))
internal data class NativeStoryPresence(val usernames: Set<String> = emptySet(), val open: (String) -> Unit = {})
internal val LocalNativeStoryPresence = staticCompositionLocalOf { NativeStoryPresence() }

@Composable
internal fun StoryProfileAvatarRing(username: String, modifier: Modifier = Modifier,
    content: @Composable () -> Unit) {
    val presence = LocalNativeStoryPresence.current
    StoryAvatarRing(username in presence.usernames, { presence.open(username) }, modifier, content)
}

@Composable
internal fun StoriesButton(unreadCount: Int, onClick: () -> Unit) {
    BadgedBox(badge = { if (unreadCount > 0) Badge { Text(if (unreadCount > 99) "99+" else "$unreadCount") } }) {
        IconButton(onClick = onClick, modifier = Modifier.size(48.dp)) {
            Icon(NativeStoriesIcon, "Stories${if (unreadCount > 0) ", $unreadCount unwatched" else ""}",
                Modifier.size(25.dp), tint = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
internal fun StoryAvatarRing(active: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier,
    content: @Composable () -> Unit) {
    Box(modifier.then(if (active) Modifier.border(2.5.dp, StoryGradient, CircleShape).padding(4.dp)
        .clickable(onClickLabel = "View stories", onClick = onOpen) else Modifier), contentAlignment = Alignment.Center) { content() }
}

@Composable
internal fun NativeStoriesScreen(auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit, onChanged: () -> Unit = {}, initialStoryId: String? = null,
    initialUsername: String? = null) {
    val accountId = auth.account?.id
    val client = remember(auth) { NativeStoriesClient(auth) }
    var feed by remember(accountId) { mutableStateOf(NativeStoriesFeed()) }
    var refresh by remember(accountId) { mutableIntStateOf(0) }
    var loading by remember(accountId) { mutableStateOf(true) }
    var error by remember(accountId) { mutableStateOf<String?>(null) }
    var selected by remember(accountId) { mutableStateOf<String?>(null) }
    var create by remember(accountId) { mutableStateOf(false) }
    var ownProfile by remember(accountId) { mutableStateOf<NativeProfile?>(null) }
    LaunchedEffect(accountId) {
        if (accountId == null) return@LaunchedEffect
        try {
            val result = NativeProfilesClient(auth).own()
            if (auth.account?.id == accountId) ownProfile = result
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* The Create tile works even while its optional portrait is unavailable. */ }
    }
    var initialConsumed by remember(accountId, initialStoryId, initialUsername) { mutableStateOf(false) }
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(1_000); clock = System.currentTimeMillis() } }
    LaunchedEffect(accountId, refresh) {
        if (accountId == null) { loading = false; return@LaunchedEffect }
        loading = true; error = null
        try {
            var loaded = client.feed()
            if (!initialConsumed && initialStoryId != null) {
                val extra = client.story(initialStoryId)
                val existing = loaded.groups.firstOrNull { it.author.id == extra.author.id }
                val merged = extra.copy(stories = (existing?.stories.orEmpty() + extra.stories).distinctBy { it.id }.sortedBy { it.createdAt })
                loaded = loaded.copy(groups = loaded.groups.filterNot { it.author.id == extra.author.id } + merged)
                selected = initialStoryId
            } else if (!initialConsumed && initialUsername != null) {
                val extra = client.profile(initialUsername)
                if (extra != null) {
                    loaded = loaded.copy(groups = loaded.groups.filterNot { it.author.id == extra.author.id } + extra)
                    selected = extra.stories.firstOrNull()?.id
                }
            }
            if (auth.account?.id == accountId) { feed = loaded; initialConsumed = true }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Stories could not load. Try again." }
        finally { loading = false }
    }
    val groups = feed.activeGroups(clock).sortedBy { if (it.author.id == accountId) 0 else 1 }
    val storyItems = groups.flatMap { group -> group.stories.map { group.author to it } }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Stories", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, "Refresh stories") }
            IconButton(onClick = { create = true }, enabled = accountId != null) { Icon(Icons.Rounded.Add, "Create story", tint = MaterialTheme.colorScheme.primary) }
        }
        Text("Little moments. Available for 24 hours.", Modifier.padding(horizontal = 20.dp).padding(bottom = 14.dp),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (accountId == null) {
            Column(Modifier.padding(24.dp)) { Text("Sign in to watch and share stories."); Button(onClick = onSignIn) { Text("Sign in") } }
        } else {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(error.orEmpty(), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { refresh++ }) { Text("Retry") }
            }
            LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item(key = "create") {
                    Surface(onClick = { create = true }, shape = RoundedCornerShape(22.dp),
                        color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.height(235.dp)) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(Modifier.fillMaxWidth().height(142.dp).background(StoryGradient), contentAlignment = Alignment.Center) {
                                ownProfile?.takeIf { it.hasAvatar }?.let {
                                    AuthorizedImage(auth, "/api/profile-media/${it.username}/avatar", "Your story portrait", Modifier.fillMaxSize())
                                }
                                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .4f)))))
                                Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp).size(45.dp).clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Rounded.Add, null, Modifier.size(28.dp), tint = Color.White)
                                }
                            }
                            Column(Modifier.padding(horizontal = 10.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("Create story", fontWeight = FontWeight.SemiBold)
                                Text("Photos or 30s videos", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("${(4 - feed.quota.imagesUsed).coerceAtLeast(0)} photos · ${(2 - feed.quota.videosUsed).coerceAtLeast(0)} videos left",
                                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                items(groups, key = { it.author.id }) { group ->
                    val first = group.stories.firstOrNull { !it.seen } ?: group.stories.first()
                    StoryPreviewCard(auth, group, first, group.author.id == accountId) { selected = first.id }
                }
            }
        }
    }
    if (create) NativeStoryComposer(auth, feed.quota, onClose = { create = false }, onPublished = {
        create = false; refresh++; onChanged()
    })
    selected?.let { id ->
        if (storyItems.any { it.second.id == id }) NativeStoryViewer(auth, storyItems, id, feed.serverOffsetMs,
            onClose = { selected = null; refresh++; onChanged() }, onOpenProfile = { handle -> selected = null; onOpenProfile(handle) },
            onChanged = { refresh++; onChanged() })
        else if (!loading) LaunchedEffect(id) { selected = null }
    }
}

@Composable
private fun StoryPreviewCard(auth: StagingAuthClient, group: NativeStoryGroup, story: NativeStory, own: Boolean, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(235.dp).clip(RoundedCornerShape(22.dp))
        .background(MaterialTheme.colorScheme.surfaceContainerHighest).clickable(onClick = onClick)) {
        val previewPath = story.thumbnailPath.ifBlank { if (story.kind == "image") story.mediaPath else "" }
        if (previewPath.isNotBlank()) AuthorizedImage(auth, previewPath, "${group.author.displayName}'s story", Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .08f), Color.Transparent, Color.Black.copy(alpha = .8f)))))
        Box(Modifier.padding(12.dp).align(Alignment.TopStart)) {
            StoryAvatarRing(active = group.unseenCount > 0, onOpen = onClick) { StoryAuthorAvatar(auth, group.author, Modifier.size(42.dp)) }
        }
        Column(Modifier.align(Alignment.BottomStart).padding(13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (own) "Your story" else group.author.displayName, color = Color.White, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f, fill = false), maxLines = 2, overflow = TextOverflow.Ellipsis)
                SautiVerificationBadge(group.author.verified, group.author.badgeType, group.author.displayName, size = 15.dp, interactive = false)
            }
            Text("${group.stories.size} ${if (group.stories.size == 1) "moment" else "moments"}", color = Color.White.copy(alpha = .8f), style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
internal fun StoryAuthorAvatar(auth: StagingAuthClient, author: NativeStoryAuthor, modifier: Modifier = Modifier) {
    val initials = author.displayName.split(' ').filter { it.isNotBlank() }.take(2).map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }
    if (author.hasAvatar) AuthorizedImage(auth, "/api/profile-media/${author.username}/avatar", "${author.displayName} profile picture",
        modifier.clip(CircleShape), fallback = { SautiAvatar(initials, modifier, SautiColors.Blue) })
    else SautiAvatar(initials, modifier, SautiColors.Blue)
}
