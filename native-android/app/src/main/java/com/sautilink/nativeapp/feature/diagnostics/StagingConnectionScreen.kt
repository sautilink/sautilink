package com.sautilink.nativeapp.feature.diagnostics

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBackIosNew
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudQueue
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private const val STAGING_HEALTH_URL = "https://test.sautilink.com/api/health"

private data class ApiCheck(val httpCode: Int, val isHealthy: Boolean, val environment: String?, val message: String)

/** No authentication headers, accounts, uploads or write requests. Runs only when user taps Test. */
private suspend fun checkStagingHealth(): ApiCheck = withContext(Dispatchers.IO) {
    try {
        withTimeout(15000L) {
            val connection = URL(STAGING_HEALTH_URL).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "GET"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10000
                connection.readTimeout = 10000
                connection.setRequestProperty("Accept", "application/json")
                connection.useCaches = false
                val status = connection.responseCode
                if (status !in 200..299) {
                    return@withTimeout ApiCheck(status, false, null, "Unexpected HTTP status. Check staging availability.")
                }
                val body = connection.inputStream.bufferedReader().use { it.readText().take(4096) }
                val json = runCatching { JSONObject(body) }.getOrNull()
                val ok = json?.optBoolean("ok", false) ?: false
                val env = json?.optJSONObject("data")?.optString("environment")?.takeIf { it.isNotBlank() }
                if (ok && env == "staging") {
                    ApiCheck(status, true, env, "Staging API responded successfully.")
                } else {
                    ApiCheck(status, false, env, "Server responded, but staging health was not confirmed.")
                }
            } finally {
                connection.disconnect()
            }
        }
    } catch (_: Exception) {
        ApiCheck(0, false, null, "Could not reach staging. Check internet, DNS, or server status.")
    }
}

@Composable
fun StagingConnectionScreen(onBack: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var lastResult by remember { mutableStateOf<ApiCheck?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp, bottom = 18.dp)) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBackIosNew, contentDescription = "Back")
            }
            Spacer(Modifier.width(8.dp))
            Text("API connection", style = MaterialTheme.typography.headlineMedium)
        }

        Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
            Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.CloudQueue, contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
                Text("Staging environment", style = MaterialTheme.typography.titleLarge)
                Text("A safe, read-only check before connecting real SautiLink accounts and posts.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(STAGING_HEALTH_URL, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary)
                Button(
                    modifier = Modifier.fillMaxWidth().height(52.dp), enabled = !busy,
                    shape = SautiShape.Pill,
                    onClick = {
                        busy = true
                        lastResult = null
                        scope.launch {
                            lastResult = checkStagingHealth()
                            busy = false
                        }
                    }
                ) {
                    if (busy) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        Spacer(Modifier.width(10.dp))
                        Text("Checking...")
                    } else Text("Test connection")
                }
            }
        }

        lastResult?.let { result ->
            Spacer(Modifier.height(16.dp))
            Surface(color = MaterialTheme.colorScheme.surfaceContainer,
                shape = RoundedCornerShape(22.dp)) {
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.Top) {
                    Icon(
                        if (result.isHealthy) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline,
                        contentDescription = null,
                        tint = if (result.isHealthy) Color(0xFF23A46C) else MaterialTheme.colorScheme.error
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(if (result.isHealthy) "Staging connected" else "Check not confirmed",
                            style = MaterialTheme.typography.titleMedium)
                        Text(result.message, style = MaterialTheme.typography.bodyMedium)
                        Text("HTTP: ${result.httpCode.takeIf { it != 0 } ?: "network error"}"
                            + (result.environment?.let { "  ·  Environment: $it" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Shield, contentDescription = null,
                tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Text("No passwords, API secrets or personal content are sent.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
