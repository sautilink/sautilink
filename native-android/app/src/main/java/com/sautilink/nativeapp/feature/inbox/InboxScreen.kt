package com.sautilink.nativeapp.feature.inbox

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

private data class PreviewChat(val initials: String, val name: String, val message: String, val time: String, val unread: Int, val color: Color)
private val sampleChats = listOf(
    PreviewChat("AM", "Aisha Mohamed", "Hii picha ni kali!", "10:24", 2, Color(0xFFAE5497)),
    PreviewChat("SL", "SautiLink Team", "Your new experience is here.", "09:18", 1, SautiColors.Blue),
    PreviewChat("JT", "Juma Tz", "Sawa, nitaiangalia", "Yesterday", 0, Color(0xFF259E8F)),
    PreviewChat("NH", "Neema Hassan", "Typing preview · see you soon", "Yesterday", 0, Color(0xFFC56B72)),
    PreviewChat("KH", "Khalid Omary", "Photo", "Monday", 0, Color(0xFF8464C5))
)

@Composable
fun InboxScreen(onOpenChat: (String, String) -> Unit) {
    var search by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("All") }
    val chats = sampleChats.filter { chat ->
        (filter != "Unread" || chat.unread > 0) &&
            (search.isBlank() || chat.name.contains(search, true) || chat.message.contains(search, true))
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 10.dp, top = 17.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Messages", style = MaterialTheme.typography.headlineMedium)
                Text("Your conversations · preview", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            FilledTonalIconButton(onClick = { onOpenChat("Aisha Mohamed", "AM") }) {
                Icon(Icons.Rounded.Edit, contentDescription = "Open sample conversation",
                    tint = MaterialTheme.colorScheme.primary)
            }
        }
        TextField(
            value = search, onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 12.dp),
            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
            trailingIcon = {
                if (search.isNotEmpty()) IconButton(onClick = { search = "" }) {
                    Icon(Icons.Rounded.Close, contentDescription = "Clear search")
                }
            },
            placeholder = { Text("Search conversations") },
            singleLine = true, shape = SautiShape.Pill,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent
            )
        )
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainer,
            shape = SautiShape.Pill,
            modifier = Modifier.padding(start = 18.dp, top = 13.dp, bottom = 8.dp)
        ) {
            Row(Modifier.padding(4.dp)) {
                listOf("All", "Unread").forEach { choice ->
                    val selected = choice == filter
                    val bg by animateColorAsState(
                        if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                        label = "Inbox selected filter"
                    )
                    Box(Modifier.clip(SautiShape.Pill).background(bg).clickable { filter = choice }
                        .padding(horizontal = 21.dp, vertical = 9.dp),
                        contentAlignment = Alignment.Center) {
                        Text(choice, style = MaterialTheme.typography.labelMedium,
                            color = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        LazyColumn(contentPadding = PaddingValues(bottom = 18.dp)) {
            items(chats, key = { it.name }) { chat ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpenChat(chat.name, chat.initials) }
                        .padding(horizontal = 20.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SautiAvatar(chat.initials, Modifier.size(56.dp), chat.color)
                    Spacer(Modifier.width(13.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(chat.name, style = MaterialTheme.typography.titleMedium,
                            fontWeight = if (chat.unread > 0) FontWeight.Bold else FontWeight.SemiBold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(chat.message, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text(chat.time, style = MaterialTheme.typography.bodySmall,
                            color = if (chat.unread > 0) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant)
                        if (chat.unread > 0) Box(Modifier.size(21.dp).clip(CircleShape)
                            .background(SautiColors.Blue), contentAlignment = Alignment.Center) {
                            Text(chat.unread.toString(), color = Color.White,
                                style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                HorizontalDivider(Modifier.padding(start = 90.dp, end = 20.dp),
                    color = MaterialTheme.colorScheme.outline.copy(alpha = .22f))
            }
            if (chats.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(46.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.MarkChatUnread, null, tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(34.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("No conversations found", style = MaterialTheme.typography.titleMedium)
                    Text("Try changing your search or filter", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                Text("Sample conversations · local preview only",
                    Modifier.fillMaxWidth().padding(top = 18.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}
