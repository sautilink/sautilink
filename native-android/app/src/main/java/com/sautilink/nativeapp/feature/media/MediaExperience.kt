package com.sautilink.nativeapp.feature.media

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape

/** Self-contained vector previews. No image URLs, media permissions or production data. */
data class DemoMedia(
    val title: String,
    val location: String,
    val creator: String,
    val kind: Int,
    val isVideo: Boolean = false
)

object DemoGallery {
    val items = listOf(
        DemoMedia("Coastal daydream", "Zanzibar", "@neema", 0),
        DemoMedia("The city after dark", "Dar es Salaam", "@sautilink.preview", 1),
        DemoMedia("Golden hour", "Mwanza", "@juma", 2),
        DemoMedia("A quieter horizon", "Arusha", "@aisha", 3),
        DemoMedia("Weekend memories", "Zanzibar", "@neema", 0, true),
        DemoMedia("City lights", "Dar es Salaam", "@juma", 1, true),
        DemoMedia("Sunset stories", "Mwanza", "@aisha", 2, true)
    )
    val videos = items.filter { it.isVideo }
}

/** Rich offline composition intentionally replaces stock photos in the prototype. */
@Composable
fun DemoMediaArtwork(media: DemoMedia, modifier: Modifier = Modifier, showTitle: Boolean = true) {
    val top = when (media.kind % 4) {
        0 -> Color(0xFF74C7ED)
        1 -> Color(0xFF081A45)
        2 -> Color(0xFFEE9A76)
        else -> Color(0xFF3C87A5)
    }
    val bottom = when (media.kind % 4) {
        0 -> Color(0xFF006E9A)
        1 -> Color(0xFF673E93)
        2 -> Color(0xFF834A81)
        else -> Color(0xFF164B5D)
    }
    Box(modifier.background(Brush.verticalGradient(listOf(top, bottom)))) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            // Atmospheric circular sunlight or moonlight.
            val glow = if (media.kind == 1) Color(0xFFF8E9CA) else Color(0xFFFFE4B0)
            drawCircle(glow.copy(alpha = .22f), w * .30f, Offset(w * .75f, h * .27f))
            drawCircle(glow, w * .105f, Offset(w * .75f, h * .27f))
            val horizon = when (media.kind) { 0 -> .65f; 1 -> .7f; 2 -> .69f; else -> .61f }
            val landscape = Path().apply {
                moveTo(0f, h * horizon)
                cubicTo(w * .18f, h * (horizon - .2f), w * .34f, h * (horizon + .04f), w * .53f, h * horizon)
                cubicTo(w * .67f, h * (horizon + .06f), w * .83f, h * (horizon - .19f), w, h * (horizon - .03f))
                lineTo(w, h); lineTo(0f, h); close()
            }
            drawPath(landscape, if (media.kind == 0) Color(0xFFDFCE9F) else Color(0xFF123A57).copy(alpha = .83f))
            if (media.kind == 1) {
                // Night skyline with lit windows.
                for (i in 0..10) {
                    val blockWidth = w / 13f
                    val x = (i + 1) * w / 13f
                    val towerHeight = h * (.11f + (i % 4) * .052f)
                    drawRect(Color(0xFF112747), Offset(x, h * .76f - towerHeight), androidx.compose.ui.geometry.Size(blockWidth * .75f, towerHeight))
                    for (r in 0..4) {
                        drawCircle(Color(0xFFFFD07E), w * .003f, Offset(x + blockWidth * .23f, h * .77f - towerHeight + r * h * .022f))
                    }
                }
            } else {
                val hill = Path().apply {
                    moveTo(0f, h * .85f)
                    cubicTo(w * .28f, h * .64f, w * .47f, h * .79f, w * .72f, h * .75f)
                    cubicTo(w * .85f, h * .72f, w * .94f, h * .8f, w, h * .78f)
                    lineTo(w, h); lineTo(0f, h); close()
                }
                drawPath(hill, if (media.kind == 0) Color(0xFF2E9D9D) else Color(0xFF1A5963))
            }
            // A fine highlight for dimensional depth.
            drawLine(Color.White.copy(alpha = .16f), Offset(0f, h * horizon), Offset(w, h * (horizon - .03f)), strokeWidth = 2.dp.toPx())
        }
        if (showTitle) {
            Box(Modifier.fillMaxWidth().height(140.dp).align(Alignment.BottomCenter)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .67f)))))
            Column(Modifier.align(Alignment.BottomStart).padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(media.title, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(media.location + " · SautiLink preview", color = Color.White.copy(alpha = .85f), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** Zoomable, swipeable native media gallery; previews only, no fabricated uploads. */
@Composable
fun MediaViewerScreen(startIndex: Int, onBack: () -> Unit, onNotice: (String) -> Unit) {
    val gallery = DemoGallery.items
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, gallery.lastIndex), pageCount = { gallery.size })
    var controlsVisible by remember { mutableStateOf(true) }
    val dark = Color(0xFF080E18)
    BackHandler(onBack = onBack)
    Box(Modifier.fillMaxSize().background(dark)) {
        HorizontalPager(pager, modifier = Modifier.fillMaxSize()) { page ->
            val media = gallery[page]
            var scale by remember(media) { mutableFloatStateOf(1f) }
            var translation by remember(media) { mutableStateOf(Offset.Zero) }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                DemoMediaArtwork(
                    media = media,
                    showTitle = false,
                    modifier = Modifier.fillMaxWidth().fillMaxHeight(.78f)
                        .graphicsLayer {
                            scaleX = scale; scaleY = scale
                            translationX = translation.x; translationY = translation.y
                        }
                        .pointerInput(media) {
                            detectTransformGestures { _, pan, zoom, _ ->
                                scale = (scale * zoom).coerceIn(1f, 4f)
                                translation = if (scale > 1f) translation + pan else Offset.Zero
                            }
                        }
                        .pointerInput(media) {
                            detectTapGestures(
                                onTap = { controlsVisible = !controlsVisible },
                                onDoubleTap = {
                                    scale = if (scale > 1f) 1f else 2f
                                    translation = Offset.Zero
                                }
                            )
                        }
                )
                if (media.isVideo) Icon(
                    Icons.Rounded.PlayCircleOutline, "Video preview — playback not connected",
                    tint = Color.White.copy(alpha = .7f), modifier = Modifier.size(65.dp)
                )
            }
        }
        if (controlsVisible) {
            Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBackIosNew, "Close media viewer", tint = Color.White) }
                Spacer(Modifier.weight(1f))
                Text("${pager.currentPage + 1} / ${gallery.size}", color = Color.White, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { onNotice("Demo gallery — saving is not connected") }) {
                    Icon(Icons.Rounded.MoreHoriz, "More media options", tint = Color.White)
                }
            }
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, dark.copy(alpha = .95f))))
                .padding(horizontal = 22.dp, vertical = 17.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Text(gallery[pager.currentPage].title, color = Color.White, style = MaterialTheme.typography.titleLarge)
                Text("${gallery[pager.currentPage].creator} · ${gallery[pager.currentPage].location}", color = Color.White.copy(alpha = .75f), style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.ZoomIn, null, tint = Color.White.copy(alpha = .75f), modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Pinch to zoom · Double tap · Swipe", color = Color.White.copy(alpha = .7f), style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { onNotice("Sharing preview media is not enabled") }) {
                        Icon(Icons.Rounded.Share, "Share preview", tint = Color.White)
                    }
                }
                Text("Sample artwork · no real account media", color = Color.White.copy(alpha = .60f), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
