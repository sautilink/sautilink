package com.sautilink.nativeapp.feature.music

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.common.Player

/** Gains travel with the selected clip; the uploaded video's original audio stays recoverable. */
@Composable
internal fun NativeAudioMixControls(audio: NativeAudioSelection, hasVideo: Boolean, enabled: Boolean,
    onChange: (NativeAudioSelection) -> Unit) {
    val player = rememberPreviewPlayer()
    var playing by remember { mutableStateOf(false) }
    var previousOriginal by remember(audio.trackId) { mutableFloatStateOf(audio.originalVolume.takeIf { it > 0f } ?: 1f) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(audio.musicVolume) { player.volume = audio.musicVolume }
    LaunchedEffect(hasVideo) { if (hasVideo) player.pause() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Tune, null, Modifier.size(19.dp))
            Spacer(Modifier.width(8.dp))
            Text("Audio mix", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            if (!hasVideo) TextButton(enabled = enabled, onClick = {
                if (playing) player.pause() else {
                    player.setMediaItem(MediaItem.fromUri(audio.previewUrl())); player.prepare(); player.play()
                }
            }) { Text(if (playing) "Pause music" else "Preview music") }
        }
        Text("Music · ${(audio.musicVolume * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
        Slider(audio.musicVolume, { onChange(audio.copy(musicVolume = it)) }, enabled = enabled,
            modifier = Modifier.semantics { contentDescription = "Music volume" })
        if (hasVideo) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Original video sound", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(audio.originalVolume > 0f, { sound ->
                    if (!sound && audio.originalVolume > 0f) previousOriginal = audio.originalVolume
                    onChange(audio.copy(originalVolume = if (sound) previousOriginal else 0f))
                }, enabled = enabled, modifier = Modifier.semantics { contentDescription = "Original video sound" })
            }
            Text("Original · ${(audio.originalVolume * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
            Slider(audio.originalVolume, { onChange(audio.copy(originalVolume = it)) }, enabled = enabled,
                modifier = Modifier.semantics { contentDescription = "Original video volume" })
            Text("Play the selected video below to preview both sounds together.", style = MaterialTheme.typography.bodySmall)
        }
    }
}
