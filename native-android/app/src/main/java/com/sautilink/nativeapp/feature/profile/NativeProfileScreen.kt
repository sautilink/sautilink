package com.sautilink.nativeapp.feature.profile

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.safety.MemberSafetyState
import com.sautilink.nativeapp.feature.safety.NativeReportDialog
import com.sautilink.nativeapp.feature.safety.NativeSafetyClient
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch
import java.net.URI

/** Live profile for the owner or a discoverable member. Other users' connection lists stay private. */
@Composable
fun NativeProfileScreen(
    auth: StagingAuthClient,
    username: String? = null,
    onBack: (() -> Unit)? = null,
    onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit = {},
    onOpenPosts: () -> Unit = {}
) {
    val client = remember(auth) { NativeProfilesClient(auth) }
    val safety = remember(auth) { NativeSafetyClient(auth) }
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val account = auth.account
    val ownerRoute = username == null
    var refresh by remember(username, account?.id) { mutableIntStateOf(0) }
    var profile by remember(username, account?.id) { mutableStateOf<NativeProfile?>(null) }
    var loading by remember(username, account?.id) { mutableStateOf(false) }
    var loaded by remember(username, account?.id) { mutableStateOf(false) }
    var error by remember(username, account?.id) { mutableStateOf<String?>(null) }
    var edit by remember(username, account?.id) { mutableStateOf(false) }
    var connectionList by remember(username, account?.id) { mutableStateOf<String?>(null) }
    var connections by remember(username, account?.id) { mutableStateOf<List<NativeProfile>>(emptyList()) }
    var listLoading by remember(username, account?.id) { mutableStateOf(false) }
    var listError by remember(username, account?.id) { mutableStateOf<String?>(null) }
    var following by remember(username, account?.id) { mutableStateOf<Boolean?>(null) }
    var followBusy by remember(username, account?.id) { mutableStateOf(false) }
    var actionError by remember(username, account?.id) { mutableStateOf<String?>(null) }
    var safetyState by remember(username, account?.id) { mutableStateOf<MemberSafetyState?>(null) }
    var safetyBusy by remember(username, account?.id) { mutableStateOf(false) }
    var reportOpen by remember(username, account?.id) { mutableStateOf(false) }
    var blockConfirm by remember(username, account?.id) { mutableStateOf(false) }
    var safetyNote by remember(username, account?.id) { mutableStateOf<String?>(null) }

    BackHandler(edit || connectionList != null) {
        if (edit) edit = false else connectionList = null
    }

    LaunchedEffect(auth, account?.id, username, refresh) {
        if (account == null) return@LaunchedEffect
        loading = true
        error = null
        try {
            val result = if (ownerRoute) client.own() else client.byHandle(username)
            profile = result
            following = if (result != null && result.id != account.id) client.following(result.id) else null
            loaded = true
        } catch (e: Exception) {
            error = e.message ?: "Could not load profile."
        } finally { loading = false }
    }

    LaunchedEffect(auth, account?.id, connectionList, refresh) {
        val kind = connectionList ?: return@LaunchedEffect
        if (!ownerRoute || account == null) return@LaunchedEffect
        listLoading = true
        listError = null
        try { connections = client.ownConnections(kind) }
        catch (e: Exception) { listError = e.message ?: "Could not load connections." }
        finally { listLoading = false }
    }

    LaunchedEffect(auth, account?.id, profile?.id, refresh) {
        val member = profile ?: return@LaunchedEffect
        if (account == null || member.id == account.id) { safetyState = null; return@LaunchedEffect }
        try { safetyState = safety.memberState(member.username) }
        catch (e: Exception) { actionError = e.message ?: "Could not load safety controls." }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
        .verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null || edit || connectionList != null) {
                IconButton(onClick = {
                    when {
                        edit -> edit = false
                        connectionList != null -> connectionList = null
                        else -> onBack?.invoke()
                    }
                }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            }
            Text(when {
                edit -> "Edit profile"
                connectionList != null -> connectionList!!.replaceFirstChar { it.uppercase() }
                ownerRoute -> "My profile"
                else -> "Profile"
            }, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            if (!edit && account != null) {
                IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, "Refresh profile") }
            }
        }

        if (account == null) {
            when (auth.sessionState) {
                StagingSessionState.CHECKING -> CircularProgressIndicator()
                else -> {
                    Text("Sign in to view SautiLink profiles.")
                    Button(onClick = onSignIn, shape = SautiShape.Pill) { Text("Sign in") }
                }
            }
        } else if (connectionList != null) {
            Text("Accounts visible to you", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (listLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (listError != null) ProfileNotice(listError.orEmpty())
            if (!listLoading && listError == null && connections.isEmpty()) Text("No ${connectionList} yet.")
            connections.forEach { member ->
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer,
                    modifier = Modifier.fillMaxWidth().clickable { onOpenProfile(member.username) }) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ProfileAvatar(auth, member, 42)
                        Column {
                            Text(member.displayName, style = MaterialTheme.typography.titleMedium)
                            Text("@${member.username}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (connections.size >= 100) Text("Showing the latest 100 connections.", style = MaterialTheme.typography.bodySmall)
        } else {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) ProfileNotice(error.orEmpty())
            if (!loading && loaded && profile == null && error == null) {
                ProfileNotice(if (ownerRoute) "Your social profile is still being prepared."
                    else "This profile is unavailable or is not discoverable.")
            }
            profile?.let { member ->
                val websiteLink = remember(member.website) {
                    runCatching { URI(member.website) }.getOrNull()?.takeIf {
                        it.scheme in listOf("http", "https") && !it.host.isNullOrBlank() && it.userInfo == null
                    }?.toString()
                }
                if (edit) {
                    ProfileEditor(member, saving = followBusy, onCancel = { edit = false }) { values ->
                        followBusy = true
                        actionError = null
                        scope.launch {
                            try { profile = client.save(values); edit = false }
                            catch (e: Exception) { actionError = e.message ?: "Could not save profile." }
                            finally { followBusy = false }
                        }
                    }
                    if (actionError != null) ProfileNotice(actionError.orEmpty())
                    HorizontalDivider()
                    IdentityEditor(client, member, onChanged = { edit = false; refresh++ })
                } else {
                    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            ProfileAvatar(auth, member, 72)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(member.displayName, style = MaterialTheme.typography.headlineMedium,
                                    modifier = Modifier.weight(1f))
                                if (member.verified) Icon(Icons.Rounded.Verified, "Verified account",
                                    tint = MaterialTheme.colorScheme.primary)
                            }
                            Text("@${member.username}", color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.titleMedium)
                            Text(member.bio.ifBlank { if (ownerRoute) "Add a bio to introduce yourself." else "No bio yet." })
                            if (member.location.isNotBlank()) Text("📍 ${member.location}")
                            if (websiteLink != null) Text(websiteLink,
                                modifier = Modifier.clickable { runCatching { uriHandler.openUri(websiteLink) } },
                                color = MaterialTheme.colorScheme.primary)
                            Text(if (member.discoverable) "Discoverable profile" else "Visible by direct access",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (member.joinedAt.isNotBlank()) Text("Joined ${member.joinedAt.take(10)}",
                                style = MaterialTheme.typography.bodySmall)
                            HorizontalDivider()
                            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                                Column(Modifier.then(if (ownerRoute) Modifier.clickable { connectionList = "followers" } else Modifier)) {
                                    Text("${member.followers}", fontWeight = FontWeight.Bold)
                                    Text("Followers", style = MaterialTheme.typography.bodySmall)
                                }
                                Column(Modifier.then(if (ownerRoute) Modifier.clickable { connectionList = "following" } else Modifier)) {
                                    Text("${member.following}", fontWeight = FontWeight.Bold)
                                    Text("Following", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            if (ownerRoute) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = { actionError = null; edit = true }, shape = SautiShape.Pill) {
                                        Icon(Icons.Rounded.Edit, null, Modifier.size(16.dp))
                                        Spacer(Modifier.width(7.dp)); Text("Edit profile")
                                    }
                                    OutlinedButton(onClick = onOpenPosts, shape = SautiShape.Pill) { Text("My posts") }
                                }
                            } else if (member.id != account.id) {
                                Button(onClick = {
                                    val desired = following != true
                                    followBusy = true; actionError = null
                                    scope.launch {
                                        try {
                                            client.setFollowing(member, desired)
                                            following = client.following(member.id)
                                            refresh++
                                        } catch (e: Exception) { actionError = e.message ?: "Could not change Follow." }
                                        finally { followBusy = false }
                                    }
                                }, enabled = !followBusy && following != null && safetyState?.blocked != true,
                                    shape = SautiShape.Pill) {
                                    Text(if (following == true) "Following" else "Follow")
                                }
                            }
                        }
                    }
                    if (!ownerRoute && member.id != account.id) {
                        Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                            Column(Modifier.fillMaxWidth().padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Safety controls", style = MaterialTheme.typography.titleMedium)
                                Text("Mute hides this member's activity. Block prevents interaction.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = {
                                        val desired = safetyState?.muted != true
                                        safetyBusy = true; actionError = null; safetyNote = null
                                        scope.launch {
                                            try {
                                                safety.setMuted(member.username, desired)
                                                safetyState = safety.memberState(member.username)
                                                safetyNote = if (desired) "Member muted." else "Member unmuted."
                                            } catch (e: Exception) { actionError = e.message ?: "Could not change mute." }
                                            finally { safetyBusy = false }
                                        }
                                    }, enabled = !safetyBusy && safetyState != null && safetyState?.blocked != true) {
                                        Text(if (safetyState?.muted == true) "Unmute" else "Mute")
                                    }
                                    OutlinedButton(onClick = { blockConfirm = true },
                                        enabled = !safetyBusy && safetyState != null) {
                                        Text(if (safetyState?.blocked == true) "Unblock" else "Block")
                                    }
                                    TextButton(onClick = { actionError = null; reportOpen = true }, enabled = !safetyBusy) {
                                        Text("Report")
                                    }
                                }
                            }
                        }
                        if (safetyNote != null) Text(safetyNote.orEmpty(), color = MaterialTheme.colorScheme.primary)
                    }
                    if (actionError != null) ProfileNotice(actionError.orEmpty())
                }
            }
        }
    }

    if (blockConfirm && profile != null) AlertDialog(onDismissRequest = { blockConfirm = false },
        title = { Text(if (safetyState?.blocked == true) "Unblock member?" else "Block member?") },
        text = { Text(if (safetyState?.blocked == true) "Allow this member to interact with you again?"
            else "This member will no longer be able to interact with you. You can undo this in Settings.") },
        confirmButton = { TextButton(onClick = {
            val member = profile ?: return@TextButton
            val desired = safetyState?.blocked != true
            blockConfirm = false; safetyBusy = true; actionError = null
            scope.launch {
                try {
                    safety.setBlocked(member.username, desired)
                    safetyState = MemberSafetyState(desired, false)
                    if (desired) onBack?.invoke() else safetyNote = "Member unblocked."
                } catch (e: Exception) { actionError = e.message ?: "Could not change block." }
                finally { safetyBusy = false }
            }
        }) { Text(if (safetyState?.blocked == true) "Unblock" else "Block") } },
        dismissButton = { TextButton(onClick = { blockConfirm = false }) { Text("Cancel") } })

    if (reportOpen && profile != null) NativeReportDialog("profile", safetyBusy, error = actionError,
        onDismiss = { reportOpen = false }) { reason, details ->
        val member = profile ?: return@NativeReportDialog
        safetyBusy = true; actionError = null
        scope.launch {
            try { safety.report("profile", member.id, reason, details); reportOpen = false; safetyNote = "Report submitted." }
            catch (e: Exception) { actionError = e.message ?: "Could not send report." }
            finally { safetyBusy = false }
        }
    }
}

