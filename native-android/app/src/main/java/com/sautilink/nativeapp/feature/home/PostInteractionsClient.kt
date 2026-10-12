package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** All writes in this class require an explicit user tap AND a production session.
 *  Website interaction endpoints retain their server-side rate limits and reply permissions.
 */
data class PostActionState(val liked: Boolean = false, val saved: Boolean = false)
data class NativePostComment(
    val id: String,
    val author: String,
    val handle: String,
    val body: String,
    val createdAt: String,
    val authorId: String,
    val replyCount: Int,
    val verified: Boolean,
    val badgeType: String
)

class PostInteractionsClient(private val auth: StagingAuthClient) {
    private val postIdPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val userIdPattern = postIdPattern
    private val rest = auth.restOrigin

    private fun checkedPostId(id: String): String {
        require(postIdPattern.matches(id)) { "Invalid post reference" }
        return id
    }

    private suspend fun access(): Pair<String, String> {
        val userId = auth.account?.id ?: throw AuthRequestException("Sign in to continue.")
        if (!userIdPattern.matches(userId)) throw AuthRequestException("Invalid account session.")
        return userId to auth.accessTokenForStagingRead()
    }

    private suspend fun writingAccess(): Pair<String, String> {
        if (auth.backend != SautiBackend.PRODUCTION) throw AuthRequestException("Test feed remains read only.")
        return access()
    }

    // Load independent interaction states. A slow Save lookup must never block Like.
    // Returning false happens only after a successful, RLS-protected GET.
    suspend fun getLikeStates(ids: List<String>): Map<String, Boolean> =
        getBooleanStates(ids, "social_post_reactions", "reaction_type=eq.like", "Like")

    suspend fun getSavedStates(ids: List<String>): Map<String, Boolean> =
        getBooleanStates(ids, "social_saved_posts", null, "Saved")

    suspend fun getRepostStates(ids: List<String>): Map<String, Boolean> =
        getBooleanStates(ids, "social_reposts", null, "Repost")

    /** A single RLS-protected read for the current viewer's Follow state across visible authors. */
    suspend fun getFollowingStates(authorIds: List<String>): Map<String, Boolean> {
        val authors = authorIds.filter(userIdPattern::matches).distinct()
        if (authors.isEmpty()) return emptyMap()
        val (userId, token) = access()
        return withContext(Dispatchers.IO) {
            val active = mutableSetOf<String>()
            // PostgREST IN lists are bounded to avoid oversized requests in a long feed.
            for (batch in authors.chunked(50)) {
                val rows = readArray(
                    "${rest}social_follows?follower_id=eq.$userId&followed_id=in.(${batch.joinToString(",")})&select=followed_id", token
                )
                for (index in 0 until rows.length()) {
                    rows.optJSONObject(index)?.optString("followed_id")?.let(active::add)
                }
            }
            authors.associateWith { it in active }
        }
    }

    /** Uses SautiLink's existing server-validated Follow/Unfollow route. */
    suspend fun setFollow(handle: String, active: Boolean) {
        val normalized = handle.trim().lowercase()
        if (!Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(normalized)) {
            throw AuthRequestException("This account cannot be followed from this post.")
        }
        val (_, token) = writingAccess()
        withContext(Dispatchers.IO) {
            val result = JSONObject(request(
                "${auth.backend.siteOrigin}/api/social/follow/$normalized",
                if (active) "POST" else "DELETE", token,
                if (active) "{}" else null
            ))
            val data = result.optJSONObject("data")
            if (!result.optBoolean("ok") || data?.optString("username") != normalized ||
                data?.optBoolean("following") != active) {
                throw AuthRequestException("Follow change could not be confirmed. Refresh the feed and check again.")
            }
        }
    }

    /** Canonical externally shareable link. This is a local string operation, not a network write. */
    fun postShareUrl(id: String): String = "${auth.backend.siteOrigin}/post/${checkedPostId(id)}"

    private suspend fun getBooleanStates(
        ids: List<String>, table: String, filter: String?, label: String
    ): Map<String, Boolean> {
        val filtered = ids.filter { postIdPattern.matches(it) }.distinct().take(50)
        if (filtered.isEmpty()) return emptyMap()
        val (userId, token) = access()
        return withContext(Dispatchers.IO) {
            val idsFilter = filtered.joinToString(",")
            val where = if (filter == null) "" else "&$filter"
            val rows = try {
                readArray("${rest}$table?user_id=eq.$userId&post_id=in.($idsFilter)$where&select=post_id", token)
            } catch (e: AuthRequestException) {
                throw AuthRequestException("$label status request failed: ${e.message}", e.httpStatus)
            }
            val active = (0 until rows.length()).mapNotNull {
                rows.optJSONObject(it)?.optString("post_id")
            }.toSet()
            filtered.associateWith { it in active }
        }
    }

