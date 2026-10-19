package com.sautilink.nativeapp.feature.safety

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Uses the same authenticated member appeal contract as the Web client. */
class NativeAppealsClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()

    private suspend fun request(payload: JSONObject? = null): JSONObject {
        val accountId = auth.account?.id ?: throw AuthRequestException("Sign in to view your appeals.")
        val token = auth.accessTokenForStagingRead()
        if (auth.account?.id != accountId) throw AuthRequestException("Your account changed. Open appeals again.")
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(auth.mediaOrigin + "/api/appeals")
                .header("Authorization", "Bearer $token").header("Accept", "application/json")
                .header("Cache-Control", "no-store")
            if (payload == null) builder.get()
            else builder.post(payload.toString().toRequestBody("application/json".toMediaType()))
            try {
                http.newCall(builder.build()).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (text.length > 500_000) throw AuthRequestException("The appeals response was too large. Try again.")
                    val json = runCatching { JSONObject(text) }.getOrNull()
                    if (!response.isSuccessful || json?.optBoolean("ok") != true) {
                        val message = json?.optJSONObject("error")?.optString("message").orEmpty()
                        throw AuthRequestException(message.ifBlank { when (response.code) {
                            401, 403 -> "Sign in again to manage your appeals."
                            429 -> "Appeals are busy. Try again shortly."
                            else -> "Could not load or submit this appeal (HTTP ${response.code})."
                        } }, response.code)
                    }
                    json.optJSONObject("data") ?: JSONObject()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: AuthRequestException) { throw error }
            catch (_: Exception) { throw AuthRequestException("Could not connect to appeals. Please try again.") }
        }
    }

    suspend fun load(): List<NativeAppealableDecision> {
        val data = request()
        val appeals = data.optJSONArray("appeals").objects().mapNotNull { row ->
            val actionId = row.optString("action_id")
            if (!NativeAppealRules.validActionId(actionId)) return@mapNotNull null
            NativeMemberAppeal(row.optString("id"), actionId, row.text("reason"),
                row.text("appeal_status"), row.text("decision_reason"), row.text("created_at"))
        }.associateBy { it.actionId }
        return data.optJSONArray("actions").objects().mapNotNull { row ->
            val id = row.optString("id")
            if (!NativeAppealRules.validActionId(id)) return@mapNotNull null
            NativeAppealableDecision(id, row.text("action_type"), row.text("target_type"),
                row.text("reason"), row.text("policy_version").ifBlank { "safety-v1" },
                row.text("created_at"), appeals[id])
        }
    }

    suspend fun submit(actionId: String, reason: String) {
        require(NativeAppealRules.validActionId(actionId)) { "Choose a valid moderation decision." }
        NativeAppealRules.reasonError(reason)?.let { throw IllegalArgumentException(it) }
        request(JSONObject().put("action_id", actionId).put("reason", reason.trim()))
    }
}

private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList()
    else (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.text(key: String): String = optString(key).takeUnless { isNull(key) || it == "null" }.orEmpty()
