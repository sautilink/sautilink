package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.safety.NativeReportDialog
import com.sautilink.nativeapp.feature.safety.NativeSafetyClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun NativePostDetailScreen(auth: StagingAuthClient, postId: String, onBack: () -> Unit,
    onSignIn: () -> Unit, onOpenProfile: (String) -> Unit) {
    val client = remember(auth) { StagingFeedClient(auth) }
    val safety = remember(auth) { NativeSafetyClient(auth) }
    val scope = rememberCoroutineScope()
    var post by remember(postId) { mutableStateOf<StagingFeedPost?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var reportOpen by remember(postId) { mutableStateOf(false) }
    var reportBusy by remember(postId) { mutableStateOf(false) }
    var reportNote by remember(postId) { mutableStateOf<String?>(null) }
    LaunchedEffect(auth.account?.id, postId, refresh) {
        if (auth.account == null) { post = null; return@LaunchedEffect }
        loading = true; error = null
        try { post = client.loadOne(postId) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not open post." }
        finally { loading = false }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Post", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, "Refresh post") }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (auth.account == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Sign in to see this post.")
                Spacer(Modifier.height(12.dp))
                Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else if (error != null) Text(error.orEmpty(), Modifier.padding(20.dp), color = MaterialTheme.colorScheme.error)
        else if (!loading && post == null) Text("This post is unavailable or you do not have access.",
            Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        else post?.let { item ->
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.clickable(enabled = item.authorHandle.isNotBlank()) {
                    onOpenProfile(item.authorHandle)
                }) {
                    Text(item.authorName, fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleMedium)
                    Text("@${item.authorHandle} · ${item.createdAt.take(10)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(item.body.ifBlank { "Media post" }, style = MaterialTheme.typography.bodyLarge)
                if (item.media.isNotEmpty()) PostMediaGallery(auth, item.media)
                HorizontalDivider()
                Text("${item.likes} likes · ${item.comments} comments · ${item.reposts} reposts",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.authorId != auth.account?.id) {
                    TextButton(onClick = { reportOpen = true }) { Text("Report post") }
                }
                if (reportNote != null) Text(reportNote.orEmpty(),
                    color = if (reportNote == "Report submitted.") MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.error)
            }
        }
    }
    if (reportOpen) NativeReportDialog("post", reportBusy, error = reportNote,
        onDismiss = { reportOpen = false }) { reason, details ->
        reportBusy = true; reportNote = null
        scope.launch {
            try { safety.report("post", postId, reason, details); reportOpen = false; reportNote = "Report submitted." }
            catch (e: Exception) { reportNote = e.message ?: "Could not send report." }
            finally { reportBusy = false }
        }
    }
}
