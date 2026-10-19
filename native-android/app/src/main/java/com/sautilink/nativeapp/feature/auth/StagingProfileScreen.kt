package com.sautilink.nativeapp.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBackIosNew
import androidx.compose.material.icons.rounded.PersonOutline
import androidx.compose.material.icons.rounded.Refresh
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch

/** Read-only personal staging profile. Never shows demo counts or pretends to be production. */
@Composable
fun StagingProfileScreen(client: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var profile by remember { mutableStateOf<StagingProfile?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val account = client.account

    fun refresh() {
        if (busy || account == null) return
        busy = true
        error = null
        scope.launch {
            try { profile = client.loadOwnProfile(); loaded = true }
            catch (e: AuthRequestException) { error = e.message ?: "Unable to load profile." }
            catch (_: Exception) { error = "Unable to load profile." }
            finally { busy = false }
        }
    }
    LaunchedEffect(client, account?.id) {
        if (account != null && !loaded) refresh()
    }

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBackIosNew, contentDescription = "Back")
            }
            Spacer(Modifier.width(6.dp))
            Text("My ${client.backend.title.lowercase()} profile", style = MaterialTheme.typography.headlineSmall)
        }
        Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${client.backend.title} · Read only", color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodySmall)
                Text("Live identity from your SautiLink ${client.backend.title.lowercase()} account",
                    style = MaterialTheme.typography.titleMedium)
                Text("The main Home preview and Messages still use demo data.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        if (account == null) {
            Text("You are not signed in to ${client.backend.title.lowercase()}.", style = MaterialTheme.typography.bodyLarge)
            Button(onClick = onSignIn, shape = SautiShape.Pill) { Text("Sign in to ${client.backend.title.lowercase()}") }
        } else {
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) {
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.errorContainer) {
                    Text(error.orEmpty(), Modifier.fillMaxWidth().padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (loaded && profile == null && error == null) {
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Profile setup pending", style = MaterialTheme.typography.titleLarge)
                        Text("Sign-in works, but this account has no social profile yet. Finish onboarding on the corresponding SautiLink website.",
                            style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            profile?.let { member ->
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(72.dp)) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PersonOutline, contentDescription = null,
                                    modifier = Modifier.size(38.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                            }
                        }
                        Text(member.displayName.ifBlank { "SautiLink member" }, style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.SemiBold)
                        Text("@${member.username}", color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.titleMedium)
                        if (member.bio.isNotBlank()) Text(member.bio, style = MaterialTheme.typography.bodyLarge)
                        HorizontalDivider()
                        if (member.location.isNotBlank()) {
                            Text("Location: ${member.location}", style = MaterialTheme.typography.bodyMedium)
                        }
                        Text("Discoverable: ${if (member.discoverable) "Yes" else "No"}",
                            style = MaterialTheme.typography.bodyMedium)
                        if (member.joinedAt.isNotBlank()) {
                            Text("Joined: ${member.joinedAt.take(10)}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            OutlinedButton(onClick = { refresh() }, enabled = !busy, shape = SautiShape.Pill,
                modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.Refresh, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Refresh profile")
            }
            Text("Only your own social profile is requested from the selected environment. " +
                "No account editing is enabled.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
