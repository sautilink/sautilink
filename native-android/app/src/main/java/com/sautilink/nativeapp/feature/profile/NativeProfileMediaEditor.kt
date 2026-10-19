package com.sautilink.nativeapp.feature.profile

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.RectF
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddAPhoto
import androidx.compose.material.icons.rounded.Crop
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Owner-only controls. Final authority remains with the existing Worker + Supabase RLS. */
@Composable
internal fun NativeProfileMediaEditor(
    auth: StagingAuthClient,
    profile: NativeProfile,
    imageRevision: Int,
    onChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val client = remember(auth) { NativeProfileMediaClient(auth) }
    var ready by remember(auth.account?.id) { mutableStateOf(false) }
    var checking by remember(auth.account?.id) { mutableStateOf(true) }
    var readinessAttempt by remember(auth.account?.id) { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var editingSlot by remember { mutableStateOf("avatar") }
    var cropSlot by remember { mutableStateOf<String?>(null) }
    var source by remember { mutableStateOf<Bitmap?>(null) }
    var preparing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var removeSlot by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(auth.account?.id, readinessAttempt) {
        checking = true
        error = null
        try {
            ready = client.isReady()
            if (!ready) error = "Profile media service is not available yet."
        } catch (e: Exception) {
            ready = false
            error = e.message ?: "Could not connect to profile media."
        } finally { checking = false }
    }

    // Scoped photo picker works on supported Samsung/Android releases without broad gallery access.
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            error = null
            preparing = true
            val kind = editingSlot
            scope.launch {
                try {
                    source = decodeProfileCropSource(context, uri)
                    cropSlot = kind
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) { error = e.message ?: "Could not load photo." }
                finally { preparing = false }
            }
        }
    }

    Text("Profile photo and cover", style = MaterialTheme.typography.titleMedium)
    Text("Choose a photo, adjust the crop, and preview it before saving.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (profile.hasAvatar) {
            AuthorizedImage(auth, "/api/profile-media/${profile.username}/avatar?v=$imageRevision",
                "Current profile photo", Modifier.size(76.dp).clip(CircleShape))
        } else {
            Surface(Modifier.size(76.dp), shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.AddAPhoto, "No profile picture")
                }
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("Profile picture", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                OutlinedButton(
                    onClick = { editingSlot = "avatar"; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    enabled = ready && !busy && !preparing && !checking,
                    shape = RoundedCornerShape(13.dp)
                ) { Text(if (profile.hasAvatar) "Change" else "Add") }
                if (profile.hasAvatar) TextButton(
                    onClick = { removeSlot = "avatar" }, enabled = ready && !busy
                ) { Text("Remove") }
            }
        }
    }
    if (profile.hasHeader) {
        AuthorizedImage(auth, "/api/profile-media/${profile.username}/header?v=$imageRevision",
            "Current cover image", Modifier.fillMaxWidth().height(108.dp)
                .clip(RoundedCornerShape(13.dp)))
    } else {
        Surface(Modifier.fillMaxWidth().height(80.dp), shape = RoundedCornerShape(13.dp),
            color = MaterialTheme.colorScheme.primaryContainer) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.PhotoLibrary, "No cover photo")
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = {
            editingSlot = "header"
            gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }, enabled = ready && !busy && !preparing && !checking,
            shape = RoundedCornerShape(13.dp)) {
            Icon(Icons.Rounded.Crop, null, Modifier.size(18.dp))
            Spacer(Modifier.width(5.dp))
            Text(if (profile.hasHeader) "Change cover" else "Add cover")
        }
        if (profile.hasHeader) TextButton(
            onClick = { removeSlot = "header" }, enabled = ready && !busy
        ) { Text("Remove") }
    }
    if (checking || preparing || busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (error != null) Text(error.orEmpty(),
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall)
    if (!ready && !checking) {
        OutlinedButton(onClick = { readinessAttempt++ }, enabled = !busy && !preparing) {
            Text("Retry connection")
        }
    }
    HorizontalDivider(Modifier.padding(vertical = 8.dp))

    if (cropSlot != null && source != null) {
        val kind = cropSlot!!
        val bitmap = source!!
        ProfileCropDialog(bitmap, kind, busy = busy, error = error,
            onCancel = { if (!busy) { cropSlot = null; source = null } },
            onSave = { zoom, panX, panY ->
                if (busy) return@ProfileCropDialog
                busy = true
                error = null
                scope.launch {
                    try {
                        val jpeg = withContext(Dispatchers.Default) {
                            croppedProfileJpeg(bitmap, kind, zoom, panX, panY)
                        }
                        client.upload(kind, jpeg)
                        cropSlot = null
                        source = null
                        onChanged()
                    } catch (e: Exception) {
                        error = e.message ?: "Could not update profile media."
                    } finally { busy = false }
                }
            })
    }

    if (removeSlot != null) {
        val kind = removeSlot!!
        AlertDialog(onDismissRequest = { if (!busy) removeSlot = null },
            title = { Text(if (kind == "avatar") "Remove profile picture?" else "Remove cover image?") },
            text = { Text("The current image will be removed from your SautiLink profile.") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    busy = true; error = null
                    scope.launch {
                        try {
                            client.remove(kind)
                            removeSlot = null
                            onChanged()
                        } catch (e: Exception) {
                            error = e.message ?: "Could not remove image."
                        } finally { busy = false }
                    }
                }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = {
                removeSlot = null
            }) { Text("Cancel") } })
    }
}

