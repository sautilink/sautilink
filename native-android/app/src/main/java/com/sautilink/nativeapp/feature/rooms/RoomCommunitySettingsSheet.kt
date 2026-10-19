package com.sautilink.nativeapp.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

@Composable
internal fun RoomCommunitySettingsSheet(room: NativeRoom, state: RoomManagementState, onDismiss: () -> Unit) {
    if (!state.available || !room.canManageSettings) return
    val loaded = state.configuration
    if (loaded == null) {
        RoomSheet("Community settings", onDismiss) {
            if (state.configurationLoading) SautiPostSkeleton()
            state.configurationError?.let { RoomNotice(it, true, { state.loadConfiguration(room) }) }
        }
        return
    }
    var snapshot by remember(state.accountId, room.id) { mutableStateOf(loaded) }
    var rules by remember(state.accountId, room.id) { mutableStateOf(loaded.rules) }
    var questions by remember(state.accountId, room.id) { mutableStateOf(loaded.questions) }
    var attempted by remember(state.accountId, room.id) { mutableStateOf(false) }
    var reload by remember(state.accountId, room.id) { mutableStateOf(false) }
    val attached = remember(state.accountId, room.id) { AtomicBoolean(true) }
    DisposableEffect(attached) { onDispose { attached.set(false) } }
    val busy = state.savingConfiguration(room)
    LaunchedEffect(reload, state.configurationLoading, state.configuration, state.configurationError) {
        if (reload && !state.configurationLoading) {
            val fresh = state.configuration
            if (fresh != null && state.configurationError == null) {
                snapshot = fresh; rules = fresh.rules; questions = fresh.questions; attempted = false
            }
            reload = false
        }
    }
    val error = NativeRoomCommunityRules.configurationError(rules, questions)
    RoomSheet("Community settings", onDismiss) {
        Text("Help people understand your Room before they join.", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Room rules", style = MaterialTheme.typography.titleMedium)
        Text("Up to ten rules, in the order members will see them.", style = MaterialTheme.typography.bodySmall)
        rules.forEachIndexed { index, rule ->
            RoomRuleEditor(rule, index, rules.size, !busy && !reload,
                onChange = { changed -> rules = rules.map { if (it.id == rule.id) changed else it } },
                onRemove = { rules = rules.filterNot { it.id == rule.id } },
                onMove = { target -> rules = roomMoveItem(rules, index, target) })
        }
        OutlinedButton(onClick = { rules = rules + NativeRoomRule(UUID.randomUUID().toString(), "") },
            enabled = !busy && !reload && rules.size < NativeRoomCommunityRules.MAX_RULES,
            modifier = Modifier.fillMaxWidth()) { Text("Add rule (${rules.size}/10)") }
        HorizontalDivider()
        Text("Membership questions", style = MaterialTheme.typography.titleMedium)
        Text("Up to three questions. Answers are visible to the applicant and current Room staff.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        questions.forEachIndexed { index, question ->
            RoomQuestionEditor(question, index, questions.size, !busy && !reload,
                onChange = { changed -> questions = questions.map { if (it.id == question.id) changed else it } },
                onRemove = { questions = questions.filterNot { it.id == question.id } },
                onMove = { target -> questions = roomMoveItem(questions, index, target) })
        }
        OutlinedButton(onClick = { questions = questions + NativeRoomQuestion(UUID.randomUUID().toString(), "") },
            enabled = !busy && !reload && questions.size < NativeRoomCommunityRules.MAX_QUESTIONS,
            modifier = Modifier.fillMaxWidth()) { Text("Add question (${questions.size}/3)") }
        if (attempted && error != null) RoomNotice(error, true)
        state.configurationError?.let { RoomNotice(it, true) }
        Button(onClick = {
            attempted = true
            if (error == null) state.saveConfiguration(room, snapshot, rules, questions) {
                if (attached.get()) onDismiss()
            }
        }, enabled = !busy && !reload, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(if (busy) "Saving…" else "Save community settings")
        }
        if (state.configurationError != null) TextButton(onClick = {
            state.loadConfiguration(room); reload = true
        }, enabled = !busy && !reload) { Text(if (reload) "Reloading…" else "Discard edits and reload latest settings") }
    }
}

@Composable
private fun RoomRuleEditor(rule: NativeRoomRule, index: Int, count: Int, enabled: Boolean,
    onChange: (NativeRoomRule) -> Unit, onRemove: () -> Unit, onMove: (Int) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RoomEditorHeading("Rule ${index + 1}", index, count, enabled, onRemove, onMove)
            OutlinedTextField(rule.title, { onChange(rule.copy(title = boundedCommunityText(it, 121))) },
                enabled = enabled, label = { Text("Rule title") }, singleLine = true,
                supportingText = { Text("${NativeRoomCommunityRules.textLength(rule.title)}/120") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(rule.body, { onChange(rule.copy(body = boundedCommunityText(it, 1001))) },
                enabled = enabled, label = { Text("Description (optional)") }, minLines = 2,
                supportingText = { Text("${NativeRoomCommunityRules.textLength(rule.body)}/1000") }, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun RoomQuestionEditor(question: NativeRoomQuestion, index: Int, count: Int, enabled: Boolean,
    onChange: (NativeRoomQuestion) -> Unit, onRemove: () -> Unit, onMove: (Int) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RoomEditorHeading("Question ${index + 1}", index, count, enabled, onRemove, onMove)
            OutlinedTextField(question.prompt, { onChange(question.copy(prompt = boundedCommunityText(it, 301))) },
                enabled = enabled, label = { Text("Question") }, minLines = 2,
                supportingText = { Text("${NativeRoomCommunityRules.textLength(question.prompt)}/300") }, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Answer required", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Switch(question.required, { onChange(question.copy(required = it)) }, enabled = enabled)
            }
        }
    }
}

@Composable
private fun RoomEditorHeading(title: String, index: Int, count: Int, enabled: Boolean,
    onRemove: () -> Unit, onMove: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        IconButton(onClick = { onMove(index - 1) }, enabled = enabled && index > 0) {
            Icon(Icons.Rounded.ArrowUpward, "Move $title up")
        }
        IconButton(onClick = { onMove(index + 1) }, enabled = enabled && index < count - 1) {
            Icon(Icons.Rounded.ArrowDownward, "Move $title down")
        }
        IconButton(onClick = onRemove, enabled = enabled) { Icon(Icons.Rounded.Close, "Remove $title") }
    }
}

internal fun boundedCommunityText(value: String, max: Int): String {
    if (NativeRoomCommunityRules.textLength(value) <= max) return value
    return value.substring(0, value.offsetByCodePoints(0, max))
}

private fun <T> roomMoveItem(values: List<T>, from: Int, to: Int): List<T> {
    if (from !in values.indices || to !in values.indices) return values
    return values.toMutableList().apply { add(to, removeAt(from)) }
}
