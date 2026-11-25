package com.sautilink.nativeapp.feature.explore

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable
fun NativeUserSuggestions(auth: StagingAuthClient, query: String, onChoose: (String) -> Unit) {
    val client = remember(auth) { NativeUserSearch(auth) }
    var rows by remember(auth.account?.id) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(query, auth.account?.id) {
        rows = emptyList(); error = null
        if (normalizeUserSearch(query).length < 2) return@LaunchedEffect
        loading = true
        try { delay(250); rows = client.search(query, 8) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
        finally { loading = false }
    }
    Column {
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 240.dp)) {
            items(rows, key = { it.getString("id") }) { row ->
                val handle = row.optString("username")
                ListItem(headlineContent = { Text(row.optString("display_name").ifBlank { handle }) },
                    supportingContent = { Text("@$handle") },
                    modifier = Modifier.clickable { onChoose(handle) })
            }
        }
    }
}
