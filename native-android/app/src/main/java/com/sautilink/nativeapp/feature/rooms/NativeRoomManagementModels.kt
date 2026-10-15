package com.sautilink.nativeapp.feature.rooms

data class NativeRoomManagementCapabilities(val available: Boolean = false)

data class NativeRoomRule(val id: String, val title: String, val body: String = "")
data class NativeRoomQuestion(val id: String, val prompt: String, val required: Boolean = false)
data class NativeRoomMembershipAnswer(val questionId: String, val answer: String)

data class NativeRoomCommunityConfig(
    val roomId: String, val version: Int, val rules: List<NativeRoomRule>,
    val questions: List<NativeRoomQuestion>, val pinLimit: Int = 3
)

data class NativeRoomMembershipResult(
    val roomId: String, val requesterId: String, val status: String,
    val configVersion: Int, val requestId: String
)

data class NativeRoomMembershipAnswers(
    val roomId: String, val requesterId: String, val configVersion: Int,
    val questions: List<NativeRoomQuestion>, val answers: List<NativeRoomMembershipAnswer>,
    val submittedAt: String
)

data class NativeRoomPinnedPost(val postId: String, val pinnedAt: String, val pinnedBy: String?)
data class NativeRoomPinResult(val roomId: String, val postId: String, val pinned: Boolean, val pinnedAt: String?)
data class NativeRoomPostRemoval(val roomId: String, val postId: String, val removedAt: String)
data class NativeRoomPostManagementAccess(val canPin: Boolean = false, val canRemove: Boolean = false)

data class NativeRoomOutgoingInvitation(
    val roomId: String, val invitedUserId: String, val invitedBy: String, val createdAt: String,
    val name: String = "SautiLink member", val handle: String = "", val verified: Boolean = false,
    val badgeType: String = "standard", val hasAvatar: Boolean = false
)

data class NativeRoomOutgoingInvitationPage(val invitations: List<NativeRoomOutgoingInvitation>, val nextOffset: Int?)

object NativeRoomCommunityRules {
    const val MAX_RULES = 10
    const val MAX_QUESTIONS = 3
    const val PIN_LIMIT = 3
    val membershipActions = setOf("join", "request", "accept_invitation")
    val configuredId = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    fun textLength(value: String) = value.codePointCount(0, value.length)

    fun configurationError(rules: List<NativeRoomRule>, questions: List<NativeRoomQuestion>): String? = when {
        rules.size > MAX_RULES -> "Use up to ten Room rules."
        questions.size > MAX_QUESTIONS -> "Use up to three membership questions."
        rules.map { it.id.lowercase() }.distinct().size != rules.size ||
            questions.map { it.id.lowercase() }.distinct().size != questions.size -> "Each rule and question needs a unique ID."
        rules.any { !configuredId.matches(it.id) || textLength(it.title.trim()) !in 1..120 || textLength(it.body) > 1000 } ->
            "Each rule needs a title of 1–120 characters and a description of up to 1,000 characters."
        questions.any { !configuredId.matches(it.id) || textLength(it.prompt.trim()) !in 1..300 } ->
            "Each question needs a prompt of 1–300 characters."
        else -> null
    }

    fun answersError(questions: List<NativeRoomQuestion>, answers: List<NativeRoomMembershipAnswer>): String? {
        val known = questions.map { it.id }.toSet()
        val byQuestion = answers.associateBy { it.questionId }
        return when {
            questions.size > MAX_QUESTIONS || answers.size > MAX_QUESTIONS -> "Use up to three membership answers."
            byQuestion.size != answers.size || answers.any { it.questionId !in known || textLength(it.answer) > 1000 } ->
                "Answers must match the current questions and use up to 1,000 characters each."
            questions.any { it.required && byQuestion[it.id]?.answer.isNullOrBlank() } -> "Answer every required question."
            else -> null
        }
    }

    /** Mirrors the agreed hierarchy; the server still checks current membership on every write. */
    fun postAccess(room: NativeRoom, authorId: String, actorRole: String?, authorRole: String?): NativeRoomPostManagementAccess {
        val staff = actorRole in setOf("owner", "admin", "moderator")
        if (!staff || !NativeRoomRules.uuid.matches(authorId)) return NativeRoomPostManagementAccess()
        val knownTarget = authorRole == null || authorRole in NativeRoomRules.roles
        val removable = knownTarget && when {
            authorId == room.viewerId -> true
            authorId == room.ownerId || authorRole == "owner" -> false
            actorRole == "owner" -> true
            actorRole == "admin" -> authorRole == null || authorRole in setOf("member", "moderator")
            actorRole == "moderator" -> authorRole == null || authorRole == "member"
            else -> false
        }
        return NativeRoomPostManagementAccess(canPin = true, canRemove = removable)
    }
}
