package com.sautilink.nativeapp.feature.explore

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
import java.text.Normalizer
import java.util.concurrent.TimeUnit

class NativeUserSearch(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()

    suspend fun search(query: String, limit: Int = 20): List<JSONObject> {
        if (normalizeUserSearch(query).length < 2) return emptyList()
        val owner = auth.account?.id ?: throw AuthRequestException("Sign in to search accounts.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val payload = JSONObject().put("query_text", query.take(80)).put("max_results", limit.coerceIn(1, 50))
            val request = Request.Builder().url(auth.restOrigin + "rpc/social_user_suggestions")
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $token")
                .header("Cache-Control", "no-store")
                .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw AuthRequestException("Account search is unavailable. Please try again.", response.code)
                val rows = JSONArray(response.body?.string().orEmpty())
                if (auth.account?.id != owner) throw CancellationException("Search account changed")
                (0 until rows.length()).mapNotNull(rows::optJSONObject)
            }
        }
    }
}

internal fun normalizeUserSearch(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKD)
    .lowercase(java.util.Locale.ROOT).filter { it.isLetterOrDigit() }

/** For lists already scoped to members, conversations, or followers. */
internal fun userNameMatches(query: String, vararg names: String): Boolean {
    val needle = normalizeUserSearch(query)
    if (needle.isEmpty()) return true
    return names.any { name ->
        val normalized = normalizeUserSearch(name)
        normalized.contains(needle) || (needle.length >= 3 && normalized.length >= 3 &&
            nameEditDistance(needle, normalized.take(needle.length + 2)) <= if (needle.length < 6) 1 else 2)
    }
}

private fun nameEditDistance(left: String, right: String): Int {
    var previous = IntArray(right.length + 1) { it }
    var beforePrevious = previous
    for (i in left.indices) {
        val current = IntArray(right.length + 1)
        current[0] = i + 1
        for (j in right.indices) {
            current[j + 1] = minOf(current[j] + 1, previous[j + 1] + 1,
                previous[j] + if (left[i] == right[j]) 0 else 1)
            if (i > 0 && j > 0 && left[i] == right[j - 1] && left[i - 1] == right[j])
                current[j + 1] = minOf(current[j + 1], beforePrevious[j - 1] + 1)
        }
        beforePrevious = previous
        previous = current
    }
    return previous.last()
}
