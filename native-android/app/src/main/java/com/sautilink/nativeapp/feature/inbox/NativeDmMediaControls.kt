package com.sautilink.nativeapp.feature.inbox

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.provider.OpenableColumns
import android.net.Uri
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.animation.core.*
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.delay
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.File

private fun fileName(context: Context, uri: Uri, fallback: String): String {
    val query = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
    return query?.use {
        if (it.moveToFirst()) it.getString(0)?.take(180) ?: fallback else fallback
    } ?: fallback
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeDmMediaControls(
    auth: StagingAuthClient,
    conversationId: String,
    onSent: () -> Unit,
    onError: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val client = remember(auth) { NativeDmMediaClient(auth) }
    var menu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recordStart by remember { mutableLongStateOf(0L) }
    var recordElapsed by remember { mutableLongStateOf(0L) }
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var recordedFile by remember { mutableStateOf<File?>(null) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    var cameraFile by remember { mutableStateOf<File?>(null) }

    fun send(bytes: ByteArray, kind: String, mime: String, name: String, durationMs: Int = 0) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                client.uploadAndSend(conversationId, kind, mime, name, bytes, durationMs)
                onSent()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { onError(e.message ?: "Could not send attachment.") }
            finally { busy = false }
        }
    }

    fun sendUri(uri: Uri?, kind: String, cleanup: File? = null) {
        if (uri == null) return
        scope.launch {
            try {
                val mime = context.contentResolver.getType(uri).orEmpty()
                val name = fileName(context, uri,
                    if (kind == "photo") "photo.jpg" else "document")
                val bytes = client.readDocument(context, uri)
                send(bytes, kind, mime, name)
            } catch (e: Exception) {
                onError(e.message ?: "Could not read selected file.")
            } finally { cleanup?.delete() }
        }
    }

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) {
        sendUri(it, "photo")
    }
    val document = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) {
        sendUri(it, "file")
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) {
        if (it) sendUri(cameraUri, "photo", cameraFile)
        else cameraFile?.delete()
        cameraUri = null
        cameraFile = null
    }

    fun startVoice() {
        try {
            val directory = File(context.cacheDir, "voice-notes").apply { mkdirs() }
            val output = File.createTempFile("sauti_voice_", ".m4a", directory)
            @Suppress("DEPRECATION")
            val device = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
            device.setAudioSource(MediaRecorder.AudioSource.MIC)
            device.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            device.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            device.setAudioEncodingBitRate(48_000)
            device.setAudioSamplingRate(44_100)
            device.setOutputFile(output.absolutePath)
            device.prepare()
            device.start()
            recorder = device
            recordedFile = output
            recordStart = SystemClock.elapsedRealtime()
            recordElapsed = 0L
            recording = true
        } catch (e: Exception) {
            recorder?.release(); recorder = null
            recordedFile?.delete(); recordedFile = null
            recording = false
            onError("Could not start microphone recording.")
        }
    }

    fun stopVoice(cancel: Boolean = false) {
        if (!recording) return
        val elapsed = (SystemClock.elapsedRealtime() - recordStart).toInt().coerceAtMost(60_000)
        recording = false
        try {
            recorder?.stop()
            recorder?.release()
            recorder = null
            val file = recordedFile
            recordedFile = null
            if (cancel || elapsed < 500) {
                file?.delete()
                if (!cancel) onError("Hold the microphone longer to record.")
                return
            }
            if (file != null) {
                val bytes = file.readBytes()
                file.delete()
                send(bytes, "voice", "audio/mp4", "voice.m4a", elapsed)
            }
        } catch (e: Exception) {
            recorder?.release(); recorder = null
            recordedFile?.delete(); recordedFile = null
            onError("Voice recording could not be saved.")
        }
    }

    val microphonePermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startVoice()
        else onError("Microphone permission is required for voice notes.")
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            // Leaving the app must not leave a live microphone draft that can
            // later auto-send at the one-minute limit.
            if (event == Lifecycle.Event.ON_STOP) stopVoice(cancel = true)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(recording) {
        while (recording) {
            recordElapsed = (SystemClock.elapsedRealtime() - recordStart).coerceAtMost(60_000)
            if (recordElapsed >= 60_000) {
                stopVoice()
                break
            }
            delay(100)
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            if (recording) {
                runCatching { recorder?.stop() }
                recorder?.release()
                recordedFile?.delete()
            }
        }
    }

    if (recording) {
        val fraction = (recordElapsed.toFloat() / 60_000f).coerceIn(0f, 1f)
        val seconds = (recordElapsed / 1_000).toInt()
        val pulse = rememberInfiniteTransition(label = "recordingPulse")
        val alpha by pulse.animateFloat(0.35f, 1f,
            infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "pulse")
        ModalBottomSheet(onDismissRequest = { stopVoice(cancel = true) },
            dragHandle = null, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(12.dp).alpha(alpha)
                        .background(MaterialTheme.colorScheme.error, CircleShape))
                    Text("Recording voice note",
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                Text("%d:%02d".format(seconds / 60, seconds % 60),
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.SemiBold)
                Row(Modifier.fillMaxWidth().height(40.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically) {
                    repeat(25) { i ->
                        val height = 9.dp + ((i * 7 + seconds * 5) % 23).dp
                        Box(Modifier.width(3.dp).height(height)
                            .background(MaterialTheme.colorScheme.primary,
                                RoundedCornerShape(3.dp)))
                        Spacer(Modifier.width(3.dp))
                    }
                }
                LinearProgressIndicator(progress = { fraction },
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                    color = MaterialTheme.colorScheme.primary)
                Text("Maximum 1 minute · Only you can hear the draft",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = { stopVoice(cancel = true) },
                        shape = RoundedCornerShape(20.dp),
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Icon(Icons.Rounded.DeleteOutline, null, Modifier.size(19.dp))
                        Spacer(Modifier.width(7.dp))
                        Text("Discard")
                    }
                    Button(onClick = { stopVoice() },
                        shape = RoundedCornerShape(20.dp),
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Icon(Icons.Rounded.Send, null, Modifier.size(19.dp))
                        Spacer(Modifier.width(7.dp))
                        Text("Send")
                    }
                }
            }
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box {
            IconButton(onClick = { menu = true }, enabled = !busy && !recording,
                modifier = Modifier.size(44.dp)) {
                Icon(Icons.Rounded.AddCircleOutline, "Attach photo, camera or document")
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Photo gallery") },
                    leadingIcon = { Icon(Icons.Rounded.Image, null) }, onClick = {
                        menu = false; gallery.launch("image/*")
                    })
                DropdownMenuItem(text = { Text("Document") },
                    leadingIcon = { Icon(Icons.Rounded.Description, null) }, onClick = {
                        menu = false; document.launch("*/*")
                    })
                DropdownMenuItem(text = { Text("Camera") },
                    leadingIcon = { Icon(Icons.Rounded.PhotoCamera, null) }, onClick = {
                        menu = false
                        try {
                            val dir = File(context.cacheDir, "chat-camera").apply { mkdirs() }
                            val file = File.createTempFile("sauti_camera_", ".jpg", dir)
                            val capture = FileProvider.getUriForFile(context,
                                context.packageName + ".fileprovider", file)
                            cameraFile = file
                            cameraUri = capture
                            camera.launch(capture)
                        } catch (_: Exception) { onError("Camera is unavailable.") }
                    })
            }
        }
        IconButton(
            onClick = {
                if (recording) stopVoice()
                else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) startVoice()
                else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
            },
            enabled = !busy,
            modifier = Modifier.size(44.dp)
        ) {
            Icon(if (recording) Icons.Rounded.StopCircle else Icons.Rounded.Mic,
                if (recording) "Stop and send voice note" else "Record voice note (max 1 minute)",
                tint = if (recording) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurface)
        }
        if (recording) Text("REC", color = MaterialTheme.colorScheme.error,
            fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelSmall)
        if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeDmAttachmentBubble(
    auth: StagingAuthClient,
    media: DmMedia,
    modifier: Modifier = Modifier,
    autoLoadPhotos: Boolean = true,
    isOutgoing: Boolean = false,
    onLongClick: (() -> Unit)? = null,
    onError: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val client = remember(auth) { NativeDmMediaClient(auth) }
    val context = LocalContext.current
    var download by remember { mutableStateOf(false) }
    var openPhoto by remember(media.id, autoLoadPhotos) { mutableStateOf(autoLoadPhotos) }
    var destinationMedia by remember { mutableStateOf<DmMedia?>(null) }
    val fileSave = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        val chosen = destinationMedia
        if (uri != null && chosen != null) {
            scope.launch {
                download = true
                try {
                    val bytes = client.downloadMedia(chosen.id)
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            ?: throw IllegalStateException("Unable to save document.")
                    }
                } catch (e: Exception) { onError(e.message ?: "Download failed.") }
                finally { download = false }
            }
        }
    }
    when (media.kind) {
        "photo" -> {
            if (openPhoto) NativeDmCachedPhoto(
                auth = auth, media = media, modifier = modifier, onLongClick = onLongClick,
                onError = onError)
            else OutlinedButton(onClick = { openPhoto = true },
                shape = RoundedCornerShape(15.dp)) {
                Icon(Icons.Rounded.Image, null)
                Spacer(Modifier.width(6.dp))
                Text("Show photo")
            }
        }
        "voice" -> NativeVoiceNotePlayer(auth, media.id, media.durationMs)
        else -> {
            val foreground = if (isOutgoing) Color.White else MaterialTheme.colorScheme.onSurface
            Surface(
                modifier = modifier.fillMaxWidth().heightIn(min = 60.dp)
                    .combinedClickable(enabled = !download, role = Role.Button,
                        onLongClick = onLongClick,
                        onLongClickLabel = if (onLongClick != null) "Select message" else null,
                        onClick = {
                            destinationMedia = media
                            fileSave.launch(media.name.ifBlank { "SautiLink-document" })
                        }),
                shape = RoundedCornerShape(14.dp),
                color = if (isOutgoing) Color.White.copy(alpha = .15f)
                    else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = foreground
            ) {
                Row(Modifier.padding(horizontal = 11.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.Description, contentDescription = null,
                        tint = foreground, modifier = Modifier.size(25.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(media.name.ifBlank { "SautiLink document" },
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold, maxLines = 2,
                            color = foreground)
                        Text("${(media.bytes / 1024).coerceAtLeast(1)} KB · Tap to save",
                            style = MaterialTheme.typography.labelSmall,
                            color = foreground.copy(alpha = .78f))
                    }
                    if (download) CircularProgressIndicator(Modifier.size(17.dp),
                        strokeWidth = 2.dp, color = foreground)
                    else Icon(Icons.Rounded.Download, "Save document",
                        tint = foreground, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun NativeVoiceNotePlayer(auth: StagingAuthClient, id: String, durationMs: Int) {
    val context = LocalContext.current
    var playing by remember(id) { mutableStateOf(false) }
    var preparing by remember(id) { mutableStateOf(false) }
    var player by remember(id) { mutableStateOf<MediaPlayer?>(null) }
    val scope = rememberCoroutineScope()
    DisposableEffect(id) {
        onDispose { player?.release() }
    }
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        IconButton(onClick = {
            if (playing) {
                player?.pause(); playing = false
            } else if (player != null) {
                player?.start(); playing = true
            } else {
                preparing = true
                scope.launch {
                    try {
                        val token = auth.accessTokenForStagingRead()
                        val next = MediaPlayer()
                        next.setOnPreparedListener { it.start(); playing = true; preparing = false }
                        next.setOnCompletionListener { playing = false; it.seekTo(0) }
                        next.setOnErrorListener { _, _, _ -> playing = false; preparing = false; true }
                        next.setDataSource(context,
                            Uri.parse(auth.backend.siteOrigin + "/api/dm-media/$id"),
                            mapOf("Authorization" to "Bearer $token"))
                        player = next
                        next.prepareAsync()
                    } catch (_: Exception) { preparing = false; playing = false }
                }
            }
        }, enabled = !preparing) {
            Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                if (playing) "Pause voice note" else "Play voice note")
        }
        Text("Voice note · ${(durationMs / 1000).coerceAtLeast(1)}s",
            style = MaterialTheme.typography.bodySmall)
        if (preparing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
    }
}