    suspend fun setLike(id: String, active: Boolean) {
        val postId = checkedPostId(id)
        val (_, token) = writingAccess()
        withContext(Dispatchers.IO) {
            val method = if (active) "POST" else "DELETE"
            val body = if (active) "{}" else null
            val response = request("${auth.backend.siteOrigin}/api/social/posts/$postId/like", method, token, body)
            val obj = JSONObject(response)
            if (!obj.optBoolean("ok") || obj.optJSONObject("data")?.optBoolean("liked") != active) {
                throw AuthRequestException("Like could not be confirmed. Refresh and try again.")
            }
        }
    }

    /** Server owns the actual repost relationship, access checks and rate limit. */
    suspend fun setRepost(id: String, active: Boolean) {
        val postId = checkedPostId(id)
        val (_, token) = writingAccess()
        withContext(Dispatchers.IO) {
            val method = if (active) "POST" else "DELETE"
            val result = JSONObject(request("${auth.backend.siteOrigin}/api/social/posts/$postId/repost", method, token,
                if (active) "{}" else null))
            val response = result.optJSONObject("data")
            if (!result.optBoolean("ok") || response?.optString("post_id") != postId ||
                response?.optBoolean("reposted") != active) {
                throw AuthRequestException("Repost could not be confirmed. Refresh and try again.")
            }
        }
    }

    /** Get the canonical repost count; a successful mutation should not invent counts. */
    suspend fun loadRepostCount(id: String): Int {
        val postId = checkedPostId(id)
        val (_, token) = access()
        return withContext(Dispatchers.IO) {
            val rows = readArray("${rest}social_posts?id=eq.$postId&select=repost_count&limit=1", token)
            val row = rows.optJSONObject(0) ?: throw AuthRequestException("Post is unavailable.")
            row.optInt("repost_count").coerceAtLeast(0)
        }
    }

    suspend fun setSaved(id: String, active: Boolean) {
        val postId = checkedPostId(id)
        val (userId, token) = writingAccess()
        withContext(Dispatchers.IO) {
            if (active) {
                request(
                    "${rest}social_saved_posts",
                    "POST", token,
                    JSONObject().put("post_id", postId).put("user_id", userId).toString(),
                    mapOf("Prefer" to "resolution=ignore-duplicates,return=minimal")
                )
            } else {
                request("${rest}social_saved_posts?post_id=eq.$postId&user_id=eq.$userId", "DELETE", token)
            }
        }
    }

    suspend fun loadComments(id: String): List<NativePostComment> {
        val postId = checkedPostId(id)
        val (_, token) = access()
        return withContext(Dispatchers.IO) {
            val rows = readArray(
                "${rest}social_posts?parent_post_id=eq.$postId&select=id,author_id,body,created_at,comment_count&order=created_at.desc&limit=40", token
            )
            val comments = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
            val users = comments.map { it.optString("author_id") }.filter { userIdPattern.matches(it) }.distinct()
            val profiles = if (users.isEmpty()) emptyMap() else {
                val names = readArray("${rest}social_profiles?id=in.(${users.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type", token)
                (0 until names.length()).mapNotNull { names.optJSONObject(it) }.associateBy { it.optString("id") }
            }
            comments.mapNotNull { c ->
                val commentId = c.optString("id")
                if (!postIdPattern.matches(commentId)) return@mapNotNull null
                val profile = profiles[c.optString("author_id")]
                val handle = profile?.optString("username").orEmpty()
                NativePostComment(
                    commentId,
                    profile?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" } ?: handle.ifBlank { "SautiLink member" },
                    handle,
                    c.optString("body").takeUnless { it == "null" }.orEmpty(),
                    c.optString("created_at"),
                    c.optString("author_id"),
                    c.optInt("comment_count").coerceAtLeast(0),
                    profile?.optBoolean("is_verified", false) == true,
                    profile?.optString("verification_badge_type", "standard") ?: "standard"
                )
            }
        }
    }

