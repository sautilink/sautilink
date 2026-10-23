package com.sautilink.nativeapp.feature.posts

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class NativeOwnPost(val id: String, val body: String, val createdAt: String,
    val editCount: Int, val mediaCount: Int, val visibility: String)

/** Production text-post lifecycle. The website API enforces Auth, limits and ownership. */
class NativePostsClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")

    private suspend fun accountId(): String {
        if (auth.backend != SautiBackend.PRODUCTION) throw AuthRequestException("Publishing is available on production only.")
        return auth.account?.id?.takeIf(uuid::matches) ?: throw AuthRequestException("Sign in to manage posts.")
    }

    private suspend fun request(url: String, method: String, body: JSONObject? = null, rest: Boolean = false): String {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(url)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
            if (rest) builder.header("apikey", auth.publicKeyForRead())
            val data = body?.toString()?.toRequestBody("application/json".toMediaType())
            when (method) {
                "POST" -> builder.post(data ?: "{}".toRequestBody("application/json".toMediaType()))
                "PATCH" -> builder.patch(data ?: "{}".toRequestBody("application/json".toMediaType()))
                "DELETE" -> builder.delete()
                else -> builder.get()
            }
            try {
                http.newCall(builder.build()).execute().use { response ->
                    val text = response.body?.string()?.take(100_000).orEmpty()
                    if (!response.isSuccessful) {
                        val remote = runCatching { JSONObject(text).optJSONObject("error")?.optString("message") }.getOrNull()
                        throw AuthRequestException(remote?.takeIf { it.length in 1..220 } ?: when (response.code) {
                            401, 403 -> "Sign in again before changing posts."
                            404 -> "This post is unavailable."
                            429 -> "Too many requests. Try again shortly."
                            in 500..599 -> "Post service is temporarily unavailable."
                            else -> "Post request failed (HTTP ${response.code})."
                        }, response.code)
                    }
                    text
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to the post service.") }
        }
    }

    private fun validBody(body: String, mediaCount: Int = 0): String {
        val normalized = body.trim()
        if (normalized.isEmpty() && mediaCount == 0) throw AuthRequestException("Write something or add media before publishing.")
        if (normalized.length > 2000) throw AuthRequestException("Post text must be 2,000 characters or fewer.")
        return normalized
    }

    suspend fun create(body: String, visibility: String = "public", replyAccess: String = "everyone",
        media: List<NativeReadyMedia> = emptyList()): String {
        accountId()
        if (visibility !in setOf("public", "followers") || replyAccess !in setOf("everyone", "following"))
            throw AuthRequestException("Invalid audience or comment setting.")
        if (media.size > NativePostMediaPolicy.MAX_ATTACHMENTS || media.any { !uuid.matches(it.id) || it.altText.length > 1000 })
            throw AuthRequestException("One or more media items are invalid.")
        val mediaPayload = JSONArray().apply { media.forEach { put(JSONObject()
            .put("id", it.id).put("alt_text", it.altText.trim())) } }
        val data = JSONObject().put("body", validBody(body, media.size)).put("visibility", visibility)
            .put("reply_access", replyAccess).put("media", mediaPayload)
        val payload = JSONObject(request("${auth.backend.siteOrigin}/api/sauti", "POST", data))
        val id = payload.optJSONObject("data")?.optJSONObject("post")?.optString("id").orEmpty()
        if (!payload.optBoolean("ok") || !uuid.matches(id)) throw AuthRequestException("Publishing could not be confirmed.")
        return id
    }

    suspend fun ownPosts(): List<NativeOwnPost> {
        val id = accountId()
        val result = JSONArray(request("${auth.restOrigin}social_posts?author_id=eq.$id&parent_post_id=is.null&select=id,body,created_at,edit_count,media_count,visibility&order=created_at.desc&limit=100", "GET", rest = true))
        return (0 until result.length()).mapNotNull { result.optJSONObject(it) }.map { row ->
            NativeOwnPost(row.optString("id"), row.optString("body"), row.optString("created_at"),
                row.optInt("edit_count"), row.optInt("media_count"), row.optString("visibility"))
        }.filter { uuid.matches(it.id) }
    }

    suspend fun edit(post: NativeOwnPost, body: String): NativeOwnPost {
        accountId()
        if (!uuid.matches(post.id) || post.editCount > 0 || post.body.isBlank())
            throw AuthRequestException("This post cannot be edited again.")
        val result = JSONObject(request("${auth.backend.siteOrigin}/api/sauti/${post.id}", "PATCH",
            JSONObject().put("body", validBody(body))))
        val row = result.optJSONObject("data")?.optJSONObject("post")
        if (!result.optBoolean("ok") || row?.optString("id") != post.id) throw AuthRequestException("Edit could not be confirmed.")
        return post.copy(body = row.optString("body"), editCount = row.optInt("edit_count", 1))
    }

    suspend fun delete(post: NativeOwnPost) {
        accountId()
        if (!uuid.matches(post.id)) throw AuthRequestException("Invalid post reference.")
        val result = JSONObject(request("${auth.backend.siteOrigin}/api/sauti/${post.id}", "DELETE"))
        if (!result.optBoolean("ok") || result.optJSONObject("data")?.optString("id") != post.id)
            throw AuthRequestException("Deletion could not be confirmed.")
    }
}
