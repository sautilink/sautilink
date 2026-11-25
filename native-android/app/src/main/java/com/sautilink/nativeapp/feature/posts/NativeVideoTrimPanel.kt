package com.sautilink.nativeapp.feature.posts

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.music.*
import kotlinx.coroutines.CancellationException

/** Posts and Stories share the exact same timeline, gesture rules and export selection. */
@Composable
internal fun NativeVideoTrimPanel(uri: Uri, durationMs: Long, maximumMs: Long,
    trim: NativeMediaEditPolicy.Trim, edits: NativeImageEdits, videoSize: NativeVideoSize,
    enabled: Boolean, modifier: Modifier = Modifier, onChange: (NativeMediaEditPolicy.Trim) -> Unit) {
    val context = LocalContext.current
    val bounds = remember(durationMs, maximumMs) { NativeAudioTrimBounds(0, durationMs, maximumMs) }
    val range = bounds.clip(trim.startMs, trim.durationMs)
    var committed by remember(uri) { mutableStateOf(trim) }
    var pending by remember(uri) { mutableStateOf(trim) }
    var scrubbing by remember { mutableStateOf(false) }
    var playhead by remember { mutableLongStateOf(0) }
    var peaks by remember(uri) { mutableStateOf(emptyList<Float>()) }
    var loading by remember(uri) { mutableStateOf(true) }
    var waveFailed by remember(uri) { mutableStateOf(false) }
    var retry by remember(uri) { mutableIntStateOf(0) }
    var durationMenu by remember { mutableStateOf(false) }
    LaunchedEffect(uri, retry) {
        loading = true; waveFailed = false
        try { peaks = localVideoWaveform(context, uri, durationMs) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { waveFailed = true }
        finally { loading = false }
    }
    val scrub = { pending = trim; scrubbing = true; playhead = 0L }
    val scrubEnd = { committed = pending; scrubbing = false }
    fun change(value: NativeAudioTrimRange) {
        pending = NativeMediaEditPolicy.Trim(value.startMs, value.endMs)
        onChange(pending)
    }
    BoxWithConstraints(modifier.background(Color.Black).clip(RoundedCornerShape(24.dp))) {
        val previewHeight = (maxHeight - 60.dp).coerceAtLeast(120.dp)
        Box(Modifier.fillMaxWidth().height(previewHeight).clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))) {
            LocalVideoPlayer(uri, committed.startMs, committed.endMs, Modifier.fillMaxSize(),
                playOnOpen = true, edits = edits, videoSize = videoSize, playbackAllowed = enabled && !scrubbing,
                loop = true, onPosition = { if (!scrubbing) playhead = it })
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent, Color.Black.copy(alpha = .55f)))))
        }
        Column(Modifier.fillMaxWidth().offset(y = (previewHeight - 108.dp).coerceAtLeast(8.dp)), horizontalAlignment = Alignment.CenterHorizontally) {
            Box {
                Text(audioTrimTime(range.durationMs), color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 18.sp,
                    modifier = Modifier.clip(RoundedCornerShape(24.dp)).background(Color.White).clickable(enabled) { durationMenu = true }
                        .semantics { contentDescription = "Clip duration"; stateDescription = audioTrimTime(range.durationMs) }.padding(horizontal = 12.dp, vertical = 6.dp))
                DropdownMenu(durationMenu, { durationMenu = false }) {
                    (listOf(5_000L, 15_000L, 30_000L, 60_000L, 90_000L, 120_000L, 180_000L, bounds.maximumDuration)
                        .filter { it <= bounds.maximumDuration }.distinct().sorted()).forEach { length ->
                        DropdownMenuItem(text = { Text(audioTrimTime(length)) }, onClick = {
                            val next = bounds.clip(range.startMs, length)
                            change(next); committed = NativeMediaEditPolicy.Trim(next.startMs, next.endMs)
                            durationMenu = false; playhead = 0
                        })
                    }
                }
            }
            NativeAudioTrimOverview(bounds, range, playhead, Modifier.fillMaxWidth(.67f).padding(horizontal = 8.dp),
                onChange = ::change, onScrub = scrub, onScrubEnd = scrubEnd, enabled = enabled)
        }
        NativeAudioWaveform(bounds, range, peaks, durationMs, playhead, Modifier.offset(y = previewHeight - 32.dp),
            onChange = ::change, onScrub = scrub, onScrubEnd = scrubEnd, enabled = enabled)
        Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${audioTrimTime(range.startMs)} — ${audioTrimTime(range.endMs)}", color = Color.White.copy(alpha = .75f), style = MaterialTheme.typography.labelMedium)
            if (loading) LinearProgressIndicator(Modifier.width(32.dp).height(2.dp), color = Color.White)
            if (waveFailed) TextButton(onClick = { retry++ }, enabled = enabled) { Text("Reload waveform", color = Color.White) }
        }
    }
}