    /** Refresh canonical parent comment count after posting/deleting nested replies. */
    suspend fun loadCommentCount(id: String): Int {
        val postId = checkedPostId(id)
        val (_, token) = access()
        return withContext(Dispatchers.IO) {
            val rows = readArray("${rest}social_posts?id=eq.$postId&select=comment_count&limit=1", token)
            val row = rows.optJSONObject(0) ?: throw AuthRequestException("Post is unavailable.")
            row.optInt("comment_count").coerceAtLeast(0)
        }
    }

    /** Request idempotency is supported by the existing social comments endpoint. */
    suspend fun sendComment(id: String, message: String, requestId: String): String {
        val postId = checkedPostId(id)
        val text = message.trim()
        if (text.isEmpty() || text.length > 500) throw AuthRequestException("Comment must be 1–500 characters.")
        if (!postIdPattern.matches(requestId)) throw AuthRequestException("Invalid comment request.")
        val (_, token) = writingAccess()
        return withContext(Dispatchers.IO) {
            val payload = JSONObject().put("body", text).put("client_request_id", requestId)
            val result = JSONObject(request("${auth.backend.siteOrigin}/api/social/posts/$postId/comments", "POST", token, payload.toString()))
            val confirmedId = result.optJSONObject("data")?.optJSONObject("comment")?.optString("id").orEmpty()
            if (!result.optBoolean("ok") || !postIdPattern.matches(confirmedId)) {
                throw AuthRequestException("Comment was not confirmed. Check the post before retrying.")
            }
            confirmedId
        }
    }

    /** Existing SautiLink DELETE endpoint enforces ownership and rate limits server-side. */
    suspend fun deleteOwnComment(id: String) {
        val commentId = checkedPostId(id)
        val (_, token) = writingAccess()
        withContext(Dispatchers.IO) {
            val result = JSONObject(request("${auth.backend.siteOrigin}/api/social/replies/$commentId", "DELETE", token))
            val returnedId = result.optJSONObject("data")?.optJSONObject("comment")?.optString("id").orEmpty()
            if (!result.optBoolean("ok") || returnedId != commentId) {
                throw AuthRequestException("Comment deletion could not be confirmed. Refresh and check again.")
            }
        }
    }

    private fun readArray(url: String, token: String): JSONArray {
        return JSONArray(request(url, "GET", token))
    }

    /** Returns body only after HTTP success; failures are deliberately non-sensitive to avoid exposing tokens. */
    private fun request(url: String, method: String, token: String, body: String? = null, extraHeaders: Map<String, String> = emptyMap()): String {
        val parsed = URL(url)
        val host = parsed.host.lowercase()
        if (parsed.protocol != "https" || (host != "${auth.backend.project}.supabase.co" && host != URL(auth.backend.siteOrigin).host)) {
            throw AuthRequestException("Untrusted API origin.")
        }
        val c = parsed.openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 10000
            c.readTimeout = 12000
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("apikey", auth.publicKeyForRead())
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("Cache-Control", "no-store")
            extraHeaders.forEach { (key, value) -> c.setRequestProperty(key, value) }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = c.responseCode
            if (status !in 200..299) {
                val errorBody = c.errorStream?.bufferedReader()?.use { it.readText().take(4096) }.orEmpty()
                val parsedError = runCatching { JSONObject(errorBody) }.getOrNull()
                val remote = parsedError?.optJSONObject("error")?.optString("message")
                    ?.takeIf { it.length in 1..220 }
                val code = (parsedError?.optJSONObject("error")?.optString("code")
                    ?: parsedError?.optString("code")).orEmpty()
                    .takeIf { Regex("^[A-Za-z0-9_:-]{1,55}$").matches(it) }
                val human = when (status) {
                    400, 403 -> remote?.takeIf { it.length in 1..220 } ?: "This interaction is not allowed."
                    401 -> "Session expired. Sign in and try again."
                    404 -> "The post or comment is unavailable."
                    409 -> remote?.takeIf { it.length in 1..220 } ?: "Could not save this change."
                    429 -> "Too many requests. Wait and try again."
                    in 500..599 -> "SautiLink is temporarily unavailable."
                    else -> "Request failed (HTTP $status)."
                }
                val diagnostic = "HTTP $status" + (code?.let { " · $it" } ?: "")
                throw AuthRequestException("$human ($diagnostic)", status)
            }
            return c.inputStream?.bufferedReader()?.use { it.readText().take(300000) }.orEmpty()
        } catch (e: AuthRequestException) {
            throw e
        } catch (e: Exception) {
            throw AuthRequestException("Connection failed. Check your internet and retry.")
        } finally {
            c.disconnect()
        }
    }
}
