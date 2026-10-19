package com.sautilink.nativeapp.feature.safety

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeReportDialog(label: String, busy: Boolean, error: String? = null, onDismiss: () -> Unit,
    onSubmit: (reason: String, details: String) -> Unit) {
    var reason by remember(label) { mutableStateOf("") }
    var details by remember(label) { mutableStateOf("") }
    val options = listOf("spam" to "Spam", "harassment" to "Harassment",
        "hate" to "Hate", "impersonation" to "Impersonation",
        "privacy" to "Privacy", "other" to "Other")
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() },
        icon = { Icon(Icons.Rounded.Flag, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text("Report $label") },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Choose a reason. A safety reviewer will assess your report.")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), maxItemsInEachRow = 2) {
                    options.forEach { (value, text) ->
                        FilterChip(selected = reason == value, onClick = { reason = value },
                            enabled = !busy, modifier = Modifier.heightIn(min = 48.dp), label = { Text(text) },
                            leadingIcon = { Icon(if (reason == value) Icons.Rounded.Check else when (value) {
                                "spam" -> Icons.Rounded.Block
                                "harassment" -> Icons.Rounded.Report
                                "hate" -> Icons.Rounded.GppBad
                                "impersonation" -> Icons.Rounded.PersonOutline
                                "privacy" -> Icons.Rounded.Lock
                                else -> Icons.Rounded.MoreHoriz
                            }, null, Modifier.size(18.dp), selected = reason == value) })
                    }
                }
                OutlinedTextField(details, { details = it.take(2000) },
                    label = { Text("Details (optional)") }, modifier = Modifier.fillMaxWidth(),
                    minLines = 2, maxLines = 4, enabled = !busy,
                    supportingText = { Text("${details.length}/2000") })
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
            }
        }, confirmButton = {
            TextButton(onClick = { onSubmit(reason, details) }, enabled = reason.isNotBlank() && !busy) {
                Text(if (busy) "Sending…" else "Submit report")
            }
        }, dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
        })
}
