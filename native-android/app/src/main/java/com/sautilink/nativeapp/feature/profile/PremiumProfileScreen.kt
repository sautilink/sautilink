package com.sautilink.nativeapp.feature.profile

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.media.DemoGallery
import com.sautilink.nativeapp.feature.media.DemoMediaArtwork
import com.sautilink.nativeapp.feature.auth.StagingAccount
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

private val tabs = listOf("Posts", "Media", "About")

/** SautiLink member preview — deliberately not an authenticated user profile. */
@Composable
fun PremiumProfileScreen(
    onSettings: () -> Unit,
    onOpenVideos: () -> Unit,
    onOpenMedia: (Int) -> Unit,
    onNotice: (String) -> Unit,
    connectedAccount: StagingAccount? = null,
    onOpenRealProfile: () -> Unit = {},
    onProductionSignIn: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf("Posts") }
    var following by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        if (connectedAccount != null) {
            item {
                Surface(Modifier.fillMaxWidth().padding(14.dp),
                    shape = SautiShape.Card, color = MaterialTheme.colorScheme.primaryContainer) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("PRODUCTION ACCOUNT CONNECTED", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text(connectedAccount.displayName, style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text("This profile screen is a design preview. Your real SautiLink profile is available separately.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Button(onClick = onOpenRealProfile, shape = SautiShape.Pill) {
                            Text("View my real SautiLink profile")
                        }
                        OutlinedButton(onClick = onProductionSignIn, shape = SautiShape.Pill) {
                            Text("Account & verification")
                        }
                    }
                }
            }
        }
        if (connectedAccount == null) {
            item {
                Surface(Modifier.fillMaxWidth().padding(14.dp), shape = SautiShape.Card,
                    color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("PROFILE DESIGN PREVIEW", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary)
                        Text("Sign in to SautiLink to view your real account. The profile below is sample UI only.",
                            style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = onProductionSignIn, shape = SautiShape.Pill) {
                            Text("Sign in to SautiLink")
                        }
                    }
                }
            }
        }
        item {
            Box(Modifier.fillMaxWidth().height(182.dp)) {
                DemoMediaArtwork(DemoGallery.items[3], Modifier.fillMaxSize(), showTitle = false)
                Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(12.dp), horizontalArrangement = Arrangement.End) {
                    Surface(color = Color.Black.copy(alpha = .3f), shape = CircleShape) {
                        IconButton(onClick = onSettings) { Icon(Icons.Rounded.Settings, "Settings", tint = Color.White) }
                    }
                }
                Surface(
                    color = Color.Black.copy(alpha = .30f), shape = SautiShape.Pill,
                    modifier = Modifier.align(Alignment.BottomStart).padding(16.dp)
                ) {
                    Text("SautiLink  ·  Native preview", Modifier.padding(horizontal = 12.dp, vertical = 6.dp), color = Color.White, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth().padding(top = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(88.dp).border(3.dp, MaterialTheme.colorScheme.surface, CircleShape).padding(3.dp)) {
                        SautiAvatar("SL", Modifier.fillMaxSize(), SautiColors.Blue)
                    }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(
                        onClick = { onNotice("Edit profile requires a signed-in SautiLink account") },
                        shape = SautiShape.Pill, contentPadding = PaddingValues(horizontal = 17.dp, vertical = 9.dp)
                    ) {
                        Icon(Icons.Rounded.Edit, null, Modifier.size(16.dp)); Spacer(Modifier.width(7.dp)); Text("Edit profile")
                    }
                    Spacer(Modifier.width(7.dp))
                    FilledTonalIconButton(onClick = { onNotice("Profile sharing is not connected in this preview") }) {
                        Icon(Icons.Rounded.Share, "Share profile")
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("SautiLink Member", style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.width(7.dp))
                    Icon(Icons.Rounded.Verified, "Illustrative verified badge", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                }
                Text("@sautilink.preview", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Moments, creativity and connections. A more personal SautiLink experience starts here.", style = MaterialTheme.typography.bodyMedium)
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    ProfileStat("12", "Posts")
                    ProfileStat("1.2K", "Followers")
                    ProfileStat("240", "Following")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { following = !following; onNotice("Follow state is local to this demo") },
                        modifier = Modifier.weight(1f).height(46.dp), shape = SautiShape.Pill,
                        colors = ButtonDefaults.buttonColors(containerColor = if (following) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.primary,
                            contentColor = if (following) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onPrimary)
                    ) {
                        Icon(if (following) Icons.Rounded.Check else Icons.Rounded.PersonAdd, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp)); Text(if (following) "Following" else "Follow")
                    }
                    OutlinedButton(
                        onClick = { onNotice("Messaging will connect to the authenticated API later") },
                        modifier = Modifier.weight(1f).height(46.dp), shape = SautiShape.Pill
                    ) { Icon(Icons.Rounded.ChatBubbleOutline, null, Modifier.size(18.dp)); Spacer(Modifier.width(7.dp)); Text("Message") }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 15.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                tabs.forEach { tab ->
                    FilterChip(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        label = { Text(tab) },
                        shape = SautiShape.Pill,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
        when (selectedTab) {
            "Posts" -> {
                item {
                    Surface(Modifier.fillMaxWidth().padding(horizontal = 15.dp).animateContentSize(),
                        color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                SautiAvatar("SL", Modifier.size(42.dp), SautiColors.Blue)
                                Spacer(Modifier.width(11.dp))
                                Column {
                                    Text("SautiLink Member", style = MaterialTheme.typography.titleMedium)
                                    Text("Just now · Public preview", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Text("Exploring a more expressive way to connect. Here's a first look at our native Android experience.", style = MaterialTheme.typography.bodyMedium)
                            DemoMediaArtwork(DemoGallery.items[0], Modifier.fillMaxWidth().height(230.dp).clip(RoundedCornerShape(17.dp)).clickable { onOpenMedia(0) })
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.FavoriteBorder, "Demo likes", modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.width(7.dp)); Text("24 likes · Preview only", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.weight(1f))
                                TextButton(onClick = { onOpenMedia(0) }) { Text("Open media") }
                            }
                        }
                    }
                }
            }
            "Media" -> {
                val indexes = listOf(0, 1, 2, 3, 4, 5)
                items(3) { row ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (column in 0..1) {
                            val index = indexes[row * 2 + column]
                            Box(Modifier.weight(1f).aspectRatio(.9f).clip(RoundedCornerShape(20.dp))
                                .clickable { onOpenMedia(index) }) {
                                DemoMediaArtwork(DemoGallery.items[index], Modifier.fillMaxSize())
                                if (DemoGallery.items[index].isVideo) Icon(
                                    Icons.Rounded.PlayCircleFilled, "Video preview", modifier = Modifier.align(Alignment.TopEnd).padding(9.dp), tint = Color.White
                                )
                            }
                        }
                    }
                }
            }
            else -> item {
                Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("About", style = MaterialTheme.typography.titleLarge)
                        Text("A sample profile for SautiLink Native design review.", style = MaterialTheme.typography.bodyMedium)
                        HorizontalDivider()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Place, null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(10.dp)); Text("Tanzania · Sample location", style = MaterialTheme.typography.bodyMedium)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.CalendarToday, null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(10.dp)); Text("Profile data will come from SautiLink APIs", style = MaterialTheme.typography.bodyMedium)
                        }
                        TextButton(onClick = onOpenVideos) { Text("Explore short video previews") }
                    }
                }
            }
        }
        item {
            Text("Sample profile · no real account, verification or followers", Modifier.fillMaxWidth().padding(19.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun ProfileStat(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}
