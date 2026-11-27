package com.sautilink.nativeapp.feature.videos

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.C
import androidx.media3.common.Player
import com.sautilink.nativeapp.ui.components.*
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.delay

internal val ShortsPlaybackSpeeds = listOf(.5f, 1f, 1.25f, 1.5f, 2f)
internal fun shortsSpeedLabel(speed: Float): String =
    (if (speed % 1f == 0f) speed.toInt().toString() else speed.toString()) + "x"
internal fun shortsQualityLabel(preference: String, actual: String?): String = when (preference) {
    "auto" -> actual?.takeUnless { it == "original" }?.let { "Auto (${it.removeSuffix("p")}p)" } ?: "Auto"
    else -> videoQualityLabel(preference, actual)
}

@Composable
internal fun ShortsActionBar(likes: Int, comments: Int, reposts: Int,
    liked: Boolean, reposted: Boolean, saved: Boolean,
    likeKnown: Boolean = true, repostKnown: Boolean = true, saveKnown: Boolean = true,
    likePending: Boolean = false, repostPending: Boolean = false, savePending: Boolean = false,
    likeEnabled: Boolean = true, repostEnabled: Boolean = true, saveEnabled: Boolean = true,
    onLike: () -> Unit, onComments: () -> Unit, onRepost: () -> Unit, onShare: () -> Unit,
    onSave: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().testTag("shorts-action-bar"),
        horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
        ShortsPill(Icons.Rounded.FavoriteBorder, if (liked) "Unlike" else "Like", sautiReactionCount(likes),
            liked, true, likeKnown, likePending, likeEnabled, onLike, Modifier.weight(1f))
        ShortsPill(Icons.Rounded.ChatBubbleOutline, "Comments", sautiReactionCount(comments),
            onClick = onComments, modifier = Modifier.weight(1f))
        ShortsPill(Icons.Rounded.Repeat, if (reposted) "Undo repost" else "Repost", sautiReactionCount(reposts),
            active = reposted, known = repostKnown, enabled = repostEnabled,
            pending = repostPending,
            onClick = onRepost, modifier = Modifier.weight(1f))
        ShortsPill(SautiPostIcons.Share, "Share", onClick = onShare, modifier = Modifier.width(44.dp))
        ShortsPill(if (saved) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
            if (saved) "Unsave" else "Save", active = saved, known = saveKnown,
            pending = savePending,
            enabled = saveEnabled, onClick = onSave, modifier = Modifier.width(44.dp))
    }
}

@Composable
private fun ShortsPill(icon: ImageVector, label: String, count: String? = null,
    active: Boolean = false, heart: Boolean = false, known: Boolean = true, pending: Boolean = false,
    enabled: Boolean = true, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interaction = remember { MutableInteractionSource() }
    val tint by animateColorAsState(if (active && icon == Icons.Rounded.Repeat) SautiColors.LogoOrange else Color.White,
        label = "Shorts reaction color")
    Row(modifier.heightIn(min = 44.dp).clip(CircleShape).background(Color(0xFF30363B).copy(alpha = .82f))
        .clickable(interactionSource = interaction, indication = null, enabled = enabled && !(pending && !known), role = Role.Button, onClick = onClick)
        .semantics { stateDescription = if (!known) "Status not confirmed" else if (active) "Selected" else "Not selected" }
        .padding(horizontal = 6.dp, vertical = 8.dp), horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(24.dp).sautiActionFeedback(interaction)) {
            if (!known && pending) CircularProgressIndicator(Modifier.size(18.dp).align(Alignment.Center),
                color = Color.White.copy(alpha = .7f), strokeWidth = 1.2.dp)
            else if (!known) SautiIcon(Icons.Rounded.Refresh, "Retry $label status",
                Modifier.size(18.dp).align(Alignment.Center), tint = Color.White.copy(alpha = .7f))
            else if (heart) SautiPostHeart(active, label, Modifier.fillMaxSize(), Color.White)
            else SautiIcon(icon, label, Modifier.fillMaxSize(), tint = tint, selected = active && known)
        }
        if (!count.isNullOrBlank()) Text(count, color = Color.White,
            style = MaterialTheme.typography.labelMedium.copy(fontSize = 13.sp),
            maxLines = 1, modifier = Modifier.padding(start = 5.dp))
    }
}

