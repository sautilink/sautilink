package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.home.FeedMedia
import com.sautilink.nativeapp.feature.home.StagingFeedPost
import java.util.Locale

/** Metadata is discoverable; content privacy and the way people join are independent. */
data class NativeRoom(
    val id: String, val ownerId: String, val slug: String, val name: String,
    val description: String, val policy: String, val role: String?, val requestStatus: String?,
    val viewerId: String = "", val category: String = "general", val privacy: String = "public",
    val coverKey: String? = null, val memberCount: Int = 0,
    val postPermission: String = "all_members", val invitePermission: String = "all_members",
    val updatedAt: String = "", val approvalCapability: Boolean = false,
    val postApprovalRequired: Boolean = false
) {
    val isOwner get() = role == "owner" || viewerId.isNotBlank() && ownerId == viewerId
    val isMember get() = isOwner || role in NativeRoomRules.roles
    val isStaff get() = isOwner || role in setOf("admin", "moderator")
    val canManageSettings get() = isOwner || role == "admin"
    val canManagePeople get() = isStaff
    val canSeeMembers get() = isMember
    // Current circle-post RLS requires membership for public and private Room discussions.
    val canReadPosts get() = isMember
    val canPost get() = isMember && (postPermission == "all_members" || isStaff)
    val canInvite get() = isMember && (invitePermission == "all_members" || isStaff)
    // Enabled only by a positive response from the real server capability endpoint.
    val supportsPostApproval get() = approvalCapability
    val coverPath: String? get() {
        if (!NativeRoomRules.slug.matches(slug) || coverKey.isNullOrBlank()) return null
        val version = coverKey.substringAfterLast('/').substringBeforeLast('.').take(80)
            .filter { it.isLetterOrDigit() || it == '-' || it == '_' }
        return "/api/room-media/$slug/cover?w=960&v=${version.ifBlank { "legacy" }}"
    }

    fun availableRolesFor(member: NativeRoomMember): List<String> = when {
        member.role !in NativeRoomRules.roles || member.role == "owner" || member.id == viewerId -> emptyList()
        isOwner -> listOf("member", "moderator", "admin")
        role == "admin" && member.role in setOf("member", "moderator") -> listOf("member", "moderator")
        else -> emptyList()
    }

    fun canRemoveMember(member: NativeRoomMember): Boolean = when {
        member.role == "owner" || member.id == viewerId -> false
        isOwner -> member.role in NativeRoomRules.roles
        role == "admin" -> member.role in setOf("member", "moderator")
        role == "moderator" -> member.role == "member"
        else -> false
    }

    fun settings() = NativeRoomSettings(name, slug, description, policy, category, privacy,
        postPermission, invitePermission, postApprovalRequired)
}

data class NativeRoomSettings(
    val name: String, val slug: String, val description: String, val policy: String,
    val category: String = "general", val privacy: String = "public",
    val postPermission: String = "all_members", val invitePermission: String = "all_members",
    val postApprovalRequired: Boolean = false
) {
    fun normalized() = copy(name = name.trim(), slug = slug.trim().lowercase(Locale.ROOT),
        description = description.trim())

    fun validationError(existingPrivacy: String? = null): String? {
        val value = normalized()
        return when {
            value.name.length !in 1..80 -> "Room name must be 1–80 characters."
            !NativeRoomRules.slug.matches(value.slug) -> "Room address must be 3–50 lowercase letters, numbers or hyphens."
            value.description.length > 1000 -> "Room description must be 1,000 characters or fewer."
            value.policy !in NativeRoomRules.policies -> "Choose a Room membership policy."
            value.category !in NativeRoomRules.categories -> "Choose a valid Room category."
            value.privacy !in setOf("public", "private") -> "Choose a valid Room privacy setting."
            existingPrivacy != null && value.privacy != existingPrivacy ->
                "Changing an existing Room's privacy is not available in this app. Its history keeps its current privacy."
            value.privacy == "private" && value.policy == "open" ->
                "Private Rooms require approval or an invitation to join."
            value.postPermission !in NativeRoomRules.permissions || value.invitePermission !in NativeRoomRules.permissions ->
                "Choose valid posting and invitation permissions."
            else -> null
        }
    }
}

