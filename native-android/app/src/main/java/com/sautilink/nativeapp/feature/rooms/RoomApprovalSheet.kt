package com.sautilink.nativeapp.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.home.FeedMedia
import com.sautilink.nativeapp.feature.home.PostMediaGallery
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import com.sautilink.nativeapp.ui.components.SautiPostText

/** This surface is unreachable unless the real server reports versioned approval support. */
@Composable
internal fun RoomApprovalSheet(room: NativeRoom, state: RoomsState, onDismiss: () -> Unit,
    onOpenProfile: (String) -> Unit, onOpenPost: (String) -> Unit) {
    if (!room.supportsPostApproval) return
    var reject by remember(state.accountId, room.id) { mutableStateOf<NativeRoomSubmission?>(null) }
    LaunchedEffect(state.accountId, room.id) { state.loadSubmissions() }
    RoomSheet(if (room.isStaff) "Post approvals" else "Your submissions", onDismiss) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(state.submissionFilter == "pending", { state.submissionFilter = "pending"; state.loadSubmissions() }, label = { Text("Pending") })
            FilterChip(state.submissionFilter == "all", { state.submissionFilter = "all"; state.loadSubmissions() }, label = { Text("History") })
            TextButton(onClick = { state.loadSubmissions() }, enabled = !state.submissionsLoading) { Text("Refresh") }
        }
        if (state.submissionError != null) RoomNotice(state.submissionError.orEmpty(), true,
            if (state.canRetrySubmission) state::retrySubmission else ({ state.loadSubmissions() }))
        val height = (LocalConfiguration.current.screenHeightDp * .62f).dp
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = height), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(state.submissions, key = { it.id }) { submission ->
                RoomSubmissionCard(room, state, submission, onOpenProfile, onOpenPost, { reject = submission })
            }
            if (state.submissionsLoading) item { SautiPostSkeleton() }
            if (!state.submissionsLoading && state.submissions.isEmpty() && state.submissionError == null) item {
                RoomEmpty("No ${if (state.submissionFilter == "pending") "pending posts" else "submissions"}",
                    if (room.isStaff) "Member submissions will appear here." else "Your submitted posts will appear here.")
            }
            if (state.submissionsCursor != null) item {
                OutlinedButton(onClick = { state.loadSubmissions(true) }, enabled = !state.submissionsLoading,
                    modifier = Modifier.fillMaxWidth()) { Text("Load more submissions") }
            }
        }
    }
    reject?.let { submission ->
        var reason by remember(submission.id, submission.version) { mutableStateOf("") }
        AlertDialog(onDismissRequest = { reject = null }, title = { Text("Reject this post?") },
            text = { OutlinedTextField(reason, { reason = it.take(501) }, label = { Text("Reason for the author") },
                supportingText = { Text("${reason.length}/500") }, minLines = 2) },
            confirmButton = { TextButton(onClick = { reject = null; state.decideSubmission(submission, false, reason.trim()) },
                enabled = reason.trim().isNotEmpty() && reason.length <= 500) { Text("Reject") } },
            dismissButton = { TextButton(onClick = { reject = null }) { Text("Cancel") } })
    }
}

@Composable
private fun RoomSubmissionCard(room: NativeRoom, state: RoomsState, submission: NativeRoomSubmission,
    onOpenProfile: (String) -> Unit, onOpenPost: (String) -> Unit, onReject: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            RoomPerson(state.auth, submission.authorName, submission.authorHandle, null,
                submission.verified, submission.badgeType, submission.hasAvatar, { onOpenProfile(submission.authorHandle) })
            Text(submission.state.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary)
            SautiPostText(submission.body, style = MaterialTheme.typography.bodyLarge)
            val feeds = remember(submission.media, submission.state) { (if (submission.state == "pending") submission.media else emptyList()).map {
                FeedMedia(it.id, it.kind, it.position, it.width, it.height)
            } }
            PostMediaGallery(state.auth, feeds, mediaPath = { media ->
                submission.media.first { it.id == media.id }.path(room.id, submission.id)
            })
            if (submission.state == "pending" && submission.mediaCount > 0 && submission.media.isEmpty())
                OutlinedButton(onClick = { state.loadSubmissionMedia(submission) },
                    enabled = !state.busy("submission-media:${submission.id}")) {
                    Text(if (state.busy("submission-media:${submission.id}")) "Loading attachments…" else "Review attachments (${submission.mediaCount})")
                }
            if (submission.decisionReason.isNotBlank()) Text(submission.decisionReason, style = MaterialTheme.typography.bodyMedium)
            if (submission.state == "approved" && submission.publishedPostId == null)
                Text("Post unavailable", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (submission.state == "pending") {
                if (submission.authorId == state.accountId) OutlinedButton(
                    onClick = { state.withdrawSubmission(submission) }, enabled = !state.busy("submission:${submission.id}")) {
                    Text("Withdraw submission")
                } else if (room.isStaff) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { state.decideSubmission(submission, true) }, enabled = !state.busy("submission:${submission.id}"),
                        modifier = Modifier.weight(1f)) { Text("Approve") }
                    OutlinedButton(onClick = onReject, enabled = !state.busy("submission:${submission.id}"),
                        modifier = Modifier.weight(1f)) { Text("Reject") }
                }
            }
            submission.publishedPostId?.let { id -> TextButton(onClick = { onOpenPost(id) }) { Text("View published post") } }
        }
    }
}