@Composable
internal fun ShortsCircleButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interaction = remember { MutableInteractionSource() }
    Box(modifier.size(44.dp).clip(CircleShape).background(Color(0xFF30363B).copy(alpha = .84f))
        .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center) {
        SautiIcon(icon, label, Modifier.size(25.dp).sautiActionFeedback(interaction), tint = Color.White)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShortsOptionsSheet(speed: Float, preference: String, currentQuality: String?,
    qualities: List<Int>, captions: Boolean, captionsAvailable: Boolean, autoAdvance: Boolean,
    offline: Boolean, onSpeed: (Float) -> Unit, onQuality: (String) -> Unit,
    onCaptions: (Boolean) -> Unit, onAutoAdvance: (Boolean) -> Unit,
    onPost: () -> Unit, onDownload: () -> Unit, onOffline: () -> Unit,
    onNotInterested: () -> Unit, onReport: () -> Unit, onDismiss: () -> Unit) {
    var qualityPage by remember { mutableStateOf(false) }
    val ink = MaterialTheme.colorScheme.onSurface
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        modifier = Modifier.padding(horizontal = 8.dp).padding(bottom = 8.dp),
        shape = RoundedCornerShape(30.dp),
        properties = ModalBottomSheetProperties(isAppearanceLightStatusBars = false,
            isAppearanceLightNavigationBars = MaterialTheme.colorScheme.surface.luminance() > .5f),
        dragHandle = null, containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp)
            .padding(top = 24.dp, bottom = 14.dp).testTag("shorts-options")) {
            Row(Modifier.fillMaxWidth().height(34.dp).clip(CircleShape)
                .background(ink.copy(alpha = .055f)), verticalAlignment = Alignment.CenterVertically) {
                ShortsPlaybackSpeeds.forEach { value ->
                    val selected = speed == value
                    Box(Modifier.weight(1f).fillMaxHeight().clip(CircleShape)
                        .background(if (selected) ink else Color.Transparent)
                        .clickable(role = Role.RadioButton) { onSpeed(value) }.padding(vertical = 5.dp),
                        contentAlignment = Alignment.Center) {
                        Text(shortsSpeedLabel(value), color = if (selected) MaterialTheme.colorScheme.surface else ink,
                            fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            if (qualityPage) {
                ShortsOptionRow(Icons.AutoMirrored.Rounded.ArrowBack, "Quality", onClick = { qualityPage = false })
                (listOf("auto") + qualities.sortedDescending().map { it.toString() } + "original").distinct().forEach { value ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.RadioButton) {
                        onQuality(value); qualityPage = false
                    }, verticalAlignment = Alignment.CenterVertically) {
                        Text(when (value) { "auto" -> "Auto"; "original" -> "Highest available"; else -> "${value}p" }, Modifier.weight(1f))
                        RadioButton(selected = preference == value, onClick = null)
                    }
                }
            } else {
                ShortsOptionRow(Icons.Rounded.Tune, "Quality", shortsQualityLabel(preference, currentQuality),
                    onClick = { qualityPage = true }, trailing = { SautiIcon(Icons.Rounded.ChevronRight, null, tint = ink.copy(alpha = .45f)) })
                ShortsOptionRow(Icons.Rounded.ClosedCaption, "Captions",
                    if (!captionsAvailable) "Not available for this video" else null,
                    trailing = { Switch(captions && captionsAvailable, onCheckedChange = if (captionsAvailable) onCaptions else null,
                        enabled = captionsAvailable, colors = SwitchDefaults.colors(checkedTrackColor = SautiColors.Blue)) })
                ShortsOptionRow(Icons.Rounded.PlayCircleOutline, "Auto-advance", trailing = {
                    Switch(autoAdvance, onCheckedChange = onAutoAdvance,
                        colors = SwitchDefaults.colors(checkedTrackColor = SautiColors.Blue))
                })
                ShortsOptionRow(Icons.Rounded.ViewSidebar, "Go to Post", onClick = onPost)
                ShortsOptionRow(Icons.Rounded.DownloadForOffline, "Download video", onClick = onDownload)
                ShortsOptionRow(if (offline) Icons.Rounded.OfflinePin else Icons.Rounded.Add,
                    if (offline) "Watch offline" else "Add to Offline", onClick = onOffline)
                ShortsOptionRow(Icons.Rounded.SentimentDissatisfied, "Not interested in this", onClick = onNotInterested)
                ShortsOptionRow(Icons.Rounded.OutlinedFlag, "Report post", onClick = onReport)
            }
        }
    }
}