@Composable
private fun ProfileEditor(profile: NativeProfile, saving: Boolean, onCancel: () -> Unit, onSave: (ProfileEdit) -> Unit) {
    var bio by remember(profile.id) { mutableStateOf(profile.bio) }
    var location by remember(profile.id) { mutableStateOf(profile.location) }
    var website by remember(profile.id) { mutableStateOf(profile.website) }
    var discoverable by remember(profile.id) { mutableStateOf(profile.discoverable) }
    var validation by remember(profile.id) { mutableStateOf<String?>(null) }
    Text("@${profile.username} · Profile details",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(bio, { bio = it.take(501) }, label = { Text("Bio") },
        supportingText = { Text("${bio.length}/500") }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(location, { location = it.take(101) }, label = { Text("Location") },
        supportingText = { Text("${location.length}/100") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(website, { website = it.take(2049) }, label = { Text("Website (http:// or https://)") },
        modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Discoverable", modifier = Modifier.weight(1f))
        Switch(checked = discoverable, onCheckedChange = { discoverable = it })
    }
    Text("People can find and follow discoverable profiles.", style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (validation != null) ProfileNotice(validation.orEmpty())
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(onClick = onCancel, enabled = !saving) { Text("Cancel") }
        Button(onClick = {
            validation = when {
                bio.trim().length > 500 -> "Bio must be 500 characters or fewer."
                location.trim().length > 100 -> "Location must be 100 characters or fewer."
                website.trim().length > 2048 -> "Website must be 2,048 characters or fewer."
                else -> null
            }
            if (validation == null) onSave(ProfileEdit(bio, location, website, discoverable))
        }, enabled = !saving) { Text(if (saving) "Saving…" else "Save profile") }
    }
}

@Composable
private fun IdentityEditor(client: NativeProfilesClient, profile: NativeProfile, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var controls by remember(profile.id) { mutableStateOf<IdentityControls?>(null) }
    var name by remember(profile.id) { mutableStateOf(profile.displayName) }
    var username by remember(profile.id) { mutableStateOf(profile.username) }
    var busy by remember(profile.id) { mutableStateOf(false) }
    var message by remember(profile.id) { mutableStateOf<String?>(null) }
    LaunchedEffect(client, profile.id) {
        try { controls = client.identityControls() }
        catch (e: Exception) { message = e.message ?: "Identity controls are unavailable." }
    }
    Text("Name and username", style = MaterialTheme.typography.titleLarge)
    Text("Changes are limited by your account's identity policy.", style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (controls == null && message == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    controls?.let { state ->
        OutlinedTextField(name, { name = it.take(81) }, label = { Text("Display name") },
            modifier = Modifier.fillMaxWidth(), enabled = !busy)
        Text(if (state.verified) "${state.nameRemaining} name changes left this month."
            else "${state.nameRemaining} name changes left in 14 days.", style = MaterialTheme.typography.bodySmall)
        Button(onClick = {
            busy = true; message = null
            scope.launch {
                try {
                    val result = client.changeIdentity("display_name", name)
                    message = when (result) {
                        "changed" -> "Display name changed."
                        "pending" -> "Name change request submitted."
                        else -> "Name is unchanged."
                    }
                    controls = client.identityControls()
                    if (result == "changed") onChanged()
                } catch (e: Exception) { message = e.message ?: "Could not change display name." }
                finally { busy = false }
            }
        }, enabled = !busy && state.nameRemaining > 0 && name.trim() != profile.displayName && name.trim().isNotEmpty()) {
            Text("Save display name")
        }
        HorizontalDivider()
        OutlinedTextField(username, { username = it.take(31).lowercase() }, label = { Text("Username") },
            prefix = { Text("@") }, modifier = Modifier.fillMaxWidth(), enabled = !busy && !state.usernameLocked)
        Text(if (state.usernameLocked) "This username is locked for this account."
            else "${state.usernameRemaining} username changes left in 30 days.",
            style = MaterialTheme.typography.bodySmall)
        Button(onClick = {
            busy = true; message = null
            scope.launch {
                try {
                    val result = client.changeIdentity("username", username)
                    message = if (result == "changed") "Username changed." else "Username is unchanged."
                    controls = client.identityControls()
                    if (result == "changed") onChanged()
                } catch (e: Exception) { message = e.message ?: "Could not change username." }
                finally { busy = false }
            }
        }, enabled = !busy && !state.usernameLocked && state.usernameRemaining > 0 &&
            username.trim() != profile.username && username.trim().isNotEmpty()) {
            Text("Save username")
        }
    }
    if (message != null) ProfileNotice(message.orEmpty())
}

@Composable
private fun ProfileAvatar(auth: StagingAuthClient, profile: NativeProfile, size: Int) {
    val modifier = Modifier.size(size.dp).clip(CircleShape)
    if (profile.hasAvatar) AuthorizedImage(auth,
        "/api/profile-media/${profile.username}/avatar", "${profile.displayName}'s avatar", modifier,
        fallback = { ProfileAvatarFallback(profile.displayName, modifier) })
    else ProfileAvatarFallback(profile.displayName, modifier)
}

@Composable
private fun ProfileAvatarFallback(name: String, modifier: Modifier) {
    Surface(modifier = modifier, shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
        Box(contentAlignment = Alignment.Center) {
            Text(name.firstOrNull()?.uppercase() ?: "S", style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}

@Composable
private fun ProfileNotice(message: String) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
        Text(message, Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium)
    }
}