@Composable
private fun ProfileCropDialog(
    bitmap: Bitmap,
    slot: String,
    busy: Boolean,
    error: String?,
    onCancel: () -> Unit,
    onSave: (Float, Float, Float) -> Unit
) {
    val aspect = if (slot == "avatar") 1f else 1440f / 540f
    var zoom by remember(bitmap, slot) { mutableFloatStateOf(1f) }
    var panX by remember(bitmap, slot) { mutableFloatStateOf(0f) }
    var panY by remember(bitmap, slot) { mutableFloatStateOf(0f) }
    val paint = remember { Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG) }
    Dialog(onDismissRequest = { if (!busy) onCancel() },
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth(.94f).wrapContentHeight(),
            shape = RoundedCornerShape(25.dp),
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(13.dp)) {
                Text(if (slot == "avatar") "Crop profile picture" else "Crop cover",
                    style = MaterialTheme.typography.titleLarge)
                Text("Drag the picture to position it. Pinch or slide to zoom.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Canvas(
                    Modifier.fillMaxWidth().aspectRatio(aspect)
                        .clip(if (slot == "avatar") CircleShape else RoundedCornerShape(13.dp))
                        .pointerInput(bitmap, slot, busy) {
                            if (!busy) detectTransformGestures { _, pan, pinch, _ ->
                                zoom = (zoom * pinch).coerceIn(1f, 3f)
                                if (size.width > 0 && size.height > 0) {
                                    panX = (panX - pan.x / size.width * 2f).coerceIn(-1f, 1f)
                                    panY = (panY - pan.y / size.height * 2f).coerceIn(-1f, 1f)
                                }
                            }
                        }
                ) {
                    val src = profileCropSourceRect(bitmap, slot, zoom, panX, panY)
                    drawIntoCanvas { canvas ->
                        canvas.nativeCanvas.drawBitmap(bitmap, src,
                            RectF(0f, 0f, size.width, size.height), paint)
                    }
                }
                Text("Zoom", style = MaterialTheme.typography.labelMedium)
                Slider(value = zoom, onValueChange = { zoom = it }, valueRange = 1f..3f,
                    enabled = !busy)
                // Accessible position controls remain usable when a device intercepts touch gestures.
                Text("Horizontal position", style = MaterialTheme.typography.labelSmall)
                Slider(value = panX, onValueChange = { panX = it }, valueRange = -1f..1f,
                    enabled = !busy)
                Text("Vertical position", style = MaterialTheme.typography.labelSmall)
                Slider(value = panY, onValueChange = { panY = it }, valueRange = -1f..1f,
                    enabled = !busy)
                if (error != null) {
                    Text(error, color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                    Text("Adjust the crop or tap Save photo to retry.",
                        style = MaterialTheme.typography.bodySmall)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onCancel, enabled = !busy,
                        modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) {
                        Text("Cancel")
                    }
                    Button(onClick = { onSave(zoom, panX, panY) }, enabled = !busy,
                        modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) {
                        Text(if (busy) "Uploading…" else "Save photo")
                    }
                }
            }
        }
    }
}
