package com.sautilink.nativeapp.feature.auth

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircleOutline
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.PersonAddAlt
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.R
import com.sautilink.nativeapp.feature.notifications.NativePushManager
import kotlinx.coroutines.launch

/** One lightweight branded frame while the encrypted session is restored.
 * This deliberately does not render any Home UI underneath the splash.
 */
@Composable
fun SautiStartupSplash() {
    val animation = rememberInfiniteTransition(label = "SautiLink startup")
    val opacity by animation.animateFloat(
        initialValue = .35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 850),
            repeatMode = RepeatMode.Reverse
        ),
        label = "Logo breathing"
    )
    Box(Modifier.fillMaxSize().background(Color(0xFF111214)),
        contentAlignment = Alignment.Center) {
        Image(painter = painterResource(R.drawable.sautilink_logo),
            contentDescription = "SautiLink",
            contentScale = ContentScale.Fit,
            modifier = Modifier.width(176.dp).height(92.dp).alpha(opacity))
    }
}

/** Optional, per-account welcome steps. Never requests a runtime permission until the user taps. */
@Composable
fun SautiWelcomeOnboarding(auth: StagingAuthClient, onComplete: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var step by remember(auth.account?.id) { mutableIntStateOf(0) }
    var note by remember(auth.account?.id) { mutableStateOf<String?>(null) }
    var syncing by remember { mutableStateOf(false) }

    fun enableAndAdvance(granted: Boolean) {
        if (granted) {
            syncing = true
            scope.launch {
                try {
                    val enabled = NativePushManager.sync(context, auth)
                    note = if (enabled) "Notifications are enabled."
                        else "Permission granted. Device alerts may need app notification setup."
                } catch (_: Exception) {
                    note = "Permission granted. You can review notifications in Settings."
                } finally {
                    syncing = false
                    step = 1
                }
            }
        } else {
            note = "Notifications are optional. You can enable them later in Settings."
            step = 1
        }
    }

    val permission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> enableAndAdvance(granted) }

    SautiWelcomeContent(
        complete = step > 0,
        note = note,
        syncing = syncing,
        onEnable = {
            if (Build.VERSION.SDK_INT >= 33 && !NativePushManager.permissionGranted(context)) {
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else enableAndAdvance(true)
        },
        onLater = { enableAndAdvance(false) },
        onComplete = onComplete
    )
}

@Composable
internal fun SautiWelcomeContent(
    complete: Boolean,
    note: String?,
    syncing: Boolean,
    onEnable: () -> Unit,
    onLater: () -> Unit,
    onComplete: () -> Unit
) {
    SautiReceptionTheme {
        val colors = MaterialTheme.colorScheme
        BoxWithConstraints(Modifier.fillMaxSize().background(colors.surface).safeDrawingPadding()) {
            val viewport = maxHeight
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).heightIn(min = viewport),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    WelcomeHero(complete, syncing, onComplete)
                    Column(
                        Modifier.widthIn(max = 480.dp).fillMaxWidth()
                            .padding(horizontal = 22.dp).padding(top = 14.dp, bottom = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            if (complete) "You're all set" else "Never miss a moment",
                            style = MaterialTheme.typography.headlineLarge,
                            fontWeight = FontWeight.Bold,
                            color = colors.onSurface,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            if (complete) "Your SautiLink feed, messages and profile are ready to explore."
                            else "Get updates for messages, new followers and activity on your posts.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = colors.onSurfaceVariant,
                            textAlign = TextAlign.Center
                        )

                        if (complete) {
                            if (note != null) {
                                Spacer(Modifier.height(20.dp))
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(20.dp),
                                    color = colors.secondaryContainer
                                ) {
                                    Text(note, Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                        color = colors.onSecondaryContainer,
                                        style = MaterialTheme.typography.bodyMedium,
                                        textAlign = TextAlign.Center)
                                }
                            }
                        } else {
                            Spacer(Modifier.height(22.dp))
                            WelcomeNotificationExamples()
                        }
                    }
                }
                Column(
                    Modifier.widthIn(max = 480.dp).fillMaxWidth()
                        .padding(horizontal = 22.dp).padding(top = 8.dp, bottom = 14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    AuthPrimaryButton(
                        onClick = if (complete) onComplete else onEnable,
                        enabled = !syncing,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                    ) {
                        if (syncing) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp,
                                color = LocalContentColor.current)
                            Spacer(Modifier.width(10.dp))
                            Text("Enabling notifications")
                        } else if (complete) {
                            Text("Go to SautiLink")
                        } else {
                            Icon(Icons.Rounded.NotificationsActive, null, Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Enable notifications")
                        }
                    }
                    if (!complete) {
                        val interaction = remember { MutableInteractionSource() }
                        TextButton(onClick = onLater, enabled = !syncing, interactionSource = interaction,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).authPress(interaction)) {
                            Text("Not now")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WelcomeHero(complete: Boolean, syncing: Boolean, onClose: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val height = (maxWidth * .79f).coerceIn(210.dp, 304.dp)
        Box(Modifier.fillMaxWidth().height(height)) {
            SautiReceptionPhoto(
                modifier = Modifier.matchParentSize(),
                photo = R.drawable.sautilink_notification_welcome,
                alignment = BiasAlignment(horizontalBias = 0f, verticalBias = -.38f),
                fadeStart = .58f,
                fadeEnd = .94f
            )
            val closeInteraction = remember { MutableInteractionSource() }
            IconButton(
                onClick = onClose, enabled = !syncing, interactionSource = closeInteraction,
                modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)
                    .authPress(closeInteraction).background(colors.surface, SautiShape.Pill)
            ) {
                Icon(Icons.Rounded.Close, "Skip welcome steps", Modifier.size(22.dp),
                    tint = if (syncing) colors.onSurfaceVariant else colors.onSurface)
            }

            Surface(
                modifier = Modifier.align(Alignment.BottomCenter),
                shape = RoundedCornerShape(22.dp),
                border = BorderStroke(1.dp, colors.primary.copy(alpha = .26f)),
                color = colors.secondaryContainer
            ) {
                val badge = if (complete) Icons.Rounded.CheckCircleOutline else Icons.Rounded.NotificationsActive
                Icon(badge, null, Modifier.padding(18.dp).size(34.dp), tint = colors.primary, selected = complete)
            }
        }
    }
}

@Composable
private fun WelcomeNotificationExamples() {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        color = colors.secondaryContainer
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 13.dp)) {
            Text("Notification preview", Modifier.padding(start = 6.dp, bottom = 6.dp),
                style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
            WelcomeNotificationExample(Icons.Rounded.ChatBubbleOutline, "New message",
                "Someone sent you a message")
            HorizontalDivider(Modifier.padding(start = 52.dp), color = colors.outlineVariant)
            WelcomeNotificationExample(Icons.Rounded.PersonAddAlt, "New follower",
                "Someone started following you")
        }
    }
}

@Composable
private fun WelcomeNotificationExample(icon: ImageVector, title: String, description: String) {
    val colors = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(Modifier.size(40.dp).background(colors.surface, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(21.dp), tint = colors.primary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = colors.onSecondaryContainer,
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(description, color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
