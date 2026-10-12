package com.sautilink.nativeapp.feature.profile

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.PostInteractionsClient
import com.sautilink.nativeapp.feature.home.PostMediaGallery
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val activityTabs = listOf(
    "posts" to "Posts", "reposts" to "Reposts", "replies" to "Comments",
    "likes" to "Likes", "saves" to "Saves", "hashtags" to "Hashtags"
)

/** Web-parity profile categories from the same authorization-aware server RPCs. */
@Composable
internal fun ProfileActivitySection(
    auth: StagingAuthClient,
    profile: NativeProfile,
    owner: Boolean,
    refreshKey: Int,
    onOpenPost: (String) -> Unit,
    onManagePosts: () -> Unit,
    onOpenProfile: (String) -> Unit
) {
    val client = remember(auth) { NativeProfileActivityClient(auth) }
    var state by remember(profile.id) { mutableStateOf<ProfileActivityState?>(null) }
    var selected by remember(profile.id) { mutableStateOf("posts") }
    var entries by remember(profile.id) { mutableStateOf<List<ProfileActivityEntry>>(emptyList()) }
    var pinned by remember(profile.id) { mutableStateOf<List<ProfileActivityEntry>>(emptyList()) }
    var hashtags by remember(profile.id) { mutableStateOf<List<ProfileHashtag>>(emptyList()) }
    var busy by remember(profile.id) { mutableStateOf(true) }
    var error by remember(profile.id) { mutableStateOf<String?>(null) }
    var revision by remember(profile.id) { mutableIntStateOf(0) }
    var privacyDialog by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(client, profile.id, refreshKey, revision) {
        try {
            val next = client.state(profile.username)
            state = next
            if (next.allowed[selected] != true) selected = "posts"
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load profile categories."; busy = false }
    }
    LaunchedEffect(client, profile.id, selected, revision, refreshKey, state) {
        val permissions = state ?: return@LaunchedEffect
        if (permissions.allowed[selected] != true) return@LaunchedEffect
        busy = true
        error = null
        try {
            // Fetch pins separately, just as the web does, without duplicating posts in the feed.
            val feed = client.entries(profile.username, selected)
            val pins = if (selected == "posts") client.entries(profile.username, "pins").entries else emptyList()
            pinned = pins
            val excluded = pins.map { it.id }.toSet()
            entries = feed.entries.filter { it.id !in excluded }
            hashtags = feed.hashtags
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load profile activity." }
        finally { busy = false }
    }

    val permissions = state
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (owner && permissions?.owner == true) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                OutlinedButton(
                    onClick = { privacyDialog = true },
                    modifier = Modifier.heightIn(min = 44.dp),
                    shape = RoundedCornerShape(24.dp)
                ) {
                    Icon(Icons.Rounded.AdminPanelSettings, contentDescription = null,
                        modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Activity privacy")
                }
            }
        }
        if (permissions != null) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                activityTabs.filter { permissions.allowed[it.first] == true }.forEach { (tab, title) ->
                    val icon = when (tab) {
                        "posts" -> Icons.Rounded.Article
                        "reposts" -> Icons.Rounded.Repeat
                        "replies" -> Icons.Rounded.ChatBubbleOutline
                        "likes" -> Icons.Rounded.FavoriteBorder
                        "saves" -> Icons.Rounded.BookmarkBorder
                        else -> Icons.Rounded.Tag
                    }
                    val active = selected == tab
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        TextButton(onClick = { selected = tab }, modifier = Modifier.heightIn(min = 48.dp),
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = if (active) MaterialTheme.colorScheme.onSurface
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                            )) {
                            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(5.dp))
                            Text(title, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                        }
                        Box(Modifier.width(65.dp).height(3.dp).clip(RoundedCornerShape(3.dp))
                            .then(if (active) Modifier.then(
                                Modifier
                            ) else Modifier)) {
                            if (active) Surface(
                                modifier = Modifier.fillMaxSize(),
                                color = SautiColors.Red,
                                shape = RoundedCornerShape(3.dp)
                            ) {}
                        }
                    }
                }
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error != null) {
            Text(error.orEmpty(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { revision++ }) { Text("Try again") }
        }
        if (!busy && error == null) {
            if (selected == "posts" && pinned.isNotEmpty()) {
                Text("Pinned", fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.labelLarge)
                pinned.forEach { item ->
                    ProfileActivityCard(
                        auth, item, owner, onOpenPost, onManagePosts, onOpenProfile,
                        onTogglePin = { itemId, next ->
                            scope.launch {
                                try { client.setPinned(itemId, next); revision++ }
                                catch (e: Exception) { error = e.message ?: "Could not update pinned post." }
                            }
                        }
                    )
                }
            }
            if (selected == "hashtags") {
                hashtags.forEach { tag ->
                    Surface(shape = RoundedCornerShape(15.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Row(Modifier.fillMaxWidth().padding(16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("#${tag.label}", style = MaterialTheme.typography.titleMedium)
                            Text("${tag.count} uses",
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            } else {
                entries.forEach { item ->
                    ProfileActivityCard(
                        auth, item, owner, onOpenPost, onManagePosts, onOpenProfile,
                        onTogglePin = { itemId, next ->
                            scope.launch {
                                try { client.setPinned(itemId, next); revision++ }
                                catch (e: Exception) { error = e.message ?: "Could not update pinned post." }
                            }
                        }
                    )
                }
            }
            if (entries.isEmpty() && pinned.isEmpty() && hashtags.isEmpty()) {
                Text("Nothing to show here yet.",
                    modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    if (privacyDialog && permissions?.owner == true) {
        var likes by remember(privacyDialog) { mutableStateOf(permissions.likesPrivacy) }
        var saves by remember(privacyDialog) { mutableStateOf(permissions.savesPrivacy) }
        var tags by remember(privacyDialog) { mutableStateOf(permissions.hashtagsPrivacy) }
        var saving by remember { mutableStateOf(false) }
        var saveError by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { if (!saving) privacyDialog = false },
            title = { Text("Activity privacy") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Choose who can see your Likes, Saves and Hashtags. Posts and comments follow their own audience settings.",
                        style = MaterialTheme.typography.bodySmall)
                    ActivityVisibilityPicker("Likes", likes) { likes = it }
                    ActivityVisibilityPicker("Saves", saves) { saves = it }
                    ActivityVisibilityPicker("Hashtags", tags) { tags = it }
                    if (saveError != null) Text(saveError.orEmpty(),
                        color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    saving = true
                    scope.launch {
                        try {
                            client.savePrivacy(likes, saves, tags)
                            privacyDialog = false
                            revision++
                        } catch (e: Exception) {
                            saveError = e.message ?: "Could not update activity privacy."
                        } finally { saving = false }
                    }
                }) { Text(if (saving) "Saving…" else "Save") }
            },
            dismissButton = {
                TextButton(enabled = !saving, onClick = { privacyDialog = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun ActivityVisibilityPicker(label: String, value: String, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, fontWeight = FontWeight.SemiBold)
        Box {
            OutlinedButton(onClick = { open = true }, shape = RoundedCornerShape(12.dp)) {
                Text(when (value) { "public" -> "Public"; "followers" -> "Followers"; else -> "Only you" })
                Spacer(Modifier.width(7.dp))
                Icon(Icons.Rounded.ArrowDropDown, null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                listOf("public" to "Public", "followers" to "Followers", "private" to "Only you")
                    .forEach { (key, title) ->
                        DropdownMenuItem(text = { Text(title) }, onClick = {
                            onSelect(key)
                            open = false
                        })
                    }
            }
        }
    }
}

@Composable
private fun ProfileActivityCard(
    auth: StagingAuthClient,
    item: ProfileActivityEntry,
    owner: Boolean,
    onOpenPost: (String) -> Unit,
    onManagePosts: () -> Unit,
    onOpenProfile: (String) -> Unit,
    onTogglePin: (String, Boolean) -> Unit
) {
    val actions = remember(auth) { PostInteractionsClient(auth) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var liked by remember(item.id, item.liked) { mutableStateOf(item.liked) }
    var saved by remember(item.id, item.saved) { mutableStateOf(item.saved) }
    var reposted by remember(item.id, item.reposted) { mutableStateOf(item.reposted) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val initials = item.authorName.split(" ").filter { it.isNotBlank() }.take(2)
        .map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }

    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                val goodHandle = Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(item.authorHandle)
                if (item.hasAvatar && goodHandle) {
                    AuthorizedImage(auth,
                        route = "/api/profile-media/${item.authorHandle}/avatar",
                        description = "Avatar",
                        modifier = Modifier.size(42.dp).clip(CircleShape),
                        fallback = { SautiAvatar(initials, Modifier.size(42.dp), SautiColors.Blue) })
                } else SautiAvatar(initials, Modifier.size(42.dp), SautiColors.Blue)
                Column(Modifier.weight(1f).clickable(enabled = goodHandle) {
                    onOpenProfile(item.authorHandle)
                }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.authorName, style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold, maxLines = 1,
                            overflow = TextOverflow.Ellipsis)
                        Spacer(Modifier.width(4.dp))
                        SautiVerificationBadge(item.verified, item.badgeType,
                            item.authorName, size = 14.dp)
                    }
                    Text("@${item.authorHandle} · ${relativePostTime(item.postedAt)}",
                        style = MaterialTheme.typography.bodySmall, maxLines = 1,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (owner && item.authorId == auth.account?.id) {
                    if (item.body.isNotBlank()) TextButton(onClick = onManagePosts) {
                        Text("Edit", style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = { onTogglePin(item.id, !item.pinned) },
                        modifier = Modifier.size(48.dp)) {
                        Icon(if (item.pinned) Icons.Rounded.PushPin else Icons.Rounded.PushPin,
                            contentDescription = if (item.pinned) "Unpin post" else "Pin post",
                            tint = if (item.pinned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (item.pinned) Text("Pinned", style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 14.dp))
            if (item.body.isNotBlank()) Text(item.body, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth().clickable { onOpenPost(item.id) }
                    .padding(horizontal = 14.dp, vertical = 4.dp))
            if (item.media.isNotEmpty()) PostMediaGallery(auth, item.media)
            if (failure != null) Text(failure.orEmpty(), color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 14.dp), style = MaterialTheme.typography.bodySmall)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                ProfileAction(Icons.Rounded.ChatBubbleOutline, item.comments.toString(), "Comments",
                    Modifier.weight(1f)) { onOpenPost(item.id) }
                ProfileAction(Icons.Rounded.Repeat, item.reposts.toString(), "Repost",
                    Modifier.weight(1f), selected = reposted) {
                    if (!busy) {
                        busy = true; failure = null
                        scope.launch {
                            try { actions.setRepost(item.id, !reposted); reposted = !reposted }
                            catch (e: Exception) { failure = e.message }
                            finally { busy = false }
                        }
                    }
                }
                ProfileAction(
                    if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    item.likes.toString(), "Like", Modifier.weight(1f), selected = liked,
                    activeColor = SautiColors.Red
                ) {
                    if (!busy) {
                        busy = true; failure = null
                        scope.launch {
                            try { actions.setLike(item.id, !liked); liked = !liked }
                            catch (e: Exception) { failure = e.message }
                            finally { busy = false }
                        }
                    }
                }
                IconButton(onClick = {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, actions.postShareUrl(item.id))
                    }
                    runCatching { context.startActivity(Intent.createChooser(send, "Share post")) }
                        .onFailure { failure = "Could not open sharing." }
                }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.Share, contentDescription = "Share post", modifier = Modifier.size(21.dp))
                }
                IconButton(onClick = {
                    if (!busy) {
                        busy = true; failure = null
                        scope.launch {
                            try { actions.setSaved(item.id, !saved); saved = !saved }
                            catch (e: Exception) { failure = e.message }
                            finally { busy = false }
                        }
                    }
                }, enabled = !busy, modifier = Modifier.size(48.dp)) {
                    Icon(if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                        contentDescription = if (saved) "Remove from saved" else "Save post",
                        modifier = Modifier.size(21.dp))
                }
            }
        }
    }
}

@Composable
private fun ProfileAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector, count: String, description: String,
    modifier: Modifier = Modifier, selected: Boolean = false,
    activeColor: Color = MaterialTheme.colorScheme.primary, onClick: () -> Unit
) {
    Row(modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center) {
        Icon(icon, description, modifier = Modifier.size(20.dp),
            tint = if (selected) activeColor else MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(4.dp))
        Text(count, style = MaterialTheme.typography.labelSmall)
    }
}
