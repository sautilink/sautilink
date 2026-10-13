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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircleOutline
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.PeopleOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
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
    Box(Modifier.fillMaxSize().background(Color(0xFF1A1C20)),
        contentAlignment = Alignment.Center) {
        Image(painter = painterResource(R.mipmap.ic_launcher),
            contentDescription = "SautiLink",
            modifier = Modifier.size(108.dp).alpha(opacity))
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

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
        .systemBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = onComplete, enabled = !syncing) {
                Icon(Icons.Rounded.Close, contentDescription = "Skip welcome steps")
            }
        }
        Spacer(Modifier.weight(.45f))
        if (step == 0) {
            Box(Modifier.size(112.dp), contentAlignment = Alignment.Center) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer,
                    modifier = Modifier.size(102.dp)) {}
                Icon(Icons.Rounded.NotificationsActive, contentDescription = null,
                    modifier = Modifier.size(61.dp), tint = MaterialTheme.colorScheme.onSurface)
                Badge(modifier = Modifier.align(Alignment.TopEnd),
                    containerColor = Color(0xFF279BE7)) { Text("1", color = Color.White) }
            }
            Spacer(Modifier.height(26.dp))
            Text("Never miss a moment", style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Text("Know when someone messages you, follows your profile, or interacts with your posts.",
                style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(28.dp))
            // Illustration uses honest, non-personalized example notifications only.
            Surface(shape = RoundedCornerShape(23.dp),
                color = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Rounded.NotificationsNone, contentDescription = null)
                        Column {
                            Text("New message", fontWeight = FontWeight.SemiBold)
                            Text("Someone sent you a message",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    HorizontalDivider()
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Rounded.PeopleOutline, contentDescription = null)
                        Column {
                            Text("New follower", fontWeight = FontWeight.SemiBold)
                            Text("Someone started following you",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        } else {
            Icon(Icons.Rounded.CheckCircleOutline, null, Modifier.size(92.dp),
                tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(26.dp))
            Text("You're all set", style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Text("Your SautiLink feed, messages and profile are ready to explore.",
                style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (note != null) {
                Spacer(Modifier.height(16.dp))
                Text(note.orEmpty(), textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.weight(1f))
        if (step == 0) {
            OutlinedButton(onClick = { enableAndAdvance(false) },
                enabled = !syncing, modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(28.dp)) { Text("Not now") }
            Spacer(Modifier.height(12.dp))
            Button(onClick = {
                if (Build.VERSION.SDK_INT >= 33 && !NativePushManager.permissionGranted(context)) {
                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else enableAndAdvance(true)
            }, enabled = !syncing,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(28.dp)) {
                if (syncing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else {
                    Icon(Icons.Rounded.NotificationsActive, null)
                    Spacer(Modifier.width(9.dp))
                    Text("Enable notifications")
                }
            }
        } else {
            Button(onClick = onComplete, modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(28.dp)) { Text("Go to SautiLink") }
        }
        Spacer(Modifier.height(12.dp))
    }
}
