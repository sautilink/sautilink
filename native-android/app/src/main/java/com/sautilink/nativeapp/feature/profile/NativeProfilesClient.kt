package com.sautilink.nativeapp.feature.profile

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.PostInteractionsClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

data class NativeProfile(
    val id: String,
    val username: String,
    val displayName: String,
    val bio: String,
    val location: String,
    val website: String,
    val discoverable: Boolean,
    val followers: Int,
    val following: Int,
    val joinedAt: String,
    val hasAvatar: Boolean,
    val hasHeader: Boolean,
    val categorySlug: String,
    val verified: Boolean,
    val badgeType: String,
    val dmAccess: String = "none",
    val verifiedSince: String = ""
)

data class ProfileEdit(val bio: String, val location: String, val website: String, val discoverable: Boolean)
data class IdentityControls(val nameRemaining: Int, val usernameRemaining: Int, val usernameLocked: Boolean,
    val verified: Boolean, val nextNameChange: String, val nextUsernameChange: String)

/** Profile reads use PostgREST RLS. Writes are restricted to the four owner-editable columns. */
class NativeProfilesClient(private val auth: StagingAuthClient) {
    private val uuid = Regex("^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
    private val handle = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val select = "id,username,display_name,bio,location,website_url,is_discoverable,followers_count,following_count,created_at,avatar_key,header_key,professional_category_slug,is_verified,verification_badge_type,dm_access,username_locked_at"

    private suspend fun rows(path: String): JSONArray = JSONArray(call(path, "GET"))

    private suspend fun call(path: String, method: String, body: JSONObject? = null, prefer: String? = null): String {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url("${auth.restOrigin}$path")
                .header("apikey", auth.publicKeyForRead())
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
            if (prefer != null) builder.header("Prefer", prefer)
            if (method == "PATCH") builder.patch((body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
            else builder.get()
            try {
                http.newCall(builder.build()).execute().use { response ->
                    // The public professional-category catalog is larger than the profile payload.
                    val content = response.body?.string()?.take(300_000).orEmpty()
                    if (!response.isSuccessful) throw AuthRequestException(when (response.code) {
                        401, 403 -> "Profile access denied. Check your session and try again."
                        429 -> "Too many requests. Try again shortly."
                        in 500..599 -> "Profile service is temporarily unavailable."
                        else -> "Profile request failed (HTTP ${response.code})."
                    }, response.code)
                    content
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to the profile service.") }
        }
    }

    private fun parse(row: JSONObject) = NativeProfile(
        id = row.getString("id"), username = row.optString("username"),
        displayName = row.optString("display_name").ifBlank { row.optString("username") },
        bio = row.optString("bio").takeUnless { it == "null" }.orEmpty(),
        location = row.optString("location").takeUnless { it == "null" }.orEmpty(),
        website = row.optString("website_url").takeUnless { it == "null" }.orEmpty(),
        discoverable = row.optBoolean("is_discoverable"),
        followers = row.optInt("followers_count").coerceAtLeast(0),
        following = row.optInt("following_count").coerceAtLeast(0),
        joinedAt = row.optString("created_at"),
        hasAvatar = !row.isNull("avatar_key") && row.optString("avatar_key").isNotBlank(),
        hasHeader = !row.isNull("header_key") && row.optString("header_key").isNotBlank(),
        categorySlug = row.optString("professional_category_slug").takeUnless { it == "null" }.orEmpty(),
        verified = row.optBoolean("is_verified"),
        badgeType = row.optString("verification_badge_type", "standard"),
        dmAccess = row.optString("dm_access", "none"),
        verifiedSince = if (row.optBoolean("is_verified"))
            row.optString("username_locked_at").takeUnless { it == "null" }.orEmpty() else ""
    )

    /** Same professional category taxonomy and column-level ownership policy as SautiLink Web. */
    internal suspend fun categoryCatalog(): List<ProfileProfessionalCategory> {
        val categories = rows("profile_categories?select=slug,label,group_name,description&order=group_name.asc,label.asc&limit=1000")
        return (0 until categories.length()).mapNotNull {
            val o = categories.optJSONObject(it) ?: return@mapNotNull null
            ProfileProfessionalCategory(o.optString("slug"), o.optString("label"),
                o.optString("group_name"), o.optString("description"))
        }.filter { it.slug.isNotBlank() && it.label.isNotBlank() }
    }

    suspend fun saveCategory(slug: String): NativeProfile {
        if (auth.backend != SautiBackend.PRODUCTION) throw AuthRequestException("Editing is unavailable.")
        val id = auth.account?.id?.takeIf(uuid::matches)
            ?: throw AuthRequestException("Sign in to update your category.")
        if (slug.isNotEmpty() && !Regex("^[a-z0-9-]{2,80}$").matches(slug))
            throw AuthRequestException("Choose an available category.")
        val confirmed = if (slug.isNotEmpty()) categoryCatalog().any { it.slug == slug } else true
        if (!confirmed) throw AuthRequestException("Choose a category from the list.")
        val payload = JSONObject().put("professional_category_slug",
            if (slug.isBlank()) JSONObject.NULL else slug)
        val result = JSONArray(call("social_profiles?id=eq.$id&select=$select", "PATCH", payload,
            "return=representation"))
        val updated = result.optJSONObject(0)
            ?: throw AuthRequestException("Category update was not confirmed.")
        if (updated.optString("id") != id) throw AuthRequestException("Profile identity did not match.")
        return parse(updated)
    }

    suspend fun own(): NativeProfile? {
        val id = auth.account?.id ?: throw AuthRequestException("Sign in to view your profile.")
        if (!uuid.matches(id)) throw AuthRequestException("Invalid account session.")
        val result = rows("social_profiles?id=eq.$id&select=$select&limit=1")
        val row = result.optJSONObject(0) ?: return null
        if (row.optString("id") != id) throw AuthRequestException("Profile identity did not match.")
        return parse(row)
    }

    suspend fun byHandle(username: String): NativeProfile? {
        val normalized = username.trim().lowercase()
        if (!handle.matches(normalized)) throw AuthRequestException("Invalid profile address.")
        val result = rows("social_profiles?username=eq.$normalized&is_discoverable=eq.true&select=$select&limit=1")
        return result.optJSONObject(0)?.let(::parse)
    }

    /** Conservative visibility check; backend RPC still enforces the actual DM policy. */
    suspend fun canMessage(profile: NativeProfile): Boolean {
        val ownId = auth.account?.id?.takeIf(uuid::matches) ?: return false
        if (ownId == profile.id) return false
        return when (profile.dmAccess) {
            "everyone" -> true
            "following" -> {
                // "Following" means a member the recipient follows, not any follower.
                rows("social_follows?follower_id=eq.${profile.id}&followed_id=eq.$ownId&select=followed_id&limit=1").length() > 0
            }
            else -> false
        }
    }

    suspend fun following(profileId: String): Boolean {
        val ownId = auth.account?.id ?: return false
        if (!uuid.matches(ownId) || !uuid.matches(profileId)) return false
        return rows("social_follows?follower_id=eq.$ownId&followed_id=eq.$profileId&select=followed_id&limit=1").length() > 0
    }

    suspend fun setFollowing(profile: NativeProfile, active: Boolean) {
        if (auth.backend != SautiBackend.PRODUCTION) throw AuthRequestException("Following is available on production only.")
        PostInteractionsClient(auth).setFollow(profile.username, active)
    }

    suspend fun save(edit: ProfileEdit): NativeProfile {
        if (auth.backend != SautiBackend.PRODUCTION) throw AuthRequestException("Editing is available on production only.")
        val id = auth.account?.id ?: throw AuthRequestException("Sign in to edit your profile.")
        if (!uuid.matches(id)) throw AuthRequestException("Invalid account session.")
        val bio = edit.bio.trim()
        val location = edit.location.trim()
        val website = edit.website.trim()
        if (bio.length > 500) throw AuthRequestException("Bio must be 500 characters or fewer.")
        if (location.length > 100) throw AuthRequestException("Location must be 100 characters or fewer.")
        if (website.length > 2048) throw AuthRequestException("Website must be 2,048 characters or fewer.")
        if (website.isNotEmpty()) {
            val uri = runCatching { URI(website) }.getOrNull()
            if (uri == null || uri.scheme !in listOf("http", "https") || uri.host.isNullOrBlank() ||
                uri.userInfo != null || uri.fragment != null) {
                throw AuthRequestException("Enter a complete http:// or https:// website without credentials.")
            }
        }
        val payload = JSONObject().put("bio", bio)
            .put("location", location.ifEmpty { JSONObject.NULL })
            .put("website_url", website.ifEmpty { JSONObject.NULL })
            .put("is_discoverable", edit.discoverable)
        val result = JSONArray(call("social_profiles?id=eq.$id&select=$select", "PATCH", payload, "return=representation"))
        val row = result.optJSONObject(0) ?: throw AuthRequestException("Profile was not updated. Refresh and try again.")
        if (row.optString("id") != id) throw AuthRequestException("Profile identity did not match.")
        return parse(row)
    }

    /** The follow table exposes only relationships involving the viewer. */
    suspend fun ownConnections(kind: String): List<NativeProfile> {
        val id = auth.account?.id ?: throw AuthRequestException("Sign in to view connections.")
        if (!uuid.matches(id) || kind !in setOf("followers", "following")) throw AuthRequestException("Invalid connection list.")
        val filter = if (kind == "followers") "followed_id=eq.$id&select=follower_id" else "follower_id=eq.$id&select=followed_id"
        val field = if (kind == "followers") "follower_id" else "followed_id"
        val follows = rows("social_follows?$filter&order=created_at.desc&limit=100")
        val ids = (0 until follows.length()).mapNotNull { follows.optJSONObject(it)?.optString(field) }
            .filter(uuid::matches).distinct()
        if (ids.isEmpty()) return emptyList()
        val profiles = rows("social_profiles?id=in.(${ids.joinToString(",")})&select=$select")
        val byId = (0 until profiles.length()).mapNotNull { profiles.optJSONObject(it)?.let(::parse) }.associateBy { it.id }
        return ids.mapNotNull(byId::get)
    }

    private suspend fun identityRequest(method: String, payload: JSONObject? = null): JSONObject {
        if (auth.backend != SautiBackend.PRODUCTION) throw AuthRequestException("Account controls are production only.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url("${auth.backend.siteOrigin}/api/account/identity")
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
            if (method == "POST") builder.post((payload ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
            else builder.get()
            try {
                http.newCall(builder.build()).execute().use { response ->
                    val json = runCatching { JSONObject(response.body?.string()?.take(16_384).orEmpty()) }.getOrElse { JSONObject() }
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        throw AuthRequestException(json.optJSONObject("error")?.optString("message")
                            ?.takeIf { it.isNotBlank() } ?: "Account control failed (HTTP ${response.code}).", response.code)
                    }
                    json.optJSONObject("data") ?: throw AuthRequestException("Account response was incomplete.")
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to account controls.") }
        }
    }

    suspend fun identityControls(): IdentityControls {
        val data = identityRequest("GET")
        val name = data.optJSONObject("display_name") ?: JSONObject()
        val username = data.optJSONObject("username") ?: JSONObject()
        val verified = data.optJSONObject("profile")?.optBoolean("is_verified") ?: false
        return IdentityControls(
            nameRemaining = if (verified) name.optInt("changes_remaining_month", 0)
                else name.optInt("changes_remaining_14_days", 0),
            usernameRemaining = username.optInt("changes_remaining_30_days", 0),
            usernameLocked = username.optBoolean("locked_permanently"),
            verified = verified,
            nextNameChange = name.optString("next_change_at").takeUnless { it == "null" }.orEmpty(),
            nextUsernameChange = username.optString("next_change_at").takeUnless { it == "null" }.orEmpty()
        )
    }

    suspend fun changeIdentity(field: String, value: String): String {
        val normalized = value.trim()
        if (field == "display_name") {
            if (normalized.length !in 1..80) throw AuthRequestException("Display name must be 1–80 characters.")
        } else if (field == "username") {
            if (!handle.matches(normalized)) throw AuthRequestException("Username must be 3–30 lowercase letters, numbers, dots or underscores.")
        } else throw AuthRequestException("Invalid account field.")
        val data = identityRequest("POST", JSONObject().put("field", field).put("value", normalized)
            .put("request_id", UUID.randomUUID().toString()))
        return data.optString("status").takeIf { it in setOf("changed", "unchanged", "pending") }
            ?: throw AuthRequestException("Identity change could not be confirmed.")
    }
}

internal data class ProfileProfessionalCategory(val slug: String, val label: String,
    val group: String, val description: String)