data class NativeRoomPost(
    val id: String, val authorId: String, val authorName: String, val authorHandle: String,
    val body: String, val createdAt: String, val verified: Boolean, val badgeType: String,
    val likes: Int = 0, val comments: Int = 0, val reposts: Int = 0, val mediaCount: Int = 0,
    val media: List<FeedMedia> = emptyList(), val hasAvatar: Boolean = false
) {
    fun asFeedPost() = StagingFeedPost(id, authorId, authorName, authorHandle, verified,
        badgeType, body, createdAt, likes, comments, reposts, mediaCount, media, hasAvatar)
}

data class NativeRoomMember(val id: String, val role: String, val name: String, val handle: String,
    val verified: Boolean, val badgeType: String, val hasAvatar: Boolean = false, val joinedAt: String = "")

data class NativeJoinRequest(val requesterId: String, val name: String, val handle: String,
    val verified: Boolean, val badgeType: String, val hasAvatar: Boolean = false, val createdAt: String = "")

data class NativeRoomInvitation(val room: NativeRoom, val invitedBy: String, val createdAt: String,
    val invitedByName: String = "SautiLink member", val invitedByHandle: String = "")

data class NativeRoomCapabilities(val postApproval: Boolean = false)

sealed class NativeRoomPublishResult {
    data class Published(val postId: String) : NativeRoomPublishResult()
    data class Pending(val submissionId: String) : NativeRoomPublishResult()
}

data class NativeRoomSubmission(
    val id: String, val roomId: String, val authorId: String, val body: String,
    val replyAccess: String, val mediaCount: Int, val state: String, val version: Int,
    val createdAt: String, val decidedAt: String? = null, val decisionReason: String = "",
    val publishedPostId: String? = null, val media: List<NativeRoomSubmissionMedia> = emptyList(),
    val authorName: String = "SautiLink member", val authorHandle: String = "",
    val verified: Boolean = false, val badgeType: String = "standard", val hasAvatar: Boolean = false
)

data class NativeRoomSubmissionMedia(val id: String, val kind: String, val position: Int,
    val altText: String, val width: Int, val height: Int, val durationMs: Long) {
    fun path(roomId: String, submissionId: String): String {
        require(listOf(roomId, submissionId, id).all(NativeRoomRules.uuid::matches))
        return "/api/rooms/$roomId/post-submissions/$submissionId/media/$id"
    }
}

data class NativeRoomSubmissionPage(val submissions: List<NativeRoomSubmission>, val nextCursor: String?)

object NativeRoomRules {
    // Post attachments share the public post limit; Stories and DMs have separate policies.
    fun mediaLimit(@Suppress("UNUSED_PARAMETER") kinds: List<String>): Int = com.sautilink.nativeapp.feature.posts.NativePostMediaPolicy.MAX_ATTACHMENTS

    val uuid = Regex("^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
    val slug = Regex("^[a-z0-9][a-z0-9-]{2,49}$")
    val handle = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
    val mention = Regex("(^|[^a-z0-9._])@[a-z0-9][a-z0-9._]{2,29}(?=$|[^a-z0-9._])", RegexOption.IGNORE_CASE)
    val roles = setOf("owner", "admin", "moderator", "member")
    val policies = setOf("open", "approval", "private")
    val permissions = setOf("all_members", "staff_only")
    val categories: Map<String, String> = linkedMapOf(
        "general" to "General", "technology" to "Technology & AI", "learning" to "Learning & Education",
        "business" to "Business & Entrepreneurship", "marketplace" to "Marketplace & Trading",
        "creators" to "Creators & Media", "fashion" to "Fashion & Style",
        "friends-community" to "Friends & Community", "gaming" to "Gaming", "sports" to "Sports & Fitness",
        "music" to "Music", "arts-culture" to "Arts & Culture", "science" to "Science",
        "health-wellness" to "Health & Wellness", "travel" to "Travel", "local-community" to "Local Community",
        "family-parenting" to "Family & Parenting", "food" to "Food & Cooking", "hobbies" to "Hobbies & Interests"
    )
}