@Composable
private fun ShortsOptionRow(icon: ImageVector, title: String, value: String? = null,
    onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    val ink = MaterialTheme.colorScheme.onSurface
    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp)
        .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
        .padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        SautiIcon(icon, null, Modifier.size(23.dp), tint = ink)
        Column(Modifier.weight(1f)) {
            Text(title, color = ink, fontSize = 16.sp, lineHeight = 20.sp)
            if (title == "Captions" && value != null) Text(value, color = ink.copy(alpha = .55f), fontSize = 10.sp)
        }
        if (value != null && title != "Captions") Text(value, color = ink.copy(alpha = .55f), fontSize = 14.sp)
        trailing?.invoke()
    }
}

@Composable
internal fun ShortsBottomPlayback(player: Player, paused: Boolean, speed: Float, muted: Boolean,
    onPlay: () -> Unit, onSpeed: () -> Unit, onMute: () -> Unit, onFullscreen: () -> Unit,
    modifier: Modifier = Modifier, fullscreen: Boolean = false) {
    var position by remember(player) { mutableLongStateOf(0L) }
    var duration by remember(player) { mutableLongStateOf(0L) }
    var draft by remember(player) { mutableStateOf<Long?>(null) }
    LaunchedEffect(player) {
        while (true) {
            duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
            position = player.currentPosition.coerceIn(0, duration)
            delay(250)
        }
    }
    Column(modifier.fillMaxWidth().background(Color.Black).testTag("shorts-bottom-playback")) {
        ThinVideoSeekBar(draft ?: position, duration, player.isCurrentMediaItemSeekable && duration > 0,
            modifier = Modifier.fillMaxWidth().height(16.dp), trackTop = 5.dp, thickness = 2.dp,
            showThumb = false, trackTag = "short-video-seek-track", onPreview = { draft = it },
            onSeek = { player.seekTo(it.coerceIn(0, (duration - 1).coerceAtLeast(0))); draft = null })
        Row(Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onPlay) { SautiIcon(if (paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause,
                if (paused) "Play video" else "Pause video", tint = Color.White) }
            Text("-${videoTimeLabel((duration - (draft ?: position)).coerceAtLeast(0))}",
                color = Color.White.copy(alpha = .7f), fontSize = 13.sp, modifier = Modifier.weight(1f))
            TextButton(onSpeed) { Text(shortsSpeedLabel(speed), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
            IconButton(onMute) { SautiIcon(if (muted) Icons.AutoMirrored.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp,
                if (muted) "Unmute" else "Mute", tint = Color.White) }
            IconButton(onFullscreen) { SautiIcon(if (fullscreen) Icons.Rounded.FullscreenExit else Icons.Rounded.Fullscreen,
                if (fullscreen) "Exit fullscreen" else "Fullscreen", tint = Color.White) }
        }
    }
}
