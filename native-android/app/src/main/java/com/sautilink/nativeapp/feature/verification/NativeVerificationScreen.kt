package com.sautilink.nativeapp.feature.verification

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.vector.ImageVector
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
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
    suspend fun rpc(name: String, payload: JSONObject, expectedOwner: String? = auth.account?.id): JSONObject? {
        if (expectedOwner == null || auth.account?.id != expectedOwner) throw CancellationException("Verification account changed")
        val token = auth.accessTokenForStagingRead()
        if (auth.account?.id != expectedOwner) throw CancellationException("Verification account changed")
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
                        code.contains("VERIFICATION_ARTICLE_REQUIRED") || code.contains("VERIFICATION_ARTICLES_REQUIRED") ->
                            "Add at least one independent news or blog article about this entity."
                        code.contains("EVIDENCE") -> "Add at least one public social link or article."
                        code.contains("INVALID") -> "Please check your application details."
                        else -> "Unable to complete this request. Please review your information."
                    })
                }
                if (auth.account?.id != expectedOwner) throw CancellationException("Verification account changed")
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
    val accountId = auth.account?.id
    var applicantType by remember(accountId) { mutableStateOf(VerificationApplicantType.INDIVIDUAL) }
    var typeMenu by remember(accountId) { mutableStateOf(false) }
    var verified by remember(accountId) { mutableStateOf<Boolean?>(null) }
    var case by remember(accountId) { mutableStateOf<JSONObject?>(null) }
    var busy by remember(accountId) { mutableStateOf(false) }
    var message by remember(accountId) { mutableStateOf<String?>(null) }
    var legalName by remember(accountId) { mutableStateOf("") }
    var publicName by remember(accountId) { mutableStateOf("") }
    var category by remember(accountId) { mutableStateOf("") }
    var country by remember(accountId) { mutableStateOf("") }
    var facebook by remember(accountId) { mutableStateOf("") }
    var instagram by remember(accountId) { mutableStateOf("") }
    var tiktok by remember(accountId) { mutableStateOf("") }
    var youtube by remember(accountId) { mutableStateOf("") }
    var article by remember(accountId) { mutableStateOf("") }
    var reason by remember(accountId) { mutableStateOf("") }
    var accepted by remember(accountId) { mutableStateOf(false) }
    var revision by remember(accountId) { mutableIntStateOf(0) }

    LaunchedEffect(accountId, revision) {
        if (auth.account == null) { verified = false; return@LaunchedEffect }
        busy = true
        try {
            verified = profileClient.own()?.verified == true
            case = if (verified == true) null else client.rpc("get_my_verification_case", JSONObject(), accountId)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { message = e.message ?: "Could not check verification status." }
        finally { busy = false }
    }
    val active = case?.optString("status") in listOf("submitted", "reviewing")
    val previousVerificationRemoved = verified == false && case?.opt("verification_removed") == true
    val cooldown = case?.optString("status") == "rejected" && case?.optBoolean("can_reapply") != true
    val canApply = auth.account != null && verified == false && !active && !cooldown && !busy
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Verification", style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Icon(Icons.Rounded.VerifiedUser, null, tint = MaterialTheme.colorScheme.primary)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .4f))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Surface(shape = RoundedCornerShape(17.dp),
                        color = MaterialTheme.colorScheme.primaryContainer) {
                        Icon(Icons.Rounded.VerifiedUser, null, Modifier.padding(13.dp).size(29.dp),
                            tint = MaterialTheme.colorScheme.primary, selected = verified == true)
                    }
                    Text("Let your identity stand out", style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold)
                    when {
                        verified == true -> Text("Your account is already verified. New requests are disabled.")
                        active -> Text("Your existing verification application is ${case?.optString("status")?.replace('_', ' ')}. " +
                            "You cannot submit a duplicate request.")
                        cooldown -> Text("Reapplication is available after ${case?.optInt("cooldown_days_remaining")} days.")
                        else -> Text("Submit your public identity and evidence for review. Approval is not guaranteed.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            if (case != null) {
                Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.padding(14.dp)) {
                        VerificationSectionTitle(if (previousVerificationRemoved) "Previous application" else "Application status",
                            Icons.Rounded.AssignmentTurnedIn)
                        Spacer(Modifier.height(8.dp))
                        Text("Application: ${case?.optString("case_number")}", style = MaterialTheme.typography.titleSmall)
                        Text("Status: ${case?.optString("status")}")
                        if (previousVerificationRemoved) Text(
                            "This is a historical application. Your checkmark was removed. To get verified again, complete a new application and review; previous approval does not guarantee approval again.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        case?.optString("staff_message")?.takeIf { it.isNotBlank() && it != "null" }
                            ?.let { Text(it) }
                    }
                }
            }
            if (message != null) Text(message.orEmpty(), color = MaterialTheme.colorScheme.error)
            VerificationSectionTitle("Applicant type", Icons.Rounded.Category)
            Box(Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = { typeMenu = true }, enabled = canApply,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(16.dp)) {
                    Icon(if (applicantType.requiresArticle) Icons.Rounded.Business else Icons.Rounded.PersonOutline,
                        null, Modifier.size(21.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(applicantType.label, Modifier.weight(1f))
                    Icon(Icons.Rounded.ExpandMore, null)
                }
                DropdownMenu(expanded = typeMenu, onDismissRequest = { typeMenu = false }) {
                    VerificationApplicantType.entries.forEach { type ->
                        DropdownMenuItem(text = { Text(type.label) }, onClick = { applicantType = type; typeMenu = false },
                            leadingIcon = { Icon(if (type.requiresArticle) Icons.Rounded.Business else Icons.Rounded.PersonOutline, null) },
                            trailingIcon = { if (applicantType == type) Icon(Icons.Rounded.Check, null) })
                    }
                }
            }
            Text(if (applicantType.requiresArticle)
                "For brands, businesses, organisations and other entities. Provide public details and independent articles so we can understand and review the applicant."
                else "For individuals, public figures and politicians. Provide public identity and evidence for review.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            VerificationSectionTitle("Identity details", Icons.Rounded.PersonOutline)
            OutlinedTextField(legalName, { legalName = it.take(120) }, Modifier.fillMaxWidth(),
                label = { Text(if (applicantType.requiresArticle) "Legal business / entity name *" else "Full legal name *") },
                leadingIcon = { Icon(Icons.Rounded.PersonOutline, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply, singleLine = true)
            OutlinedTextField(publicName, { publicName = it.take(120) }, Modifier.fillMaxWidth(),
                label = { Text(if (applicantType.requiresArticle) "Public / trading name (optional)" else "Public name (optional)") },
                leadingIcon = { Icon(Icons.Rounded.Badge, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            OutlinedTextField(category, { category = it.take(100) }, Modifier.fillMaxWidth(),
                label = { Text(if (applicantType.requiresArticle) "Business sector / entity category *" else "Profession / account category *") },
                leadingIcon = { Icon(Icons.Rounded.Category, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            OutlinedTextField(country, { country = it.take(100) }, Modifier.fillMaxWidth(),
                label = { Text("Country *") },
                leadingIcon = { Icon(Icons.Rounded.Public, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            VerificationSectionTitle("Public evidence links", Icons.Rounded.Link)
            OutlinedTextField(facebook, { facebook = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("Facebook URL") },
                leadingIcon = { Icon(Icons.Rounded.Link, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            OutlinedTextField(instagram, { instagram = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("Instagram URL") },
                leadingIcon = { Icon(Icons.Rounded.PhotoCamera, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            OutlinedTextField(tiktok, { tiktok = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("TikTok URL") },
                leadingIcon = { Icon(Icons.Rounded.MusicNote, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            OutlinedTextField(youtube, { youtube = it.take(500) }, Modifier.fillMaxWidth(),
                label = { Text("YouTube URL") },
                leadingIcon = { Icon(Icons.Rounded.PlayCircleOutline, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp), enabled = canApply)
            OutlinedTextField(article, { article = it.take(5500) }, Modifier.fillMaxWidth(),
                label = { Text(if (applicantType.requiresArticle) "Independent article URLs * (1â€“5, one per line)" else "Independent article URLs (optional, up to 5)") },
                leadingIcon = { Icon(Icons.Rounded.Article, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp),
                minLines = 3, enabled = canApply)
            OutlinedTextField(reason, { reason = it.take(2000) }, Modifier.fillMaxWidth(),
                label = { Text("Why should your account be verified? *") },
                leadingIcon = { Icon(Icons.Rounded.Description, null, Modifier.size(21.dp)) },
                shape = RoundedCornerShape(16.dp),
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
                    val articleUrls = article.lines().map { it.trim() }.filter { it.isNotEmpty() }
                    val socialUrls = listOf(facebook, instagram, tiktok, youtube).map { it.trim() }.filter { it.isNotEmpty() }
                    val evidenceError = verificationEvidenceError(applicantType, socialUrls, articleUrls)
                    if (evidenceError != null) { message = evidenceError; return@Button }
                    articleUrls.forEach { articles.put(it) }
                    if (legalName.trim().length < 2 || category.trim().length < 2 ||
                        country.trim().length < 2 || reason.trim().length < 20 ||
                        !accepted || (social.length() == 0 && articles.length() == 0)) {
                        message = "Complete the required details, consent and at least one evidence link."
                        return@Button
                    }
                    val requestedOwner = accountId ?: return@Button
                    busy = true; message = null
                    scope.launch {
                        try {
                            if (auth.account?.id != requestedOwner) throw CancellationException("Verification account changed")
                            val latestVerified = profileClient.own()?.verified == true
                            if (auth.account?.id != requestedOwner) throw CancellationException("Verification account changed")
                            if (latestVerified) {
                                verified = true; message = "Your account is already verified."
                            } else {
                                val data = JSONObject()
                                    .put("p_account_type", applicantType.wire)
                                    .put("p_legal_name", legalName.trim())
                                    .put("p_public_name", publicName.trim())
                                    .put("p_account_category", category.trim())
                                    .put("p_country", country.trim())
                                    .put("p_social_links", social)
                                    .put("p_article_links", articles)
                                    .put("p_reason", reason.trim())
                                    .put("p_terms_accepted", true)
                                    .put("p_social_proof_confirmed", false)
                                client.rpc("submit_verification_case", data, requestedOwner)
                                message = "Verification application received for review."
                                revision++
                            }
                        } catch (cancelled: CancellationException) { throw cancelled
                        } catch (e: Exception) {
                            if (auth.account?.id == requestedOwner) message = e.message ?: "Could not submit the request."
                        } finally { if (auth.account?.id == requestedOwner) busy = false }
                    }
                },
                enabled = canApply,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                shape = RoundedCornerShape(15.dp)
            ) {
                Icon(Icons.Rounded.VerifiedUser, null, Modifier.size(21.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (busy) "Checkingâ€¦" else "Submit verification request")
            }
            if (verified == true) {
                Text("Already verified â€” request unavailable",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun VerificationSectionTitle(title: String, icon: ImageVector) {
    Row(Modifier.padding(top = 7.dp, bottom = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, null, Modifier.size(21.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}
