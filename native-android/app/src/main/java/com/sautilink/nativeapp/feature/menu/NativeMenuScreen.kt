package com.sautilink.nativeapp.feature.menu

import com.sautilink.nativeapp.ui.components.SautiCopyrightFooter

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.profile.NativeProfilesClient
import com.sautilink.nativeapp.feature.profile.NativeProfile

/** Immediate menu action with restrained press feedback. */
@Composable
fun AnimatedHamburgerButton(openAtRest: Boolean = false, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) .96f else 1f,
        animationSpec = tween(90),
        label = "Menu press"
    )
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(48.dp).graphicsLayer {
            scaleX = scale
            scaleY = scale
        },
        interactionSource = interaction
    ) {
        Icon(if (openAtRest) Icons.Rounded.Close else Icons.Rounded.Menu,
            contentDescription = if (openAtRest) "Close menu" else "Open menu",
            modifier = Modifier.size(25.dp), selected = openAtRest)
    }
}

private data class MenuDestination(val label: String, val icon: ImageVector, val key: String)

private val menuDestinations = listOf(
    MenuDestination("Rooms", Icons.Rounded.Groups, "rooms"),
    MenuDestination("Saved", Icons.Rounded.Bookmark, "saved"),
    MenuDestination("Notifications", Icons.Rounded.NotificationsNone, "notifications"),
    MenuDestination("Settings", Icons.Rounded.Settings, "settings"),
    MenuDestination("Verification", Icons.Rounded.VerifiedUser, "verification"),
    MenuDestination("Privacy", Icons.Rounded.AdminPanelSettings, "privacy"),
    MenuDestination("Language", Icons.Rounded.Language, "language"),
    MenuDestination("Terms of Service", Icons.Rounded.Description, "terms"),
    MenuDestination("Community Guidelines", Icons.Rounded.GppGood, "community-guidelines"),
    MenuDestination("Appeals", Icons.Rounded.Gavel, "appeals"),
    MenuDestination("Help & Support", Icons.Rounded.SupportAgent, "help"),
    MenuDestination("About SautiLink", Icons.Rounded.Info, "about"),
    MenuDestination("Contact Us", Icons.Rounded.AlternateEmail, "contact"),
    MenuDestination("Report a Problem", Icons.Rounded.BugReport, "report"),
    MenuDestination("Theme", Icons.Rounded.DarkMode, "theme")
)

