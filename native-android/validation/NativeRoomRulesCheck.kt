package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.home.FeedMedia
import com.sautilink.nativeapp.feature.home.checkedPostMediaPath
import java.io.PrintStream
import java.util.Locale

private const val roomId = "11111111-1111-4111-8111-111111111111"
private const val ownerId = "22222222-2222-4222-8222-222222222222"
private const val viewerId = "33333333-3333-4333-8333-333333333333"
private const val targetId = "44444444-4444-4444-8444-444444444444"
private var checks = 0
private val failures = mutableListOf<String>()

private fun verify(label: String, condition: Boolean) {
    checks++
    if (!condition) failures += label
}

private fun room(role: String?, owner: String = ownerId) = NativeRoom(
    roomId, owner, "sauti-room", "Sauti Room", "Discussion", "open", role, null,
    viewerId = viewerId
)

/** Executes actual production Room models/rules; feed types are supplied only in generated test scope. */
fun main() {
    System.setOut(PrintStream(System.out, true, Charsets.UTF_8))

    data class Access(val role: String?, val member: Boolean, val staff: Boolean, val settings: Boolean)
    val access = listOf(
        Access("owner", true, true, true), Access("admin", true, true, true),
        Access("moderator", true, true, false), Access("member", true, false, false),
        Access(null, false, false, false), Access("superadmin", false, false, false)
    )
    for (case in access) {
        val value = room(case.role, if (case.role == "owner") viewerId else ownerId)
        val label = case.role ?: "nonmember"
        verify("$label membership", value.isMember == case.member)
        verify("$label staff", value.isStaff == case.staff)
        verify("$label settings", value.canManageSettings == case.settings)
        verify("$label people management", value.canManagePeople == case.staff)
        verify("$label member roster", value.canSeeMembers == case.member)
        verify("$label discussion", value.canReadPosts == case.member)
        verify("$label default posting", value.canPost == case.member)
        verify("$label default invitations", value.canInvite == case.member)
        val restricted = value.copy(postPermission = "staff_only", invitePermission = "staff_only")
        verify("$label restricted posting", restricted.canPost == case.staff)
        verify("$label restricted invitations", restricted.canInvite == case.staff)
        verify("$label private discussion", value.copy(privacy = "private").canReadPosts == case.member)
        verify("$label default capability", !value.supportsPostApproval)
        verify("$label unadvertised flag cannot enable capability", !value.copy(postApprovalRequired = true).supportsPostApproval)
        verify("$label advertised capability", value.copy(approvalCapability = true).supportsPostApproval)
    }
    val owner = room("owner", viewerId)
    verify("legacy owner recognized by signed-in owner ID", room(null, viewerId).isOwner)
    verify("anonymous owner fallback is denied", room(null).copy(viewerId = "", ownerId = "").isOwner.not())
    val targets = listOf("owner", "admin", "moderator", "member", "unknown")
    val roleOptions = mapOf(
        "owner" to mapOf("admin" to listOf("member", "moderator", "admin"),
            "moderator" to listOf("member", "moderator", "admin"), "member" to listOf("member", "moderator", "admin")),
        "admin" to mapOf("moderator" to listOf("member", "moderator"), "member" to listOf("member", "moderator"))
    )
    val removable = mapOf("owner" to setOf("admin", "moderator", "member"),
        "admin" to setOf("moderator", "member"), "moderator" to setOf("member"))
    for (case in access) {
        val actor = room(case.role, if (case.role == "owner") viewerId else ownerId)
        for (targetRole in targets) {
            val target = NativeRoomMember(targetId, targetRole, "Target", "target", false, "standard")
            verify("${case.role} role options for $targetRole",
                actor.availableRolesFor(target) == roleOptions[case.role]?.get(targetRole).orEmpty())
            verify("${case.role} removal of $targetRole",
                actor.canRemoveMember(target) == (targetRole in removable[case.role].orEmpty()))
            verify("${case.role} cannot change own $targetRole role", actor.availableRolesFor(target.copy(id = viewerId)).isEmpty())
            verify("${case.role} cannot remove self $targetRole", !actor.canRemoveMember(target.copy(id = viewerId)))
        }
    }

    val base = NativeRoomSettings("Sauti", "sauti-room", "Description", "open")
    for ((privacy, policy) in listOf("public" to "open", "public" to "approval", "public" to "private",
        "private" to "approval", "private" to "private")) {
        verify("independent privacy=$privacy join=$policy", base.copy(privacy = privacy, policy = policy).validationError() == null)
    }
    verify("private open creation rejected", base.copy(privacy = "private").validationError() != null)
    verify("public invite-only stays public", base.copy(policy = "private").normalized().privacy == "public")
    verify("public to private edit rejected", base.copy(privacy = "private", policy = "approval").validationError("public") != null)
    verify("private to public edit rejected", base.validationError("private") != null)
    verify("unchanged public edit accepted", base.validationError("public") == null)
    verify("unchanged private edit accepted", base.copy(privacy = "private", policy = "approval").validationError("private") == null)
    val validBoundarySettings = listOf(base.copy(name = "a"), base.copy(name = "a".repeat(80)),
        base.copy(slug = "abc"), base.copy(slug = "a".repeat(50)), base.copy(description = ""),
        base.copy(description = "x".repeat(1000)), base.copy(postPermission = "staff_only"),
        base.copy(invitePermission = "staff_only"))
    validBoundarySettings.forEachIndexed { index, value -> verify("valid settings boundary $index", value.validationError() == null) }
    val invalidSettings = listOf(base.copy(name = "  "), base.copy(name = "a".repeat(81)),
        base.copy(slug = "ab"), base.copy(slug = "a".repeat(51)), base.copy(slug = "-sauti"),
        base.copy(slug = "sauti room"), base.copy(slug = "sauti?x=y"), base.copy(description = "x".repeat(1001)),
        base.copy(category = "unknown"), base.copy(privacy = "hidden"), base.copy(policy = "invite-only"),
        base.copy(postPermission = "admins"), base.copy(invitePermission = "everyone"))
    invalidSettings.forEachIndexed { index, value -> verify("invalid settings boundary $index", value.validationError() != null) }
    for (category in NativeRoomRules.categories.keys) verify("category $category accepted", base.copy(category = category).validationError() == null)
    val originalLocale = Locale.getDefault()
    try {
        Locale.setDefault(Locale.forLanguageTag("tr-TR"))
        val normalized = base.copy(name = "  Sauti 🌍  ", slug = "  IROOM  ", description = "  Hello  ").normalized()
        verify("normalization uses stable locale", normalized.slug == "iroom")
        verify("normalization preserves Unicode name", normalized.name == "Sauti 🌍")
        verify("normalization trims description", normalized.description == "Hello")
    } finally { Locale.setDefault(originalLocale) }

    for (count in 0..5) verify("photo count $count fits existing five-photo contract",
        count <= NativeRoomRules.mediaLimit(List(count) { "image" }))
    verify("six photos exceed contract", 6 > NativeRoomRules.mediaLimit(List(6) { "image" }))
    verify("four mixed media fit retained bound", 4 <= NativeRoomRules.mediaLimit(listOf("image", "video", "image", "image")))
    verify("five mixed media exceed retained bound", 5 > NativeRoomRules.mediaLimit(listOf("image", "video", "image", "image", "image")))
    verify("video-only keeps existing four-item limit", NativeRoomRules.mediaLimit(listOf("video")) == 4)
    for (text in listOf("@cloud_engine", "Hello @cloud_engine!", "(@abc)", "@" + "a".repeat(30)))
        verify("valid comment mention $text", NativeRoomRules.mention.containsMatchIn(text))
    for (text in listOf("", "name@cloud_engine", "@ab", "@_cloud", "@" + "a".repeat(31), "@example.commercialtoolonghandleplus"))
        verify("invalid comment mention $text", !NativeRoomRules.mention.containsMatchIn(text))

    verify("missing cover does not generate a URL", owner.coverPath == null)
    verify("invalid slug cannot generate a cover URL", owner.copy(slug = "../other", coverKey = "cover.jpg").coverPath == null)
    verify("cover path retains authenticated route and version",
        owner.copy(coverKey = "rooms/$roomId/cover/version-123.jpg").coverPath == "/api/room-media/sauti-room/cover?w=960&v=version-123")
    verify("cover key cannot inject query parameters",
        owner.copy(coverKey = "rooms/$roomId/cover/a&token=private.jpg").coverPath?.contains("&token=") == false)

    val media = List(5) { FeedMedia("0000000$it-0000-4000-8000-000000000000", "image", it, 1080, 720) }
    val original = NativeRoomPost(roomId, ownerId, "Author 🌍", "author", "**Text**", "2026-10-15T12:00:00Z",
        true, "standard", 17, 3, 2, 5, media, true)
    val feed = original.asFeedPost()
    verify("post adapter keeps identity", feed.id == original.id && feed.authorId == original.authorId &&
        feed.authorName == original.authorName && feed.authorHandle == original.authorHandle)
    verify("post adapter keeps formatting, time and verification", feed.body == original.body && feed.createdAt == original.createdAt &&
        feed.verified == original.verified && feed.badgeType == original.badgeType && feed.hasAvatar == original.hasAvatar)
    verify("post adapter keeps real counters", feed.likes == 17 && feed.comments == 3 && feed.reposts == 2)
    verify("post adapter keeps fifth media slot", feed.mediaCount == 5 && feed.media == media)
    val settings = owner.copy(category = "learning", privacy = "private", policy = "approval",
        postPermission = "staff_only", invitePermission = "staff_only", postApprovalRequired = true).settings()
    verify("settings projection preserves independent membership/privacy", settings.policy == "approval" && settings.privacy == "private")
    verify("settings projection preserves permissions and approval flag", settings.postPermission == "staff_only" &&
        settings.invitePermission == "staff_only" && settings.postApprovalRequired)
    val pending = NativeRoomPublishResult.Pending(targetId)
    verify("pending has a distinct type from published", (pending as NativeRoomPublishResult) !is NativeRoomPublishResult.Published)
    val submissionMedia = NativeRoomSubmissionMedia(targetId, "image", 0, "Alt text", 1080, 720, 0)
    verify("submission media uses private review route", submissionMedia.path(roomId, ownerId) ==
        "/api/rooms/$roomId/post-submissions/$ownerId/media/$targetId")
    verify("submission media rejects invalid room reference", runCatching { submissionMedia.path("../bad", ownerId) }.isFailure)
    val publishedPath = "/api/sauti-media/$targetId"
    val protectedPath = submissionMedia.path(roomId, ownerId)
    verify("default published media path is unchanged", checkedPostMediaPath(targetId, null) == publishedPath)
    verify("explicit published media path is unchanged", checkedPostMediaPath(targetId, publishedPath) == publishedPath)
    verify("valid pending media path is accepted", checkedPostMediaPath(targetId, protectedPath) == protectedPath)
    for ((label, path) in listOf(
        "external host" to "https://example.com$protectedPath",
        "protocol-relative host" to "//example.com$protectedPath",
        "encoded traversal" to protectedPath.replace("/media/", "/%2e%2e/media/"),
        "literal traversal" to protectedPath.replace("/media/", "/../media/"),
        "query string" to "$protectedPath?token=foreign",
        "fragment" to "$protectedPath#foreign",
        "wrong media ID" to protectedPath.replace(targetId, viewerId),
        "invalid room UUID" to protectedPath.replace(roomId, "not-a-room"),
        "invalid submission UUID" to protectedPath.replace(ownerId, "not-a-submission"),
        "published query string" to "$publishedPath?token=foreign"
    )) verify("protected media path rejects $label", runCatching { checkedPostMediaPath(targetId, path) }.isFailure)
    verify("protected media rejects invalid media UUID", runCatching { checkedPostMediaPath("not-media", protectedPath) }.isFailure)

    if (failures.isNotEmpty()) {
        failures.forEach { System.err.println("FAIL: $it") }
        error("${failures.size} of $checks Room behavior checks failed.")
    }
    println("PASS: $checks Room behavior checks: access/role boundaries, privacy/join policies, settings validation, capability defaults, media/mention rules and lossless post fields.")
}
