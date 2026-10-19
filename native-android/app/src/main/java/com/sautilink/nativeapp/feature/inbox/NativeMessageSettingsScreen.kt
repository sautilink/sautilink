package com.sautilink.nativeapp.feature.inbox

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Preferences are local to the authenticated account, never written into others' DM rows. */
internal class MessageAppearancePrefs(context: Context, accountId: String?) {
    private val store = context.applicationContext.getSharedPreferences(
        "sautilink_dm_ui_${accountId ?: "guest"}", Context.MODE_PRIVATE
    )
    fun wallpaperFor(conversationId: String?): String =
        conversationId?.let { store.getString("wallpaper:$it", null) } ?: wallpaper
    fun bubbleFor(conversationId: String?): String =
        conversationId?.let { store.getString("bubble:$it", null) } ?: bubble
    fun setWallpaperFor(conversationId: String?, choice: String) {
        if (conversationId == null) wallpaper = choice
        else if (choice in listOf("system", "warm", "blue", "dark"))
            store.edit().putString("wallpaper:$conversationId", choice).apply()
    }
    fun setBubbleFor(conversationId: String?, choice: String) {
        if (conversationId == null) bubble = choice
        else if (choice in listOf("blue", "teal", "neutral"))
            store.edit().putString("bubble:$conversationId", choice).apply()
    }
    var wallpaper: String
        get() = store.getString("wallpaper", "system") ?: "system"
        set(value) { if (value in listOf("system", "warm", "blue", "dark"))
            store.edit().putString("wallpaper", value).apply() }
    var bubble: String
        get() = store.getString("bubble", "blue") ?: "blue"
        set(value) { if (value in listOf("blue", "teal", "neutral"))
            store.edit().putString("bubble", value).apply() }
    var compact: Boolean
        get() = store.getBoolean("compact", false)
        set(value) { store.edit().putBoolean("compact", value).apply() }
    var autoPhotos: Boolean
        get() = store.getBoolean("auto_photos", true)
        set(value) { store.edit().putBoolean("auto_photos", value).apply() }
    var dataSaver: Boolean
        get() = store.getBoolean("data_saver", false)
        set(value) { store.edit().putBoolean("data_saver", value).apply() }
}

@Composable
internal fun messageWallpaper(choice: String): Color = when (choice) {
    "warm" -> Color(0xFFF3EFE8)
    "blue" -> Color(0xFFE6F0FA)
    "dark" -> Color(0xFF202530)
    else -> MaterialTheme.colorScheme.surfaceContainerLow
}

@Composable
internal fun outgoingBubble(choice: String): Color = when (choice) {
    "teal" -> Color(0xFF0B8676)
    "neutral" -> MaterialTheme.colorScheme.secondaryContainer
    else -> Color(0xFF0068DF)
}

