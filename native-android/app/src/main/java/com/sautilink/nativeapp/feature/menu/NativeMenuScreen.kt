package com.sautilink.nativeapp.feature.menu

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.profile.NativeProfilesClient
import com.sautilink.nativeapp.feature.profile.NativeProfile
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.delay

/** Two-state native icon, with touch feedback and a short line-to-cross morph. */
@Composable
fun AnimatedHamburgerButton(openAtRest: Boolean = false, onClick: () -> Unit) {
    var toggled by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) .88f else 1f,
        animationSpec = tween(140, easing = FastOutSlowInEasing),
        label = "Menu press"
    )
    val morph by animateFloatAsState(
        targetValue = if (openAtRest != toggled) 1f else 0f,
        animationSpec = tween(170, easing = FastOutSlowInEasing),
        label = "Menu icon morph"
    )
    LaunchedEffect(toggled) {
        if (toggled) {
            delay(175)
            onClick()
        }
    }
    IconButton(
        onClick = { if (!toggled) toggled = true },
        modifier = Modifier.size(48.dp).graphicsLayer {
            scaleX = scale
            scaleY = scale
        },
        interactionSource = interaction,
        enabled = !toggled
    ) {
        val ink = MaterialTheme.colorScheme.onSurface
        Canvas(Modifier.size(25.dp).semantics {
            contentDescription = if (openAtRest) "Close menu" else "Open menu"
        }) {
            val unit = size.width / 24f
            fun shift(a: Float, b: Float) = (a + (b - a) * morph) * unit
            val stroke = 2.15f * unit
            drawLine(ink,
                start = androidx.compose.ui.geometry.Offset(shift(4f, 6f), shift(6f, 6f)),
                end = androidx.compose.ui.geometry.Offset(shift(20f, 18f), shift(6f, 18f)),
                strokeWidth = stroke, cap = StrokeCap.Round)
            drawLine(ink.copy(alpha = 1f - morph),
                start = androidx.compose.ui.geometry.Offset(5f * unit, 12f * unit),
                end = androidx.compose.ui.geometry.Offset(19f * unit, 12f * unit),
                strokeWidth = stroke, cap = StrokeCap.Round)
            drawLine(ink,
                start = androidx.compose.ui.geometry.Offset(shift(4f, 6f), shift(18f, 18f)),
                end = androidx.compose.ui.geometry.Offset(shift(20f, 18f), shift(18f, 6f)),
                strokeWidth = stroke, cap = StrokeCap.Round)
        }
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

/** Facebook-inspired grid structure, original SautiLink iconography and Compose motion. */
@Composable
fun NativeMenuScreen(
    auth: StagingAuthClient,
    isDark: Boolean,
    onBack: () -> Unit,
    onProfile: () -> Unit,
    onRooms: () -> Unit,
    onSaved: () -> Unit,
    onNotifications: () -> Unit,
    onSettings: () -> Unit,
    onVerification: () -> Unit,
    onPrivacy: () -> Unit,
    onLanguage: () -> Unit,
    onWebsite: (String) -> Unit,
    onToggleTheme: () -> Unit,
    onSignOut: () -> Unit
) {
    var visibleCount by remember { mutableIntStateOf(0) }
    var signOutDialog by remember { mutableStateOf(false) }
    val profileClient = remember(auth) { NativeProfilesClient(auth) }
    var ownProfile by remember(auth.account?.id) { mutableStateOf<NativeProfile?>(null) }
    LaunchedEffect(auth.account?.id) {
        ownProfile = null
        if (auth.account != null) {
            ownProfile = runCatching { profileClient.own() }.getOrNull()
        }
    }

    LaunchedEffect(Unit) {
        menuDestinations.indices.forEach { index ->
            visibleCount = index + 1
            delay(24)
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
                    shadowElevation = 1.dp,
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f)
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val display = ownProfile?.displayName?.takeIf { it.isNotBlank() }
                            ?: auth.account?.suggestedName?.takeIf { it.isNotBlank() && !it.contains('@') }
                            ?: auth.account?.suggestedUsername?.takeIf { it.isNotBlank() }
                            ?: "SautiLink member"
                        val handle = ownProfile?.username?.takeIf { it.isNotBlank() }
                            ?: auth.account?.suggestedUsername?.takeIf { it.isNotBlank() }
                        val initials = display.split(" ").filter { it.isNotBlank() }
                            .take(2).map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }
                        if (ownProfile?.hasAvatar == true && handle != null) {
                            AuthorizedImage(
                                auth = auth,
                                route = "/api/profile-media/$handle/avatar",
                                description = "$display profile picture",
                                modifier = Modifier.size(46.dp).clip(CircleShape),
                                fallback = { SautiAvatar(initials, Modifier.size(46.dp), SautiColors.Blue) }
                            )
                        } else {
                            SautiAvatar(initials, Modifier.size(46.dp), SautiColors.Blue)
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
                                handle?.let { "@$it" } ?: if (auth.account == null) "Sign in" else "View your profile",
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
                Text(
                    "Discover and manage",
                    modifier = Modifier.fillMaxWidth().padding(start = 4.dp, top = 8.dp, bottom = 2.dp),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            itemsIndexed(menuDestinations, key = { _, item -> item.key }) { index, entry ->
                // Float animation works in a LazyGrid item without requiring ColumnScope.
                val reveal by animateFloatAsState(
                    targetValue = if (index < visibleCount) 1f else 0f,
                    animationSpec = tween(220, easing = FastOutSlowInEasing),
                    label = "Menu tile reveal"
                )
                Box(
                    Modifier.fillMaxWidth().height(112.dp).graphicsLayer {
                        alpha = reveal
                        translationY = (1f - reveal) * 18f
                    }
                ) {
                    MenuTile(entry, selected = entry.key == "theme" && isDark,
                        disabled = entry.key == "verification" && ownProfile?.verified == true) {
                        // Prevent invisible tiles from being activated during their entrance.
                        if (index < visibleCount) {
                            when (entry.key) {
                                "rooms" -> onRooms()
                                "saved" -> onSaved()
                                "notifications" -> onNotifications()
                                "settings" -> onSettings()
                                "verification" -> onVerification()
                                "privacy" -> onPrivacy()
                                "language" -> onLanguage()
                                "theme" -> onToggleTheme()
                                "report" -> onWebsite("contact")
                                else -> onWebsite(entry.key)
                            }
                        }
                    }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Spacer(Modifier.height(8.dp))
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
                Text("SautiLink · Create · Share · Connect",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
            }
        }
    }
    if (signOutDialog) {
        AlertDialog(
            onDismissRequest = { signOutDialog = false },
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
        modifier = Modifier.fillMaxSize().graphicsLayer {
            scaleX = scale
            scaleY = scale
        },
        shape = RoundedCornerShape(18.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        border = androidx.compose.foundation.BorderStroke(
            1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .38f)
        )
    ) {
        Column(
            Modifier.fillMaxSize().padding(start = 14.dp, end = 10.dp, top = 14.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.Start
        ) {
            Icon(
                item.icon,
                contentDescription = null,
                modifier = Modifier.size(29.dp),
                tint = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .4f)
                    else if (selected) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurface
            )
            Text(if (item.key == "verification" && disabled) "Verified" else item.label,
                color = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f)
                    else MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis)
        }
    }
}
