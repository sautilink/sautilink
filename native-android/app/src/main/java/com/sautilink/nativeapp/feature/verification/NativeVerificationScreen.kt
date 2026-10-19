package com.sautilink.nativeapp.feature.verification

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.profile.NativeProfilesClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.TimeUnit

private class VerificationApi(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build()
    suspend fun rpc(name: String, payload: JSONObject): JSONObject? {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(auth.restOrigin + "rpc/$name")
                .header("Authorization", "Bearer $token")
                .header("apikey", auth.publicKeyForRead())
                .header("Accept", "application/json")
                .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            http.newCall(request).execute().use { response ->
                val body = response.body?.string()?.take(48_000).orEmpty()
                if (!response.isSuccessful) {
                    val code = runCatching { JSONObject(body).optString("message") }.getOrNull().orEmpty()
                    throw IllegalStateException(when {
                        code.contains("ALREADY_VERIFIED") -> "Your account is already verified."
                        code.contains("COOLDOWN") -> "Your reapplication waiting period has not ended."
                        code.contains("EVIDENCE") -> "Add at least one public social link or article."
                        code.contains("INVALID") -> "Please check your application details."
                        else -> "Unable to complete this request. Please review your information."
                    })
                }
                if (body.isBlank() || body == "null") null else JSONObject(body)
            }
        }
    }
}

/** Same verification lifecycle RPCs as the web, with an enforced verified-account lock. */
@Composable
fun NativeVerificationScreen(auth: StagingAuthClient, onBack: () -> Unit) {
    val client = remember(auth) { VerificationApi(auth) }
    val profileClient = remember(auth) { NativeProfilesClient(auth) }
    val scope = rememberCoroutineScope()
    var verified by remember(auth.account?.id) { mutableStateOf<Boolean?>(null) }
    var case by remember(auth.account?.id) { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var legalName by remember { mutableStateOf("") }
    var publicName by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("") }
    var facebook by remember { mutableStateOf("") }
    var instagram by remember { mutableStateOf("") }
    var tiktok by remember { mutableStateOf("") }
    var youtube by remember { mutableStateOf("") }
    var article by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var accepted by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }

    LaunchedEffect(auth.account?.id, revision) {
        if (auth.account == null) { verified = false; return@LaunchedEffect }
        busy = true
        try {
            verified = profileClient.own()?.verified == true
            case = if (verified == true) null else client.rpc("get_my_verification_case", JSONObject())
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { message = e.message ?: "Could not check verification status." }
        finally { busy = false }
    }
    val active = case?.optString("status") in listOf("submitted", "reviewing")
    val cooldown = case?.optString("status") == "rejected" && case?.optBoolean("can_reapply") != true
    val canApply = auth.account != null && verified == false && !active && !cooldown && !busy
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Verification", style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.weight(1f))
            Icon(Icons.Rounded.VerifiedUser, null, tint = MaterialTheme.colorScheme.primary)
        }
        HorizontalDivider()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Text("Request an account verification badge", style = MaterialTheme.typography.titleLarge)
            when {
                verified == true -> Text("Your account is already verified. New requests are disabled.")
                active -> Text("Your existing verification application is ${case?.optString("status")?.replace('_', ' ')}. " +
                    "You cannot submit a duplicate request.")
                cooldown -> Text("Reapplication is available after ${case?.optInt("cooldown_days_remaining")} days.")
                else -> Text("Submit your public identity and evidence for review. Approval is not guaranteed.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (case != null) {
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                    Column(Modifier.padding(14.dp)) {
                        Text("Application: ${case?.optString("case_number")}", style = MaterialTheme.typography.titleMedium)
                        Text("Status: ${case?.optString("status")}")
                        case?.optString("staff_message")?.takeIf { it.isNotBlank() && it != "null" }
                            ?.let { Text(it) }
                    }
                }
            }
            if (message != null) Text(message.orEmpty(), color = MaterialTheme.colorScheme.error)
            OutlinedTextField(legalName, { legalName = it.take(120) }, Modifier.fillMaxWidth(),
                label = { Text("Full legal name *") }, enabled = canApply, singleLine = true)
            OutlinedTextField(publicName, { publicName = it.take(120) }, Modifier.fillMaxWidth(),
                label = { Text("Public name / organisation (optional)") }, enabled = canApply)
            OutlinedTextField(category, { category = it.take(100) }, Modifier.fillMaxWidth(),
                label = { Text("Account category *") }, enabled = canApply)
            OutlinedTextField(country, { country = it.take(100) }, Modifier.fillMaxWidth(),
                label = { Text("Country *") }, enabled = canApply)
            Text("Public evidence links", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(facebook, { facebook = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("Facebook URL") }, enabled = canApply)
            OutlinedTextField(instagram, { instagram = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("Instagram URL") }, enabled = canApply)
            OutlinedTextField(tiktok, { tiktok = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("TikTok URL") }, enabled = canApply)
            OutlinedTextField(youtube, { youtube = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("YouTube URL") }, enabled = canApply)
            OutlinedTextField(article, { article = it.take(5500) }, Modifier.fillMaxWidth(),
                label = { Text("Independent article URLs, up to 5 (one per line)") },
                minLines = 3, enabled = canApply)
            OutlinedTextField(reason, { reason = it.take(2000) }, Modifier.fillMaxWidth(),
                label = { Text("Why should your account be verified? *") },
                minLines = 3, enabled = canApply)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = accepted, onCheckedChange = { accepted = it }, enabled = canApply)
                Text("I agree to the verification review conditions and confirm my evidence is truthful.",
                    style = MaterialTheme.typography.bodySmall)
            }
            Button(
                onClick = {
                    val social = JSONObject()
                    listOf("facebook" to facebook, "instagram" to instagram, "tiktok" to tiktok,
                        "youtube" to youtube).forEach { (key, url) ->
                        if (url.trim().isNotBlank()) social.put(key, url.trim())
                    }
                    val articles = JSONArray()
                    article.lines().map { it.trim() }.filter { it.isNotEmpty() }
                        .take(5).forEach { articles.put(it) }
                    if (legalName.trim().length < 2 || category.trim().length < 2 ||
                        country.trim().length < 2 || reason.trim().length < 20 ||
                        !accepted || (social.length() == 0 && articles.length() == 0)) {
                        message = "Complete the required details, consent and at least one evidence link."
                        return@Button
                    }
                    busy = true; message = null
                    scope.launch {
                        try {
                            val latestVerified = profileClient.own()?.verified == true
                            if (latestVerified) {
                                verified = true; message = "Your account is already verified."
                            } else {
                                val data = JSONObject()
                                    .put("p_legal_name", legalName.trim())
                                    .put("p_public_name", publicName.trim())
                                    .put("p_account_category", category.trim())
                                    .put("p_country", country.trim())
                                    .put("p_social_links", social)
                                    .put("p_article_links", articles)
                                    .put("p_reason", reason.trim())
                                    .put("p_terms_accepted", true)
                                    .put("p_social_proof_confirmed", false)
                                client.rpc("submit_verification_case", data)
                                message = "Verification application received for review."
                                revision++
                            }
                        } catch (e: Exception) {
                            message = e.message ?: "Could not submit the request."
                        } finally { busy = false }
                    }
                },
                enabled = canApply,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                shape = RoundedCornerShape(15.dp)
            ) { Text(if (busy) "Checking…" else "Submit verification request") }
            if (verified == true) {
                Text("Already verified — request unavailable",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
