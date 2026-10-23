package com.sautilink.nativeapp.feature.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiGlyph
import com.sautilink.nativeapp.ui.components.SautiPostText
import java.text.NumberFormat

internal data class CreatorProgramme(val title: String, val glyph: String, val description: String)
internal val creatorProgrammes = listOf(
    CreatorProgramme("Ads on Shorts", "video-0-1", "A future revenue programme for short-video creators."),
    CreatorProgramme("Ads on Stories", "image-0-1", "A future revenue programme for stories."),
    CreatorProgramme("Ads on Demand", "play", "A future revenue programme for long videos, Home photos and text posts.")
)

@Composable
internal fun ComingSoonBadge() {
    Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.primary.copy(alpha = .10f)) {
        Text("Coming soon", Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
internal fun CreatorProgrammeCard(programme: CreatorProgramme) {
    Surface(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { disabled() },
        shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .65f))) {
        Row(Modifier.padding(18.dp), horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.Top) {
            Box(Modifier.size(54.dp), contentAlignment = Alignment.Center) {
                Surface(shape = RoundedCornerShape(17.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                    SautiGlyph(programme.glyph, null, Modifier.padding(12.dp).size(26.dp),
                        tint = MaterialTheme.colorScheme.primary)
                }
                Surface(Modifier.align(Alignment.BottomEnd), shape = RoundedCornerShape(7.dp),
                    color = MaterialTheme.colorScheme.surface) {
                    SautiGlyph("lock-keyhole", "Locked", Modifier.padding(3.dp).size(14.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(programme.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(programme.description, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Not available yet", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
internal fun CreatorContentCard(auth: StagingAuthClient, post: CreatorPost, onOpen: () -> Unit) {
    Surface(onClick = onOpen, shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .65f))) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(12.dp)) {
            val stack = maxWidth < 300.dp || LocalDensity.current.fontScale > 1.3f
            if (stack) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CreatorContentPreview(auth, post, Modifier.fillMaxWidth())
                    CreatorContentStats(post, Modifier.fillMaxWidth())
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    CreatorContentPreview(auth, post, Modifier.weight(1f))
                    CreatorContentStats(post, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun CreatorContentPreview(auth: StagingAuthClient, post: CreatorPost, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(15.dp)).background(MaterialTheme.colorScheme.surfaceContainer),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val media = post.media
        if (media != null) {
            Box(Modifier.fillMaxWidth().aspectRatio(.82f).background(MaterialTheme.colorScheme.surfaceContainerHigh)) {
                AuthorizedImage(auth, "/api/sauti-media/${media.id}" + if (media.kind == "video") "?poster=1" else "",
                    if (media.kind == "video") "Video cover" else "Post photo", Modifier.fillMaxSize(),
                    fallback = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        SautiGlyph(if (media.kind == "video") "video-0-1" else "image-0-1", null,
                            Modifier.size(30.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    } })
                Surface(Modifier.align(Alignment.BottomStart).padding(8.dp), shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = .9f)) {
                    SautiGlyph(if (media.kind == "video") "video-0-1" else "image-0-1", null,
                        Modifier.padding(6.dp).size(17.dp))
                }
            }
        }
        if (post.text.isNotBlank()) SautiPostText(post.text,
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 3.dp),
            style = MaterialTheme.typography.bodyMedium, maxLines = if (media == null) 7 else 3,
            overflow = TextOverflow.Ellipsis, linkEntities = false)
        Text(relativePostTime(post.createdAt), Modifier.padding(start = 11.dp, end = 11.dp, bottom = 11.dp),
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CreatorContentStats(post: CreatorPost, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(9.dp)) {
        ContentStat("Views", NumberFormat.getIntegerInstance().format(post.views))
        ContentStat("Engagement", NumberFormat.getIntegerInstance().format(post.engagement))
        ContentStat("Likes · Comments", "${NumberFormat.getIntegerInstance().format(post.likes)} · ${NumberFormat.getIntegerInstance().format(post.comments)}")
    }
}

@Composable
private fun ContentStat(label: String, value: String) {
    Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        }
    }
}
