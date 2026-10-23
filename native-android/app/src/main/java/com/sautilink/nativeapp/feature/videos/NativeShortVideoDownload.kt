package com.sautilink.nativeapp.feature.videos

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Credentials stay exclusively in the existing auth client. Intent extras hold
 * an opaque, single-use in-memory ticket ID, never a bearer or account secret.
 */
internal class NativeShortVideoDownloadTicket(val auth: StagingAuthClient, val owner: String,
    val mediaId: String, val postId: String) {
    val id: String = UUID.randomUUID().toString()
    val cancelled = AtomicBoolean(false)
    @Volatile var cancelNetwork: (() -> Unit)? = null
    fun active(): Boolean = !cancelled.get() && auth.account?.id == owner && auth.sessionState == StagingSessionState.SIGNED_IN
    fun cancel() { cancelled.set(true); runCatching { cancelNetwork?.invoke() } }
}

internal object NativeShortVideoDownloads {
    private var current: NativeShortVideoDownloadTicket? = null
    @Synchronized fun reserve(auth: StagingAuthClient, owner: String, mediaId: String, postId: String): NativeShortVideoDownloadTicket? {
        if (current != null || auth.account?.id != owner || auth.sessionState != StagingSessionState.SIGNED_IN ||
            !nativeShortVideoDownloadIdentityValid(mediaId, postId)) return null
        return NativeShortVideoDownloadTicket(auth, owner, mediaId, postId).also { current = it }
    }
    @Synchronized fun find(id: String?): NativeShortVideoDownloadTicket? = current?.takeIf { it.id == id }
    @Synchronized fun release(ticket: NativeShortVideoDownloadTicket) { if (current === ticket) current = null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun rememberShortVideoDownloadAction(auth: StagingAuthClient, mediaId: String, postId: String): () -> Unit {
    val context = LocalContext.current
    val owner = auth.account?.id
    var open by remember(auth, owner, mediaId, postId) { mutableStateOf(false) }
    // Keep the original permission request owner across an account change.
    // Its result must never start the old action for the newly signed-in user.
    var permissionOwner by remember(auth, mediaId, postId) { mutableStateOf<String?>(null) }
    val start: () -> Unit = {
        val account = owner
        val ticket = if (account == null) null else NativeShortVideoDownloads.reserve(auth, account, mediaId, postId)
        if (ticket == null) Toast.makeText(context, "A download is already running, or this video is unavailable.", Toast.LENGTH_SHORT).show()
        else try {
            ContextCompat.startForegroundService(context, Intent(context, NativeShortVideoDownloadService::class.java)
                .setAction(NativeShortVideoDownloadService.ACTION_START).putExtra(NativeShortVideoDownloadService.EXTRA_TICKET, ticket.id))
        } catch (_: Exception) {
            ticket.cancel(); NativeShortVideoDownloads.release(ticket)
            Toast.makeText(context, "The download could not start. Try again.", Toast.LENGTH_SHORT).show()
        }
    }
    val latestStart by rememberUpdatedState(start)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val expectedOwner = permissionOwner
        permissionOwner = null
        if (expectedOwner == null || auth.account?.id != expectedOwner || owner != expectedOwner) return@rememberLauncherForActivityResult
        val canWrite = Build.VERSION.SDK_INT >= 29 || result[Manifest.permission.WRITE_EXTERNAL_STORAGE] == true ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        if (canWrite) latestStart() else Toast.makeText(context, "Allow storage access to save this video.", Toast.LENGTH_SHORT).show()
    }
    if (open) ModalBottomSheet(onDismissRequest = { open = false }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Icon(Icons.Rounded.Download, null, Modifier.size(28.dp))
            Text("Download video", style = MaterialTheme.typography.titleLarge)
            Text("Save this video to your device. You can follow its progress or cancel from notifications.", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = {
                open = false
                val needed = mutableListOf<String>()
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    needed += Manifest.permission.POST_NOTIFICATIONS
                if (Build.VERSION.SDK_INT <= 28 && ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED)
                    needed += Manifest.permission.WRITE_EXTERNAL_STORAGE
                if (needed.isEmpty()) start() else {
                    permissionOwner = owner
                    permission.launch(needed.toTypedArray())
                }
            }, modifier = Modifier.fillMaxWidth()) { Text("Download") }
            TextButton(onClick = { open = false }, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
        }
    }
    return remember(auth, owner, mediaId, postId) { { open = true } }
}
