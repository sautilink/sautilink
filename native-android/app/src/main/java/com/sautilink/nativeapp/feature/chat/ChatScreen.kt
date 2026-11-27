package com.sautilink.nativeapp.feature.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch

private data class DemoMessage(val id: Int, val text: String, val time: String, val mine: Boolean, val reply: String? = null)

/** Sample conversation UI: messages are kept only in local Compose state. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    onBack: () -> Unit, onToggleTheme: () -> Unit,
    onNotice: (String) -> Unit = {},
    contactName: String = "Aisha Mohamed", contactInitials: String = "AM"
) {
    val messages = remember(contactName) {
        mutableStateListOf(
            DemoMessage(1, "Habari! Unajisikiaje leo?", "10:20", false),
            DemoMessage(2, "Poa sana! Umepata muda wa kuangalia post mpya?", "10:21", true),
            DemoMessage(3, "Nimeiona! Design ya SautiLink inapendeza sana.", "10:22", false),
            DemoMessage(4, "Asante! Tunajenga Android experience mpya, hatua kwa hatua.", "10:24", true),
            DemoMessage(5, "Safii, nangoja kuona next update!", "10:26", false)
        )
    }
    var draft by remember(contactName) { mutableStateOf("") }
    var replyTo by remember(contactName) { mutableStateOf<DemoMessage?>(null) }
    var selectedMessage by remember(contactName) { mutableStateOf<DemoMessage?>(null) }
    var attachmentOpen by remember { mutableStateOf(false) }
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current

    LaunchedEffect(contactName) {
        state.scrollToItem(messages.size)
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 4.dp, end = 9.dp, top = 6.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBackIosNew, "Back to messages", tint = MaterialTheme.colorScheme.primary)
            }
            SautiAvatar(contactInitials, Modifier.size(43.dp), Color(0xFFAD5695))
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(contactName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFF2BAA76)))
                    Spacer(Modifier.width(5.dp))
                    Text("Online · demo", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            IconButton(onClick = { onNotice("Voice calls aren't connected in this preview") }) {
                Icon(Icons.Rounded.Call, "Voice call preview", tint = MaterialTheme.colorScheme.primary)
            }
            IconButton(onClick = { onNotice("Video calls aren't connected in this preview") }) {
                Icon(Icons.Rounded.Videocam, "Video call preview", tint = MaterialTheme.colorScheme.primary)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .25f))
        LazyColumn(
            state = state,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Box(Modifier.fillMaxWidth().padding(bottom = 10.dp), contentAlignment = Alignment.Center) {
                    Surface(shape = SautiShape.Pill, color = MaterialTheme.colorScheme.surfaceContainer) {
                        Text("TODAY  ·  SAMPLE CHAT", Modifier.padding(horizontal = 15.dp, vertical = 7.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            items(messages, key = { it.id }) { msg ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (msg.mine) Arrangement.End else Arrangement.Start) {
                    Surface(
                        modifier = Modifier.widthIn(max = 304.dp).combinedClickable(
                            onClick = {},
                            onLongClick = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                selectedMessage = msg
                            }
                        ),
                        color = if (msg.mine) SautiColors.Blue else MaterialTheme.colorScheme.surfaceContainer,
                        shape = if (msg.mine) SautiShape.OutgoingBubble else SautiShape.IncomingBubble
                    ) {
                        Column(Modifier.padding(start = 14.dp, end = 13.dp, top = 10.dp, bottom = 8.dp)) {
                            if (msg.reply != null) {
                                Surface(
                                    shape = SautiShape.Button,
                                    color = if (msg.mine) Color.White.copy(alpha = .17f)
                                    else MaterialTheme.colorScheme.background.copy(alpha = .75f)
                                ) {
                                    Text(msg.reply, Modifier.padding(9.dp), maxLines = 1,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (msg.mine) Color.White else MaterialTheme.colorScheme.onSurface)
                                }
                                Spacer(Modifier.height(7.dp))
                            }
                            Text(msg.text, style = MaterialTheme.typography.bodyMedium,
                                color = if (msg.mine) Color.White else MaterialTheme.colorScheme.onSurface)
                            Spacer(Modifier.height(4.dp))
                            Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                                Text(msg.time, fontSize = 10.sp,
                                    color = if (msg.mine) Color.White.copy(alpha = .79f)
                                    else MaterialTheme.colorScheme.onSurfaceVariant)
                                if (msg.mine) {
                                    Spacer(Modifier.width(4.dp))
                                    Icon(Icons.Rounded.DoneAll, "Read · demo", tint = Color.White.copy(alpha = .85f),
                                        modifier = Modifier.size(14.dp))
                                }
                            }
                        }
                    }
                }
            }
            item {
                Text("Long-press any bubble for actions", modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        AnimatedVisibility(visible = replyTo != null) {
            replyTo?.let { replying ->
                Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(start = 17.dp, end = 9.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(3.dp).height(36.dp).clip(SautiShape.Pill)
                        .background(MaterialTheme.colorScheme.primary))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Replying", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary)
                        Text(replying.text, style = MaterialTheme.typography.bodySmall,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { replyTo = null }) { Icon(Icons.Rounded.Close, "Cancel reply") }
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .22f))
        Row(Modifier.fillMaxWidth().imePadding().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            IconButton(onClick = { attachmentOpen = true }, modifier = Modifier.padding(top = 4.dp)) {
                Icon(Icons.Rounded.AddCircleOutline, "Attachments", tint = MaterialTheme.colorScheme.primary)
            }
            TextField(
                value = draft, onValueChange = { draft = it }, modifier = Modifier.weight(1f),
                placeholder = { Text("Message...") }, shape = SautiShape.Button,
                maxLines = 4,
                colors = TextFieldDefaults.colors(
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer
                )
            )
            FilledIconButton(
                onClick = {
                    val text = draft.trim()
                    if (text.isNotEmpty()) {
                        messages.add(DemoMessage((messages.maxOfOrNull { it.id } ?: 0) + 1, text, "Now", true, replyTo?.text))
                        draft = ""
                        replyTo = null
                        scope.launch { state.animateScrollToItem(messages.size) }
                    }
                },
                enabled = draft.isNotBlank(),
                modifier = Modifier.size(48.dp).padding(top = 3.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = SautiColors.Blue, contentColor = Color.White)
            ) { Icon(Icons.Rounded.ArrowUpward, "Send demo message") }
        }
    }

    selectedMessage?.let { msg ->
        ModalBottomSheet(onDismissRequest = { selectedMessage = null }, shape = SautiShape.Sheet) {
            Column(Modifier.fillMaxWidth().padding(start = 22.dp, end = 22.dp, bottom = 24.dp)) {
                Text("Message actions", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(12.dp))
                Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                    Text(msg.text, Modifier.fillMaxWidth().padding(15.dp),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 3,
                        overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(15.dp))
                ChatAction(Icons.Rounded.Reply, "Reply") {
                    replyTo = msg
                    selectedMessage = null
                }
                ChatAction(Icons.Rounded.ContentCopy, "Copy message") {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("SautiLink message", msg.text))
                    selectedMessage = null
                    onNotice("Copied to clipboard")
                }
                if (msg.mine) {
                    ChatAction(Icons.Rounded.DeleteOutline, "Delete from this demo", destructive = true) {
                        messages.removeAll { it.id == msg.id }
                        if (replyTo?.id == msg.id) replyTo = null
                        selectedMessage = null
                        onNotice("Removed locally · nothing deleted online")
                    }
                }
            }
        }
    }
    if (attachmentOpen) {
        ModalBottomSheet(onDismissRequest = { attachmentOpen = false }, shape = SautiShape.Sheet) {
            Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(15.dp)) {
                Text("Share in chat", style = MaterialTheme.typography.titleLarge)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.PhotoLibrary, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Text("Media & documents · upcoming", style = MaterialTheme.typography.bodyMedium)
                }
                Text("Attachments will be connected to SautiLink storage in a later phase.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { attachmentOpen = false }, modifier = Modifier.fillMaxWidth(),
                    shape = SautiShape.Pill) { Text("Got it") }
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
private fun ChatAction(icon: ImageVector, text: String, destructive: Boolean = false, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(SautiShape.Button)
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
        Icon(icon, contentDescription = null, tint = tint)
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = tint, fontWeight = FontWeight.Medium)
    }
}
