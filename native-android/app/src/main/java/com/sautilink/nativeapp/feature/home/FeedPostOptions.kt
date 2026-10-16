package com.sautilink.nativeapp.feature.home

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.safety.NativeReportDialog
import com.sautilink.nativeapp.feature.safety.NativeSafetyClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Keep the feed and its decoder mounted while opening post controls. */
@Composable
internal fun FeedPostOptions(
    post: StagingFeedPost, auth: StagingAuthClient, online: Boolean,
    onOpenProfile: () -> Unit, onOpenPost: () -> Unit, onShare: () -> Unit
) {
    val accountId = auth.account?.id
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val safety = remember(auth) { NativeSafetyClient(auth) }
    var expanded by remember(post.id, accountId) { mutableStateOf(false) }
    var reportOpen by remember(post.id, accountId) { mutableStateOf(false) }
    var busy by remember(post.id, accountId) { mutableStateOf(false) }
    var error by remember(post.id, accountId) { mutableStateOf<String?>(null) }
    var submitted by remember(post.id, accountId) { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Rounded.MoreHoriz, contentDescription = "Post options", modifier = Modifier.size(23.dp))
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("View profile") }, enabled = post.authorHandle.isNotBlank(),
                onClick = { expanded = false; onOpenProfile() })
            DropdownMenuItem(text = { Text("Copy link") }, onClick = {
                expanded = false
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("SautiLink post", "https://sautilink.com/post/${post.id}"))
            })
            DropdownMenuItem(text = { Text("Share") }, onClick = { expanded = false; onShare() })
            DropdownMenuItem(text = { Text("View post") }, onClick = { expanded = false; onOpenPost() })
            if (accountId != null && post.authorId != accountId) {
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Report", color = MaterialTheme.colorScheme.error) },
                    enabled = online && !busy, onClick = { expanded = false; error = null; reportOpen = true })
            }
        }
    }
    if (reportOpen) NativeReportDialog("post", busy, error,
        onDismiss = { if (!busy) reportOpen = false }) { reason, details ->
        if (busy || !online || auth.account?.id != accountId) return@NativeReportDialog
        busy = true
        error = null
        scope.launch {
            try {
                safety.report("post", post.id, reason, details)
                if (auth.account?.id == accountId) { reportOpen = false; submitted = true }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (auth.account?.id == accountId) error = failure.message ?: "Could not report post."
            } finally { busy = false }
        }
    }
    if (submitted) AlertDialog(onDismissRequest = { submitted = false },
        title = { Text("Report submitted") }, text = { Text("A safety reviewer will assess your report.") },
        confirmButton = { TextButton(onClick = { submitted = false }) { Text("Done") } })
}