/** Telegram/iOS-style messaging controls, no false promises of DM attachment support. */
@Composable
internal fun NativeMessageSettingsScreen(
    preferences: MessageAppearancePrefs,
    auth: StagingAuthClient,
    conversationId: String? = null,
    onBack: () -> Unit,
    onPrivacy: () -> Unit,
    onBlocked: () -> Unit,
    onVisibilityChanged: () -> Unit = {}
) {
    var wallpaper by remember(conversationId) { mutableStateOf(preferences.wallpaperFor(conversationId)) }
    var bubble by remember(conversationId) { mutableStateOf(preferences.bubbleFor(conversationId)) }
    val client = remember(auth) { NativeMessagesClient(auth) }
    val scope = rememberCoroutineScope()
    var activityVisible by remember { mutableStateOf(false) }
    var activityBusy by remember { mutableStateOf(false) }
    var activityLoading by remember { mutableStateOf(true) }
    var activityError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(auth.account?.id) {
        activityLoading = true
        activityError = null
        try {
            activityVisible = client.activityStatusEnabled()
        } catch (e: Exception) {
            activityError = e.message ?: "Online privacy status could not be loaded."
        } finally {
            activityLoading = false
        }
    }
    var compact by remember { mutableStateOf(preferences.compact) }
    var dataSaver by remember { mutableStateOf(preferences.dataSaver) }
    var autoPhotos by remember { mutableStateOf(preferences.autoPhotos) }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back")
            }
            Text("Chat settings", style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f))
        }
        HorizontalDivider()
        androidx.compose.foundation.lazy.LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                MessageSettingsHeading("Appearance", Icons.Rounded.Palette)
                Text("Chat wallpapers and outgoing bubble colours are saved on this device.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                MessageSettingsHeading("Wallpaper", Icons.Rounded.Wallpaper)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    listOf("system" to "Auto", "warm" to "Warm", "blue" to "Blue", "dark" to "Dark")
                        .forEach { (key, label) ->
                            FilterChip(selected = wallpaper == key,
                                onClick = { wallpaper = key; preferences.setWallpaperFor(conversationId, key) },
                                label = { Text(label) })
                        }
                }
            }
            item {
                MessageSettingsHeading("Chat bubble", Icons.Rounded.ChatBubbleOutline)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("blue" to "Blue", "teal" to "Teal", "neutral" to "Neutral")
                        .forEach { (key, label) ->
                            FilterChip(selected = bubble == key,
                                onClick = { bubble = key; preferences.setBubbleFor(conversationId, key) },
                                label = { Text(label) })
                        }
                }
            }
            item {
                ListItem(
                    headlineContent = { Text("Compact conversations") },
                    supportingContent = { Text("Reduce spacing between message bubbles") },
                    trailingContent = { Switch(compact, onCheckedChange = {
                        compact = it; preferences.compact = it
                    }) },
                    leadingContent = { Icon(Icons.Rounded.FormatLineSpacing, null) }
                )
            }
            item {
                MessageSettingsHeading("Privacy and safety", Icons.Rounded.Shield)
                ListItem(
                    headlineContent = { Text("Online, last seen and typing") },
                    supportingContent = { Text("Show activity to eligible chats. If disabled, you also cannot see others' activity.") },
                    leadingContent = { Icon(Icons.Rounded.Visibility, null) },
                    trailingContent = {
                        Switch(checked = activityVisible, enabled = !activityBusy && !activityLoading
                                && activityError == null,
                            onCheckedChange = { choice ->
                                activityBusy = true
                                scope.launch {
                                    try {
                                        client.editActivityVisibility(choice)
                                        activityVisible = choice
                                        activityError = null
                                        onVisibilityChanged()
                                    } catch (e: Exception) {
                                        activityError = e.message ?: "Privacy setting failed."
                                    } finally { activityBusy = false }
                                }
                            })
                    }
                )
                if (activityLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (activityError != null) {
                    Text(activityError.orEmpty(), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = {
                        activityError = null
                        activityLoading = true
                        scope.launch {
                            try { activityVisible = client.activityStatusEnabled() }
                            catch (e: Exception) {
                                activityError = e.message ?: "Could not refresh privacy setting."
                            } finally { activityLoading = false }
                        }
                    }) { Text("Retry") }
                }
                ListItem(
                    headlineContent = { Text("Message privacy") },
                    supportingContent = { Text("Who may message you, read receipts and activity status") },
                    leadingContent = { Icon(Icons.Rounded.Shield, null) },
                    modifier = Modifier,
                    trailingContent = {
                        IconButton(onClick = onPrivacy) {
                            Icon(Icons.Rounded.ChevronRight, "Message privacy")
                        }
                    }
                )
                ListItem(
                    headlineContent = { Text("Blocked accounts") },
                    supportingContent = { Text("Manage your existing blocked list") },
                    leadingContent = { Icon(Icons.Rounded.Block, null) },
                    trailingContent = { IconButton(onClick = onBlocked) {
                        Icon(Icons.Rounded.ChevronRight, "Blocked accounts")
                    } }
                )
            }
            item {
                MessageSettingsHeading("Data and storage", Icons.Rounded.Storage)
                ListItem(
                    headlineContent = { Text("Data saver") },
                    supportingContent = { Text("Save your preference for future chat media support") },
                    leadingContent = { Icon(Icons.Rounded.DataSaverOn, null) },
                    trailingContent = { Switch(dataSaver, onCheckedChange = {
                        dataSaver = it; preferences.dataSaver = it
                    }) }
                )
                ListItem(
                    headlineContent = { Text("Auto-load chat photos") },
                    supportingContent = { Text("Automatically display photos in chats. Files and voice notes remain on demand.") },
                    leadingContent = { Icon(Icons.Rounded.Image, null) },
                    trailingContent = {
                        Switch(checked = autoPhotos, onCheckedChange = {
                            autoPhotos = it; preferences.autoPhotos = it
                        })
                    }
                )
                Text("Documents and voice notes require a tap; media limits are enforced by SautiLink storage.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                ListItem(
                    headlineContent = { Text("Storage") },
                    supportingContent = { Text("Messages are securely loaded from SautiLink. No offline media cache is saved by this screen.") },
                    leadingContent = { Icon(Icons.Rounded.Storage, null) }
                )
            }
        }
    }
}

@Composable
private fun MessageSettingsHeading(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(icon, null, Modifier.size(21.dp), tint = MaterialTheme.colorScheme.primary)
        Text(label, style = MaterialTheme.typography.titleSmall)
    }
}
