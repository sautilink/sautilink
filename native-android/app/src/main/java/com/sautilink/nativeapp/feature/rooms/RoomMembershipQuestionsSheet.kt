package com.sautilink.nativeapp.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import java.util.concurrent.atomic.AtomicBoolean

@Composable
internal fun RoomMembershipQuestionsSheet(room: NativeRoom, state: RoomManagementState, onDismiss: () -> Unit,
    actionKind: String = if (room.policy == "approval") "request" else "join", onConfirmed: (NativeRoomMembershipResult) -> Unit) {
    if (!state.available) return
    val loaded = state.configuration
    if (loaded == null) {
        RoomSheet("Join ${room.name}", onDismiss) {
            if (state.configurationLoading) SautiPostSkeleton()
            state.configurationError?.let { RoomNotice(it, true, { state.loadConfiguration(room) }) }
        }
        return
    }
    var snapshot by remember(state.accountId, room.id) { mutableStateOf(loaded) }
    val answers = remember(state.accountId, room.id) { mutableStateMapOf<String, String>() }
    var attempted by remember(state.accountId, room.id) { mutableStateOf(false) }
    var reload by remember(state.accountId, room.id) { mutableStateOf(false) }
    val attached = remember(state.accountId, room.id) { AtomicBoolean(true) }
    DisposableEffect(attached) { onDispose { attached.set(false) } }
    val busy = state.joining(room)
    LaunchedEffect(reload, state.configurationLoading, state.configuration, state.configurationError) {
        if (reload && !state.configurationLoading) {
            val fresh = state.configuration
            if (fresh != null && state.configurationError == null) { snapshot = fresh; answers.clear(); attempted = false }
            reload = false
        }
    }
    val values = snapshot.questions.map { NativeRoomMembershipAnswer(it.id, answers[it.id].orEmpty()) }
    val error = NativeRoomCommunityRules.answersError(snapshot.questions, values)
    RoomSheet("Join ${room.name}", onDismiss) {
        RoomRulesContent(snapshot.rules)
        if (snapshot.questions.isNotEmpty()) {
            RoomSectionHeading("Before you join")
            Text("Your answers are visible to you and current Room staff.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            snapshot.questions.forEach { question ->
                RoomMembershipQuestionField(question, answers[question.id].orEmpty(), !busy && !reload) {
                    answers[question.id] = boundedCommunityText(it, 1001)
                }
            }
        }
        if (attempted && error != null) RoomNotice(error, true)
        state.membershipError?.let { RoomNotice(it, true) }
        state.configurationError?.let { RoomNotice(it, true) }
        Button(onClick = {
            attempted = true
            if (error == null) state.requestMembership(room, snapshot, values, actionKind) {
                onConfirmed(it)
                if (attached.get()) onDismiss()
            }
        }, enabled = !busy && !reload, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            RoomActionLabel(if (busy) "Sending…" else if (actionKind == "accept_invitation") "Accept invitation"
                else if (actionKind == "request") "Request to join" else "Join Room", Icons.Rounded.PersonAdd)
        }
        if (state.membershipError != null || state.configurationError != null) TextButton(onClick = {
            state.reloadMembershipQuestions(room); reload = true
        }, enabled = !busy && !reload) { Text(if (reload) "Reloading…" else "Reload questions and clear answers") }
    }
}

@Composable
private fun RoomMembershipQuestionField(question: NativeRoomQuestion, answer: String, enabled: Boolean,
    onAnswer: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(question.prompt, style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(answer, onAnswer, label = { Text(if (question.required) "Required answer" else "Answer (optional)") },
            supportingText = { Text("${NativeRoomCommunityRules.textLength(answer)}/1000") }, minLines = 2, enabled = enabled,
            modifier = Modifier.fillMaxWidth())
    }
}

@Composable
internal fun RoomMembershipAnswersSheet(room: NativeRoom, state: RoomManagementState, requesterId: String,
    onDismiss: () -> Unit) {
    if (!state.available || requesterId != state.accountId && !room.isStaff) return
    LaunchedEffect(state.accountId, room.id, room.role, requesterId) { state.loadMembershipAnswers(room, requesterId) }
    DisposableEffect(state, room.id, requesterId) { onDispose { state.clearMembershipAnswers() } }
    RoomSheet("Membership answers", onDismiss) {
        if (state.answersLoading) SautiPostSkeleton()
        state.answersError?.let { RoomNotice(it, true, { state.loadMembershipAnswers(room, requesterId) }) }
        val snapshot = state.membershipAnswers
        if (snapshot != null && snapshot.requesterId == requesterId) {
            Text("Answers submitted with this membership request.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (snapshot.questions.isEmpty()) Text("No membership questions were configured for this request.",
                style = MaterialTheme.typography.bodyMedium)
            val byQuestion = snapshot.answers.associateBy { it.questionId }
            snapshot.questions.forEach { question ->
                Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(question.prompt, style = MaterialTheme.typography.titleSmall)
                        Text(byQuestion[question.id]?.answer?.ifBlank { "No answer provided." } ?: "No answer provided.",
                            style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
