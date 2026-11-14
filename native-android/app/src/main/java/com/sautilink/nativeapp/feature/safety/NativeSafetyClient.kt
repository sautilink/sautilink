package com.sautilink.nativeapp.feature.safety

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class MemberSafetyState(val blocked: Boolean, val muted: Boolean)

class NativeSafetyClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val jsonType = "application/json".toMediaType()
    private val handlePattern = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
    private val uuidPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val reasons = setOf("spam", "harassment", "hate", "impersonation", "privacy", "other")

    private suspend fun api(path: String, method: String = "GET", payload: JSONObject? = null): JSONObject {
        val jwt = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(auth.mediaOrigin + path)
                .header("Authorization", "Bearer $jwt").header("Accept", "application/json")
                .header("Cache-Control", "no-store")
            if (method == "POST") builder.post((payload ?: JSONObject()).toString().toRequestBody(jsonType))
            if (method == "DELETE") builder.delete()
            try {
                http.newCall(builder.build()).execute().use { response ->
                    val text = response.body?.string()?.take(20_000).orEmpty()
                    val json = runCatching { JSONObject(text) }.getOrNull()
                    if (!response.isSuccessful || json?.optBoolean("ok") != true) {
                        val message = json?.optJSONObject("error")?.optString("message").orEmpty()
                        throw AuthRequestException(message.ifBlank { when (response.code) {
                            401, 403 -> "Sign in again to use safety controls."
                            429 -> "Safety controls are busy. Try again shortly."
                            else -> "Safety request failed (HTTP ${response.code})."
                        } }, response.code)
                    }
                    json.optJSONObject("data") ?: JSONObject()
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to safety controls.") }
        }
    }

    private fun handle(value: String): String = value.trim().lowercase().takeIf(handlePattern::matches)
        ?: throw IllegalArgumentException("Invalid member handle.")

    suspend fun memberState(username: String): MemberSafetyState {
        val name = handle(username)
        val block = api("/api/safety/block/$name").optBoolean("blocked_by_you")
        val mute = api("/api/safety/mute/$name").optBoolean("muted_by_you")
        return MemberSafetyState(block, mute)
    }

    suspend fun setBlocked(username: String, value: Boolean) {
        val name = handle(username)
        api("/api/safety/block/$name", if (value) "POST" else "DELETE")
    }

    suspend fun setMuted(username: String, value: Boolean) {
        val name = handle(username)
        api("/api/safety/mute/$name", if (value) "POST" else "DELETE")
    }

    suspend fun report(targetType: String, targetId: String, reason: String, details: String) {
        require(targetType in setOf("profile", "post", "comment", "message")) { "Unsupported report target." }
        require(if (targetType == "message") targetId.matches(Regex("^[0-9]{1,19}$"))
                else uuidPattern.matches(targetId)) { "Invalid report target." }
        require(reason in reasons) { "Choose a report reason." }
        require(details.length <= 2000) { "Report details must be 2,000 characters or fewer." }
        api("/api/safety/report", "POST", JSONObject().put("target_type", targetType)
            .put("target_id", targetId).put("reason", reason).put("details", details.trim()))
    }
}
