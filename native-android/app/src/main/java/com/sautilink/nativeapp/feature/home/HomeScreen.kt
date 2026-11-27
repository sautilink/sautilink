package com.sautilink.nativeapp.feature.home

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.delay

private data class DemoStory(val initials: String, val name: String, val color: Color)
private val demoStories = listOf(
    DemoStory("SL", "Your story", SautiColors.Blue),
    DemoStory("NH", "Neema", Color(0xFFC55682)),
    DemoStory("JT", "Juma", Color(0xFF258F7D)),
    DemoStory("AM", "Aisha", Color(0xFFE0A047)),
    DemoStory("KO", "Khalid", Color(0xFF8565C5))
)
private data class DemoPost(
    val id: String, val initials: String, val name: String, val meta: String, val caption: String,
    val likes: String, val color: Color, val verified: Boolean = false
)
private val demoPosts = listOf(
    DemoPost("1", "NH", "Neema Hassan", "2h · Dar es Salaam", "Good vibes, better people. Tanzania has the most beautiful places to explore. #SautiLink #Travel", "2.4K", Color(0xFFC55682), true),
    DemoPost("2", "JT", "Juma Tz", "5h · Mwanza", "A new day, a fresh perspective. Building connections that matter.", "860", Color(0xFF258F7D))
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenChat: () -> Unit,
    onToggleTheme: () -> Unit,
    onOpenNotifications: () -> Unit = onOpenChat,
    onOpenVideos: () -> Unit = {},
    onCreatePost: () -> Unit = {},
    onOpenProfile: () -> Unit = {},
    onOpenMedia: (Int) -> Unit = {},
    onOpenStagingFeed: () -> Unit = {},
    onOpenProductionFeed: () -> Unit = {},
    onNotice: (String) -> Unit = {}
) {
    var tab by remember { mutableStateOf("For You") }
    var selectedStory by remember { mutableStateOf<DemoStory?>(null) }
    val feed = if (tab == "Following") demoPosts.takeLast(1) else demoPosts
    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 13.dp, bottom = 1.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Text("Sauti", style = MaterialTheme.typography.headlineMedium)
                    Text("Link", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                }
                FilledTonalIconButton(onClick = onToggleTheme) { Icon(Icons.Rounded.DarkMode, "Toggle appearance") }
                Spacer(Modifier.width(4.dp))
                BadgedBox(badge = { Badge { Text("2") } }) {
                    FilledTonalIconButton(onClick = onOpenNotifications) { Icon(Icons.Rounded.NotificationsNone, "Notifications") }
                }
                Spacer(Modifier.width(7.dp))
            }
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("For You", "Following", "Short Videos")) { choice ->
                    FilterChip(selected = tab == choice, onClick = {
                        if (choice == "Short Videos") onOpenVideos() else tab = choice
                    }, label = { Text(choice) }, shape = SautiShape.Pill)
                }
            }
        }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(demoStories, key = { it.name }) { story ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(68.dp).clickable { selectedStory = story }) {
                        Box(Modifier.size(67.dp).border(2.dp, SautiColors.Blue.copy(alpha = .85f), CircleShape).padding(4.dp)) {
                            SautiAvatar(story.initials, Modifier.fillMaxSize(), story.color)
                            if (story.initials == "SL") {
                                Box(Modifier.align(Alignment.BottomEnd).size(21.dp).clip(CircleShape).background(SautiColors.Blue), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Rounded.Add, "Create story preview", tint = Color.White, modifier = Modifier.size(14.dp))
                                }
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(story.name, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clickable(onClick = onOpenProductionFeed),
                shape = SautiShape.Card,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    Icon(Icons.Rounded.Public, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    Column(Modifier.weight(1f)) {
                        Text("Live SautiLink posts", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text("Production · Actual accounts, feed and media · Read-only", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                    Icon(Icons.Rounded.ChevronRight, contentDescription = "Open production feed", tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clickable(onClick = onOpenStagingFeed),
                shape = SautiShape.Card,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    Icon(Icons.Rounded.Public, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    Column(Modifier.weight(1f)) {
                        Text("Staging posts", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text("Test environment · Read-only posts", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                    Icon(Icons.Rounded.ChevronRight, contentDescription = "Open staging feed", tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
        }
        item { HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .25f)) }
        item {
            Row(Modifier.fillMaxWidth().clickable(onClick = onCreatePost).padding(horizontal = 19.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                SautiAvatar("SL", Modifier.size(43.dp), SautiColors.Blue)
                Spacer(Modifier.width(10.dp))
                Surface(Modifier.weight(1f), shape = SautiShape.Pill, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Text("What's happening?", Modifier.padding(horizontal = 16.dp, vertical = 13.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.width(12.dp))
                Icon(Icons.Rounded.PhotoLibrary, contentDescription = "Add media to post preview", tint = MaterialTheme.colorScheme.primary)
            }
        }
        items(feed, key = { it.id }) { post ->
            PostCard(post, onOpenProfile, onOpenMedia, onNotice)
        }
        item {
            Text("Sample feed · no live account or post data yet", Modifier.fillMaxWidth().padding(16.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
    if (selectedStory != null) {
        ModalBottomSheet(onDismissRequest = { selectedStory = null }, shape = SautiShape.Sheet) {
            val story = selectedStory!!
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                SautiAvatar(story.initials, Modifier.size(85.dp), story.color)
                Text(story.name, style = MaterialTheme.typography.titleLarge)
                Text("Story viewer preview", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Full-screen stories and media will connect to the SautiLink API later.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { selectedStory = null }, shape = SautiShape.Pill, modifier = Modifier.fillMaxWidth()) { Text("Done") }
                Spacer(Modifier.height(22.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PostCard(post: DemoPost, onOpenProfile: () -> Unit, onOpenMedia: (Int) -> Unit, onNotice: (String) -> Unit) {
    var liked by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var showHeart by remember { mutableStateOf(false) }
    LaunchedEffect(showHeart) {
        if (showHeart) {
            delay(680)
            showHeart = false
        }
    }
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        shape = SautiShape.Card,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column {
            Row(Modifier.fillMaxWidth().padding(start = 14.dp, top = 13.dp, end = 9.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.clickable(onClick = onOpenProfile)) { SautiAvatar(post.initials, Modifier.size(45.dp), post.color) }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f).clickable(onClick = onOpenProfile)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(post.name, style = MaterialTheme.typography.titleMedium)
                        if (post.verified) {
                            Spacer(Modifier.width(5.dp))
                            SautiVerificationBadge(true, "standard", post.name,
                                size = 16.dp, interactive = false)
                        }
                    }
                    Text(post.meta, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) { Icon(Icons.Rounded.MoreHoriz, "Post options") }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text(if (saved) "Remove from saved" else "Save post") }, onClick = { saved = !saved; menuOpen = false })
                        DropdownMenuItem(text = { Text("Not interested") }, onClick = { menuOpen = false; onNotice("Preference preview · not sent") })
                        DropdownMenuItem(text = { Text("Report post") }, onClick = { menuOpen = false; onNotice("Reports will be available after API integration") })
                    }
                }
            }
            Column(Modifier.fillMaxWidth().animateContentSize().clickable { expanded = !expanded }.padding(horizontal = 16.dp).padding(bottom = 11.dp)) {
                Text(post.caption, maxLines = if (expanded) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                if (post.caption.length > 100) Text(if (expanded) "Show less" else "See more", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
            }
            Box(Modifier.fillMaxWidth().pointerInput(post.id) {
                detectTapGestures(
                    onTap = { onOpenMedia(if (post.id == "1") 0 else 2) },
                    onDoubleTap = {
                        liked = true
                        showHeart = true
                    }
                )
            }) {
                if (post.id == "1") {
                    DestinationArtwork(Modifier.fillMaxWidth().height(230.dp))
                } else {
                    Box(Modifier.fillMaxWidth().height(165.dp)
                        .background(Brush.linearGradient(listOf(Color(0xFF136078), Color(0xFF6BC2CB), Color(0xFF275587)))),
                        contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Rounded.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(39.dp))
                            Spacer(Modifier.height(7.dp))
                            Text("Create · Share · Connect", style = MaterialTheme.typography.titleLarge, color = Color.White)
                        }
                    }
                }
                Box(modifier = Modifier.align(Alignment.Center)) {
                    AnimatedLikeHeart(visible = showHeart)
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 9.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { liked = !liked }) { Icon(if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, "Like demo post", tint = if (liked) SautiColors.Red else MaterialTheme.colorScheme.onSurface) }
                Text(post.likes, style = MaterialTheme.typography.bodySmall)
                IconButton(onClick = { onNotice("Comments are a UI preview in this release") }) { Icon(Icons.Rounded.ChatBubbleOutline, "Comments") }
                Text("320", style = MaterialTheme.typography.bodySmall)
                IconButton(onClick = { onNotice("Sharing will use the native share sheet in a later phase") }) { Icon(Icons.Rounded.Share, "Share") }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { saved = !saved }) { Icon(if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, "Save post", tint = if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface) }
            }
        }
    }
}


/** Dedicated top-level composable avoids a conflicting ColumnScope AnimatedVisibility overload. */
@Composable
private fun AnimatedLikeHeart(visible: Boolean) {
    AnimatedVisibility(
        visible = visible,
        enter = scaleIn(initialScale = .6f) + fadeIn(),
        exit = scaleOut(targetScale = 1.25f) + fadeOut()
    ) {
        Icon(
            Icons.Rounded.Favorite,
            contentDescription = "Liked preview post",
            tint = Color.White,
            modifier = Modifier.size(82.dp)
        )
    }
}

/** Local vector illustration avoids network calls or unlicensed photo assets. */
@Composable
private fun DestinationArtwork(modifier: Modifier) {
    Box(modifier = modifier.background(Brush.verticalGradient(listOf(Color(0xFF5DB9E8), Color(0xFFD6F5F6), Color(0xFF3ABCC5))))) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val island = Path().apply {
                moveTo(0f, h * .72f)
                cubicTo(w * .16f, h * .43f, w * .43f, h * .67f, w * .53f, h * .74f)
                cubicTo(w * .74f, h * .88f, w * .83f, h * .54f, w, h * .67f)
                lineTo(w, h)
                lineTo(0f, h)
                close()
            }
            drawPath(island, Color(0xFFE8D6A4), style = Fill)
            drawCircle(Color(0xFFFFF0B2), radius = w * .11f, center = Offset(w * .82f, h * .19f))
            drawCircle(Color(0xFF247F69), radius = w * .20f, center = Offset(w * .32f, h * .77f))
            drawCircle(Color(0xFF1B6E65), radius = w * .13f, center = Offset(w * .58f, h * .76f))
        }
        Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
            Text("Tanzania vibes", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
            Text("Explore · Connect · Share", color = Color.White)
        }
    }
}