/** Compact native destinations with a shared icon language and event-driven press feedback. */
@Composable
fun NativeMenuScreen(
    auth: StagingAuthClient,
    isDark: Boolean,
    confirmedProfile: NativeProfile? = null,
    onProfileConfirmed: (NativeProfile?) -> Unit = {},
    onBack: () -> Unit,
    onProfile: () -> Unit,
    onRooms: () -> Unit,
    onSaved: () -> Unit,
    onNotifications: () -> Unit,
    onSettings: () -> Unit,
    onVerification: () -> Unit,
    onPrivacy: () -> Unit,
    onLanguage: () -> Unit,
    onAppeals: () -> Unit = {},
    onWebsite: (String) -> Unit,
    onToggleTheme: () -> Unit,
    onSignOut: () -> Unit
) {
    var signOutDialog by remember { mutableStateOf(false) }
    val profileClient = remember(auth) { NativeProfilesClient(auth) }
    val accountId = auth.account?.id
    var ownProfile by remember(accountId) {
        mutableStateOf(confirmedProfile?.takeIf { it.id == accountId })
    }
    var profileLoading by remember(accountId) { mutableStateOf(accountId != null) }
    LaunchedEffect(accountId) {
        if (accountId == null) return@LaunchedEffect
        try {
            val loaded = profileClient.own()?.takeIf { it.id == accountId }
            if (auth.account?.id == accountId) {
                ownProfile = loaded
                onProfileConfirmed(loaded)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Keep a confirmed same-account profile during a temporary read failure.
        } finally {
            profileLoading = false
        }
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text("Menu", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            AnimatedHamburgerButton(openAtRest = true, onClick = onBack)
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 34.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Surface(
                    onClick = onProfile,
                    shape = RoundedCornerShape(20.dp),
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                    shadowElevation = 0.dp,
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f)
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(Modifier.padding(14.dp).heightIn(min = 46.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Auth metadata can retain an old name/handle after an identity update.
                        // Render only this account's confirmed profile; never invent an identity.
                        val display = ownProfile?.displayName?.takeIf { it.isNotBlank() }
                            ?: if (auth.account == null) "Sign in" else if (profileLoading) "Loading profile…" else "View your profile"
                        val handle = ownProfile?.username?.takeIf { it.isNotBlank() }
                        val initials = display.split(" ").filter { it.isNotBlank() }
                            .take(2).map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }
                        if (ownProfile?.hasAvatar == true && handle != null) {
                            AuthorizedImage(
                                auth = auth,
                                route = "/api/profile-media/$handle/avatar?v=${ownProfile?.avatarRevision}",
                                description = "$display profile picture",
                                modifier = Modifier.size(46.dp).clip(CircleShape),
                                fallback = { SautiAvatar(initials, Modifier.size(46.dp), SautiColors.Blue) }
                            )
                        } else if (ownProfile != null) {
                            SautiAvatar(initials, Modifier.size(46.dp), SautiColors.Blue)
                        } else {
                            Box(Modifier.size(46.dp).clip(CircleShape)
                                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                                contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PersonOutline, null, Modifier.size(24.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(display, style = MaterialTheme.typography.titleMedium,
                                    modifier = Modifier.weight(1f, fill = false),
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                                SautiVerificationBadge(
                                    ownProfile?.verified == true,
                                    ownProfile?.badgeType ?: "standard",
                                    display, size = 16.dp, profileOwner = true
                                )
                            }
                            Text(
                                handle?.let { "@$it" } ?: if (auth.account == null) "Open your account" else "Tap to open",
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Icon(Icons.Rounded.ChevronRight, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(Modifier.fillMaxWidth().padding(start = 4.dp, top = 8.dp, bottom = 2.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.Explore, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                    Text("Discover and manage", style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold)
                }
            }
            itemsIndexed(menuDestinations, key = { _, item -> item.key }) { _, entry ->
                Box(Modifier.fillMaxWidth().heightIn(min = 84.dp)) {
                    MenuTile(entry, selected = entry.key == "theme" && isDark,
                        disabled = entry.key == "verification" && ownProfile?.verified == true) {
                            when (entry.key) {
                                "rooms" -> onRooms()
                                "saved" -> onSaved()
                                "notifications" -> onNotifications()
                                "settings" -> onSettings()
                                "verification" -> onVerification()
                                "privacy" -> onPrivacy()
                                "language" -> onLanguage()
                                "appeals" -> onAppeals()
                                "theme" -> onToggleTheme()
                                "report" -> onWebsite("contact")
                                else -> onWebsite(entry.key)
                            }
                    }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Spacer(Modifier.height(8.dp))
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(Modifier.padding(horizontal = 3.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.CloudQueue, null, Modifier.size(21.dp),
                        tint = MaterialTheme.colorScheme.primary)
                    Text("Other SautiLink Products", style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold)
                }
            }
            item {
                MenuTile(MenuDestination("Cloud Engine", Icons.Rounded.CloudQueue, "cloud-engine"), false) {
                    onWebsite("cloud-engine")
                }
            }
            item {
                MenuTile(MenuDestination("Router Setup", Icons.Rounded.Router, "router-setup"), false) {
                    onWebsite("router-setup")
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                OutlinedButton(
                    onClick = { if (auth.account == null) onProfile() else signOutDialog = true },
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.onSurface
                    )
                ) {
                    Icon(if (auth.account == null) Icons.Rounded.Login else Icons.Rounded.Logout,
                        contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(if (auth.account == null) "Sign in" else "Log out")
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                SautiCopyrightFooter()
            }
        }
    }
    if (signOutDialog) {
        AlertDialog(
            onDismissRequest = { signOutDialog = false },
        icon = { Icon(Icons.Rounded.Logout, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text("Log out of SautiLink?") },
            text = { Text("You'll need to sign in again to access your account.") },
            confirmButton = {
                TextButton(onClick = { signOutDialog = false; onSignOut() }) { Text("Log out") }
            },
            dismissButton = {
                TextButton(onClick = { signOutDialog = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun MenuTile(item: MenuDestination, selected: Boolean,
    disabled: Boolean = false, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .965f else 1f,
        animationSpec = tween(130), label = "Menu tile feedback")
    Surface(
        onClick = onClick,
        enabled = !disabled,
        interactionSource = source,
        modifier = Modifier.fillMaxWidth().heightIn(min = 84.dp).graphicsLayer {
            scaleX = scale
            scaleY = scale
        },
        shape = RoundedCornerShape(18.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface,
        shadowElevation = 0.dp,
        border = androidx.compose.foundation.BorderStroke(
            1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .38f)
        )
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 15.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val accent = when (item.key) {
                "rooms", "notifications", "language" -> MaterialTheme.colorScheme.primary
                "saved", "settings", "theme" -> androidx.compose.ui.graphics.Color(0xFF7961D8)
                "verification", "privacy", "community-guidelines" -> androidx.compose.ui.graphics.Color(0xFF218B72)
                "help", "contact", "report" -> androidx.compose.ui.graphics.Color(0xFFD57838)
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
            Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp))
                .background(accent.copy(alpha = if (disabled) .05f else .10f)), contentAlignment = Alignment.Center) {
                Icon(item.icon, contentDescription = null, modifier = Modifier.size(23.dp),
                    tint = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .4f) else accent,
                    selected = selected)
            }
            Text(if (item.key == "verification" && disabled) "Verified" else item.label,
                color = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f)
                    else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis)
        }
    }
}
