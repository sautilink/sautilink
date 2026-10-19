package com.sautilink.nativeapp.feature.safety

data class NativeMemberAppeal(
    val id: String, val actionId: String, val reason: String, val status: String,
    val decisionReason: String, val createdAt: String,
)

data class NativeAppealableDecision(
    val id: String, val actionType: String, val targetType: String, val reason: String,
    val policyVersion: String, val createdAt: String, val appeal: NativeMemberAppeal?,
)

internal object NativeAppealRules {
    private val actionId = Regex("^[1-9][0-9]{0,18}$")
    fun validActionId(value: String): Boolean = actionId.matches(value)
    fun reasonError(value: String): String? = when {
        value.trim().isEmpty() -> "Explain why this decision should be reviewed again."
        value.trim().length > 2000 -> "Keep your appeal within 2,000 characters."
        else -> null
    }
    fun decisionLabel(value: String): String = when (value) {
        "visibility_limited" -> "Visibility limited"
        "content_removed" -> "Content removed"
        else -> value.replace('_', ' ').ifBlank { "Moderation decision" }
    }
    fun statusLabel(value: String): String = when (value) {
        "open" -> "Awaiting review"
        "reviewing" -> "Under review"
        "upheld" -> "Upheld"
        "reversed" -> "Reversed"
        else -> "Submitted"
    }
}
