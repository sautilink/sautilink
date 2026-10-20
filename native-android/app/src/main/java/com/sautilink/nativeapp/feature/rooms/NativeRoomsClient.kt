package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
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

data class NativeRoom(val id: String, val ownerId: String, val slug: String, val name: String,
    val description: String, val policy: String, val role: String?, val requestStatus: String?) {
    val isOwner get() = role == "owner" || ownerId.isNotBlank() && ownerId == currentOwnerId
    // Filled only by the client for the signed-in viewer.
    internal var currentOwnerId: String = ""
}
data class NativeRoomPost(val id: String, val authorId: String, val authorName: String,
    val authorHandle: String, val body: String, val createdAt: String,
    val verified: Boolean, val badgeType: String)
data class NativeRoomMember(val id: String, val role: String, val name: String, val handle: String,
    val verified: Boolean, val badgeType: String)
data class NativeJoinRequest(val requesterId: String, val name: String, val handle: String,
    val verified: Boolean, val badgeType: String)

/** Room operations follow the production web client's RLS policies and /api/sauti contract. */
class NativeRoomsClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val slugPattern = Regex("^[a-z0-9][a-z0-9-]{2,49}$")
    private val jsonType = "application/json".toMediaType()

    private suspend fun rest(path: String, method: String = "GET", payload: JSONObject? = null): JSONArray {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(auth.restOrigin + path)
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $token")
                .header("Accept", "application/json").header("Cache-Control", "no-store")
                .header("Prefer", "return=representation")
            when (method) {
                "POST" -> builder.post((payload ?: JSONObject()).toString().toRequestBody(jsonType))
                "PATCH" -> builder.patch((payload ?: JSONObject()).toString().toRequestBody(jsonType))
                "DELETE" -> builder.delete()
                else -> builder.get()
            }
            try {
                http.newCall(builder.build()).execute().use { response ->
                    val content = response.body?.string()?.take(160_000).orEmpty()
                    if (!response.isSuccessful) throw AuthRequestException(when (response.code) {
                        401, 403 -> "Room access denied. Check your membership or sign in again."
                        409 -> "That Room name or action is already in use. Refresh and try again."
                        429 -> "Too many Room requests. Try again shortly."
                        in 500..599 -> "Room service is temporarily unavailable."
                        else -> "Room request failed (HTTP ${response.code})."
                    }, response.code)
                    if (content.isBlank()) JSONArray() else JSONArray(content)
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to Rooms.") }
        }
    }

    private fun viewer(): String = auth.account?.id?.takeIf(uuid::matches)
        ?: throw AuthRequestException("Sign in to use Rooms.")

    suspend fun list(): List<NativeRoom> {
        val own = viewer()
        val circles = rest("social_circles?select=id,owner_id,slug,name,description,join_policy,created_at&order=created_at.desc&limit=60")
        val memberships = rest("social_circle_members?member_id=eq.$own&select=circle_id,member_role")
            .objects().associate { it.optString("circle_id") to it.optString("member_role") }
        val requests = rest("social_circle_join_requests?requester_id=eq.$own&select=circle_id,status")
            .objects().associate { it.optString("circle_id") to it.optString("status") }
        return circles.objects().mapNotNull { row ->
            val id = row.optString("id")
            val slug = row.optString("slug")
            if (!uuid.matches(id) || !slugPattern.matches(slug)) null else NativeRoom(
                id, row.optString("owner_id"), slug, row.optString("name"),
                row.optString("description").takeUnless { it == "null" }.orEmpty(),
                row.optString("join_policy"), memberships[id], requests[id]
            ).apply { currentOwnerId = own }
        }
    }

    suspend fun create(nameValue: String, slugValue: String, descriptionValue: String, policy: String): NativeRoom {
        val own = viewer()
        val name = nameValue.trim()
        val slug = slugValue.trim().lowercase()
        val description = descriptionValue.trim()
        if (name.length !in 1..80) throw AuthRequestException("Room name must be 1–80 characters.")
        if (!slugPattern.matches(slug)) throw AuthRequestException("Room address must be 3–50 lowercase letters, numbers or hyphens.")
        if (description.length > 1000) throw AuthRequestException("Room description must be 1,000 characters or fewer.")
        if (policy !in setOf("open", "approval", "private")) throw AuthRequestException("Choose a Room membership policy.")
        val row = rest("social_circles?select=id,owner_id,slug,name,description,join_policy", "POST",
            JSONObject().put("owner_id", own).put("name", name).put("slug", slug)
                .put("description", description).put("join_policy", policy)).optJSONObject(0)
            ?: throw AuthRequestException("Room was not created.")
        return NativeRoom(row.optString("id"), own, slug, name, description, policy, "owner", null)
            .apply { currentOwnerId = own }
    }

    suspend fun delete(room: NativeRoom) {
        val own = viewer()
        if (room.ownerId != own || !uuid.matches(room.id)) throw AuthRequestException("Only the owner can delete this Room.")
        val deleted = rest("social_circles?id=eq.${room.id}&owner_id=eq.$own&select=id", "DELETE")
        if (deleted.length() != 1) throw AuthRequestException("Room was not deleted. Refresh and try again.")
    }

    suspend fun join(room: NativeRoom) {
        val own = viewer()
        if (room.policy != "open" || room.role != null || room.ownerId == own) throw AuthRequestException("This Room cannot be joined directly.")
        val rows = rest("social_circle_members?select=circle_id", "POST",
            JSONObject().put("circle_id", room.id).put("member_id", own).put("member_role", "member"))
        if (rows.length() != 1) throw AuthRequestException("Room membership was not confirmed.")
    }

    suspend fun leave(room: NativeRoom) {
        val own = viewer()
        if (room.ownerId == own || room.role == null) throw AuthRequestException("Room owner cannot leave the Room.")
        val rows = rest("social_circle_members?circle_id=eq.${room.id}&member_id=eq.$own&select=circle_id", "DELETE")
        if (rows.length() != 1) throw AuthRequestException("Could not leave Room. Refresh and try again.")
    }

    suspend fun requestJoin(room: NativeRoom) {
        val own = viewer()
        if (room.policy != "approval" || room.role != null || room.ownerId == own || room.requestStatus == "pending")
            throw AuthRequestException("A join request is not available for this Room.")
        if (room.requestStatus != null) rest("social_circle_join_requests?circle_id=eq.${room.id}&requester_id=eq.$own", "DELETE")
        val rows = rest("social_circle_join_requests?select=circle_id", "POST",
            JSONObject().put("circle_id", room.id).put("requester_id", own))
        if (rows.length() != 1) throw AuthRequestException("Join request was not confirmed.")
    }

    suspend fun posts(room: NativeRoom): List<NativeRoomPost> {
        viewer()
        if (!room.isOwner && room.role == null) return emptyList()
        val posts = rest("social_posts?circle_id=eq.${room.id}&visibility=eq.circle&reply_to_post_id=is.null&select=id,author_id,body,created_at&order=created_at.desc&limit=50")
            .objects().filter { uuid.matches(it.optString("id")) }
        val ids = posts.mapNotNull { it.optString("author_id").takeIf(uuid::matches) }.distinct()
        val authors = if (ids.isEmpty()) emptyMap() else rest(
            "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type"
        ).objects().associateBy { it.optString("id") }
        return posts.map { row ->
            val author = authors[row.optString("author_id")]
            val handle = author?.optString("username").orEmpty()
            NativeRoomPost(row.optString("id"), row.optString("author_id"),
                author?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                    ?: handle.ifBlank { "SautiLink member" }, handle,
                row.optString("body").takeUnless { it == "null" }.orEmpty(), row.optString("created_at"),
                author?.optBoolean("is_verified", false) == true,
                author?.optString("verification_badge_type", "standard") ?: "standard")
        }
    }

    suspend fun publish(room: NativeRoom, bodyValue: String) {
        val own = viewer()
        if (!room.isOwner && room.role == null) throw AuthRequestException("Join this Room before posting.")
        val body = bodyValue.trim()
        if (body.length !in 1..500) throw AuthRequestException("Room post must be 1–500 characters.")
        val token = auth.accessTokenForStagingRead()
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url(auth.backend.siteOrigin + "/api/sauti")
                .header("Authorization", "Bearer $token").header("Accept", "application/json")
                .post(JSONObject().put("body", body).put("circle_id", room.id)
                    .put("reply_access", "everyone").toString().toRequestBody(jsonType)).build()
            try {
                http.newCall(request).execute().use { response ->
                    val json = runCatching { JSONObject(response.body?.string()?.take(16_384).orEmpty()) }.getOrNull()
                    if (!response.isSuccessful || json?.optBoolean("ok") != true)
                        throw AuthRequestException(json?.optJSONObject("error")?.optString("message")
                            ?.takeIf { it.isNotBlank() } ?: "Room post could not be published.", response.code)
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to Room posting.") }
        }
    }

    suspend fun members(room: NativeRoom): List<NativeRoomMember> {
        val own = viewer()
        if (room.ownerId != own) return emptyList() // Match the web owner-only member list.
        val rows = rest("social_circle_members?circle_id=eq.${room.id}&select=member_id,member_role&order=joined_at.asc")
            .objects()
        val ids = rows.mapNotNull { it.optString("member_id").takeIf(uuid::matches) }
        val profiles = if (ids.isEmpty()) emptyMap() else rest(
            "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type"
        ).objects().associateBy { it.optString("id") }
        return rows.map { row ->
            val id = row.optString("member_id")
            val person = profiles[id]
            NativeRoomMember(id, row.optString("member_role"),
                person?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                    ?: person?.optString("username").orEmpty().ifBlank { "SautiLink member" },
                person?.optString("username").orEmpty(),
                person?.optBoolean("is_verified", false) == true,
                person?.optString("verification_badge_type", "standard") ?: "standard")
        }
    }

    suspend fun pendingRequests(room: NativeRoom): List<NativeJoinRequest> {
        val own = viewer()
        if (room.ownerId != own) return emptyList()
        val rows = rest("social_circle_join_requests?circle_id=eq.${room.id}&status=eq.pending&select=requester_id")
            .objects()
        val ids = rows.mapNotNull { it.optString("requester_id").takeIf(uuid::matches) }
        val profiles = if (ids.isEmpty()) emptyMap() else rest(
            "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type"
        ).objects().associateBy { it.optString("id") }
        return rows.map { row ->
            val id = row.optString("requester_id")
            val person = profiles[id]
            NativeJoinRequest(id, person?.optString("display_name")
                ?.takeUnless { it.isBlank() || it == "null" }
                ?: person?.optString("username").orEmpty().ifBlank { "SautiLink member" },
                person?.optString("username").orEmpty(),
                person?.optBoolean("is_verified", false) == true,
                person?.optString("verification_badge_type", "standard") ?: "standard")
        }
    }

    suspend fun decide(room: NativeRoom, requesterId: String, approve: Boolean) {
        val own = viewer()
        if (room.ownerId != own || !uuid.matches(requesterId)) throw AuthRequestException("Only the Room owner can decide requests.")
        val rows = rest("social_circle_join_requests?circle_id=eq.${room.id}&requester_id=eq.$requesterId&status=eq.pending&select=requester_id",
            "PATCH", JSONObject().put("status", if (approve) "approved" else "declined"))
        if (rows.length() != 1) throw AuthRequestException("Request status changed. Refresh and try again.")
    }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull(::optJSONObject)
