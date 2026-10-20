package com.sautilink.nativeapp.feature.safety

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun NativeReportDialog(label: String, busy: Boolean, error: String? = null, onDismiss: () -> Unit,
    onSubmit: (reason: String, details: String) -> Unit) {
    var reason by remember(label) { mutableStateOf("") }
    var details by remember(label) { mutableStateOf("") }
    val options = listOf("spam" to "Spam", "harassment" to "Harassment",
        "hate" to "Hate", "impersonation" to "Impersonation",
        "privacy" to "Privacy", "other" to "Other")
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Report $label") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Choose a reason. A safety reviewer will assess your report.")
                options.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { (value, text) ->
                            FilterChip(selected = reason == value, onClick = { reason = value },
                                enabled = !busy, label = { Text(text) })
                        }
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
