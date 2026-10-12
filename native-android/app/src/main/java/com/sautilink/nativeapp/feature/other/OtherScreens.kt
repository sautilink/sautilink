package com.sautilink.nativeapp.feature.other

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

@Composable
fun ExploreScreen(onOpenProfile: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val topics = listOf("#SautiLink", "#Tanzania", "#Technology", "#Travel", "#Creativity")
    val found = topics.filter { it.contains(query, ignoreCase = true) }
    LazyColumn(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Explore", style = MaterialTheme.typography.headlineMedium)
                Text("Discover stories worth sharing", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Search topics") }, leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    singleLine = true, shape = SautiShape.Pill)
            }
        }
        item { Text("Trending topics", Modifier.padding(horizontal = 20.dp, vertical = 10.dp), style = MaterialTheme.typography.titleLarge) }
        items(found) { topic ->
            Row(Modifier.fillMaxWidth().clickable { onOpenProfile() }.padding(horizontal = 20.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(SautiShape.Button).background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Tag, null, tint = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(topic, style = MaterialTheme.typography.titleMedium)
                    Text("Explore the community · sample topic", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (found.isEmpty()) item { Text("No matching topics", Modifier.padding(24.dp), style = MaterialTheme.typography.bodyMedium) }
        item {
            Surface(Modifier.fillMaxWidth().padding(18.dp), color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Discover people", style = MaterialTheme.typography.titleMedium)
                        Text("Preview profiles and creator stories", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(isDark: Boolean, onBack: () -> Unit, onToggleTheme: () -> Unit, onNotice: (String) -> Unit, onOpenConnection: () -> Unit, onOpenAuth: () -> Unit) {
    val sections = listOf(
        "ACCOUNT" to listOf("Profile details", "Security & sign-in"),
        "PRIVACY" to listOf("Who can see your posts", "Blocked accounts"),
        "NOTIFICATIONS" to listOf("Push notifications", "Message alerts"),
        "SUPPORT" to listOf("Help center", "About SautiLink")
    )
    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        item { DetailHeader("Settings", onBack) }
        item {
            Text("APPEARANCE", Modifier.padding(start = 22.dp, top = 14.dp, bottom = 8.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                shape = SautiShape.Card,
                color = MaterialTheme.colorScheme.surfaceContainer
            ) {
                Row(Modifier.padding(start = 14.dp, end = 15.dp, top = 12.dp, bottom = 12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(37.dp).clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF5D65E9)), contentAlignment = Alignment.Center) {
                        Icon(if (isDark) Icons.Rounded.DarkMode else Icons.Rounded.LightMode,
                            contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(13.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Dark appearance", style = MaterialTheme.typography.titleMedium)
                        Text("Native light & dark surfaces", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = isDark, onCheckedChange = { onToggleTheme() })
                }
            }
        }
        item {
            Text("DEVELOPER PREVIEW", Modifier.padding(start = 22.dp, top = 18.dp, bottom = 9.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                shape = SautiShape.Card,
                color = MaterialTheme.colorScheme.surfaceContainer
            ) {
                Row(
                    Modifier.fillMaxWidth().clickable(onClick = onOpenConnection)
                        .padding(horizontal = 16.dp, vertical = 15.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.CloudQueue, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Staging connection", style = MaterialTheme.typography.titleMedium)
                        Text("Read-only API connectivity test", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Rounded.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                shape = SautiShape.Card,
                color = MaterialTheme.colorScheme.surfaceContainer
            ) {
                Row(
                    Modifier.fillMaxWidth().clickable(onClick = onOpenAuth)
                        .padding(horizontal = 16.dp, vertical = 15.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.Lock, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Native sign-in (staging)", style = MaterialTheme.typography.titleMedium)
                        Text("Try existing SautiLink accounts safely",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Rounded.ChevronRight, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        sections.forEach { (section, entries) ->
            item {
                Text(section, Modifier.padding(start = 22.dp, top = 18.dp, bottom = 9.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Surface(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    shape = SautiShape.Card,
                    color = MaterialTheme.colorScheme.surfaceContainer
                ) {
                    Column {
                        entries.forEachIndexed { index, entry ->
                            Row(Modifier.fillMaxWidth().clickable {
                                onNotice("$entry — UI preview; live account settings not connected")
                            }.padding(horizontal = 15.dp, vertical = 16.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                val icon = when (section) {
                                    "ACCOUNT" -> Icons.Rounded.PersonOutline
                                    "PRIVACY" -> Icons.Rounded.Lock
                                    "NOTIFICATIONS" -> Icons.Rounded.NotificationsNone
                                    else -> Icons.Rounded.HelpOutline
                                }
                                val accent = when (section) {
                                    "ACCOUNT" -> SautiColors.Blue
                                    "PRIVACY" -> Color(0xFFED9852)
                                    "NOTIFICATIONS" -> Color(0xFF9A6BD1)
                                    else -> Color(0xFF25A98A)
                                }
                                Box(Modifier.size(31.dp).clip(RoundedCornerShape(9.dp))
                                    .background(accent), contentAlignment = Alignment.Center) {
                                    Icon(icon, contentDescription = null, tint = Color.White,
                                        modifier = Modifier.size(18.dp))
                                }
                                Spacer(Modifier.width(12.dp))
                                Text(entry, style = MaterialTheme.typography.bodyLarge,
                                    modifier = Modifier.weight(1f))
                                Icon(Icons.Rounded.ChevronRight, contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (index < entries.lastIndex) HorizontalDivider(
                                Modifier.padding(start = 58.dp, end = 14.dp),
                                color = MaterialTheme.colorScheme.outline.copy(alpha = .25f))
                        }
                    }
                }
            }
        }
        item { PreviewLabel() }
    }
}

@Composable
fun NotificationsScreen(onBack: () -> Unit, onNotice: (String) -> Unit) {
    val titles = listOf("Welcome to the new SautiLink", "Aisha liked your preview post", "Your experience, reimagined")
    LazyColumn(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        item { DetailHeader("Notifications", onBack) }
        items(titles) { title ->
            Row(Modifier.fillMaxWidth().clickable { onNotice("Sample notification — no live activity") }
                .padding(horizontal = 19.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.NotificationsNone, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleMedium)
                    Text("Sample activity · just now", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item { PreviewLabel() }
    }
}

@Composable
private fun DetailHeader(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 20.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBackIosNew, "Back") }
        Spacer(Modifier.width(7.dp))
        Text(title, style = MaterialTheme.typography.headlineMedium)
    }
}

@Composable
private fun PreviewLabel() {
    Text("SautiLink Native · Sample content for design review", Modifier.fillMaxWidth().padding(top = 22.dp, bottom = 12.dp),
        textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
