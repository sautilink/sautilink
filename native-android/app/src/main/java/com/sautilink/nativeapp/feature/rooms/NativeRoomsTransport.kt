package com.sautilink.nativeapp.feature.rooms

import android.util.Log
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.network.SautiNetworkPhase
import com.sautilink.nativeapp.network.SautiNetworkSite
import com.sautilink.nativeapp.network.sautiNetworkFailureDiagnostic
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** No Room cache survives an account change. RLS and the existing API remain authoritative. */
internal class NativeRoomsTransport(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun viewer(writing: Boolean = false): String {
        if (writing && auth.backend != SautiBackend.PRODUCTION)
            throw AuthRequestException("Test Rooms remain read only.")
        return auth.account?.id?.takeIf(NativeRoomRules.uuid::matches)
            ?: throw AuthRequestException("Sign in to use Rooms.")
    }

    fun checkViewer(expected: String) {
        if (viewer() != expected) throw AuthRequestException("Your account changed. Open Rooms again.")
    }

    fun guard(room: NativeRoom, writing: Boolean = false): String {
        val own = viewer(writing)
        if (!NativeRoomRules.uuid.matches(room.id) || !NativeRoomRules.uuid.matches(room.ownerId) ||
            !NativeRoomRules.slug.matches(room.slug) || room.viewerId != own)
            throw AuthRequestException("This Room changed. Refresh and try again.")
        return own
    }

    suspend fun rest(own: String, path: String, method: String = "GET", payload: JSONObject? = null): JSONArray {
        val result = request(own, auth.restOrigin + path, method,
            payload?.toString()?.toRequestBody(jsonType), isRest = true)
        return try { if (result.isBlank()) JSONArray() else JSONArray(result) }
        catch (_: Exception) { throw AuthRequestException("Room response could not be read. Refresh and try again.") }
    }

    suspend fun api(own: String, path: String, method: String = "GET", payload: JSONObject? = null,
        content: RequestBody? = null): JSONObject {
        val text = request(own, auth.backend.siteOrigin + path, method,
            content ?: payload?.toString()?.toRequestBody(jsonType), isRest = false)
        val json = try { JSONObject(text) }
        catch (_: Exception) { throw AuthRequestException("Room response could not be read. Refresh and try again.") }
        if (!json.optBoolean("ok")) throw AuthRequestException("Room action could not be confirmed.")
        return json.optJSONObject("data") ?: throw AuthRequestException("Room action could not be confirmed.")
    }

    private suspend fun request(own: String, url: String, method: String, content: RequestBody?, isRest: Boolean): String {
        checkViewer(own)
        if (method != "GET") viewer(writing = true)
        val token = auth.accessTokenForStagingRead()
        checkViewer(own)
        return withContext(Dispatchers.IO) {
            checkViewer(own)
            val builder = Request.Builder().url(url).header("Authorization", "Bearer $token")
                .header("Accept", "application/json").header("Cache-Control", "no-store")
            if (isRest) builder.header("apikey", auth.publicKeyForRead()).header("Prefer", "return=representation")
            when (method) {
                "POST" -> builder.post(content ?: "{}".toRequestBody(jsonType))
                "PATCH" -> builder.patch(content ?: "{}".toRequestBody(jsonType))
                "PUT" -> builder.put(content ?: "{}".toRequestBody(jsonType))
                "DELETE" -> if (content == null) builder.delete() else builder.delete(content)
                "GET" -> builder.get()
                else -> throw AuthRequestException("Unsupported Room request method.")
            }
            val started = System.nanoTime()
            var phase = SautiNetworkPhase.EXECUTE
            var seenStatus: Int? = null
            fun recordFailure(error: Exception) {
                runCatching { Log.w("SautiRoomsNet", sautiNetworkFailureDiagnostic(error, method,
                    if (isRest) SautiNetworkSite.REST else SautiNetworkSite.SITE,
                    (System.nanoTime() - started) / 1_000_000, seenStatus, phase)) }
            }
            try {
                http.newCall(builder.build()).execute().use { response ->
                    seenStatus = response.code
                    phase = SautiNetworkPhase.RESPONSE_BODY
                    // Bound network parsing before constructing JSON, rather than truncating an unbounded string.
                    val text = response.body?.source()?.let { source ->
                        source.request(512_001)
                        if (source.buffer.size > 512_000) throw AuthRequestException("Room response is too large. Try a smaller page.")
                        source.buffer.readUtf8()
                    }.orEmpty()
                    checkViewer(own)
                    if (!response.isSuccessful) {
                        phase = SautiNetworkPhase.HTTP_STATUS
                        val remote = if (isRest) null else runCatching {
                            JSONObject(text).optJSONObject("error")?.optString("message")
                        }.getOrNull()?.takeIf { it.length in 1..220 }
                        throw AuthRequestException(remote ?: when (response.code) {
                            401, 403 -> "Room access denied. Check your membership or sign in again."
                            404 -> "This Room or action is unavailable."
                            409 -> "Room details changed or this action is already in use. Refresh and try again."
                            429 -> "Too many Room requests. Try again shortly."
                            in 500..599 -> "Room service is temporarily unavailable."
                            else -> "Room request failed (HTTP ${response.code})."
                        }, response.code)
                    }
                    text
                }
            } catch (e: CancellationException) { throw e }
            catch (e: AuthRequestException) { if (e.httpStatus != null) recordFailure(e); throw e }
            catch (e: Exception) {
                recordFailure(e)
                throw AuthRequestException("Could not connect to Rooms. Check your connection.")
            }
        }
    }
}

internal fun JSONArray.roomObjects(): List<JSONObject> = (0 until length()).mapNotNull(::optJSONObject)
internal fun JSONObject.roomString(key: String): String = optString(key).takeUnless { it == "null" }.orEmpty()
