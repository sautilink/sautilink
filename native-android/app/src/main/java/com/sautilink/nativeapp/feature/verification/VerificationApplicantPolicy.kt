package com.sautilink.nativeapp.feature.verification

import java.net.URI

internal enum class VerificationApplicantType(val wire: String, val label: String) {
    INDIVIDUAL("individual", "Individual / Public figure"),
    BUSINESS("business", "Business / Company"),
    BRAND("brand", "Brand"),
    ENTITY("entity", "Entity / Government"),
    ORGANISATION("organisation", "Organisation / Institution");

    val requiresArticle: Boolean get() = this != INDIVIDUAL
}

internal fun verificationPublicUrl(raw: String, social: Boolean = false): Boolean = runCatching {
    if (raw.isBlank() || raw.length > (if (social) 500 else 1000) || raw.any(Char::isWhitespace)) return@runCatching false
    val uri = URI(raw)
    uri.isAbsolute && uri.scheme?.lowercase() in (if (social) setOf("https") else setOf("https", "http")) &&
        !uri.host.isNullOrBlank() && uri.rawUserInfo == null
}.getOrDefault(false)

internal fun verificationEvidenceError(type: VerificationApplicantType, social: List<String>, articles: List<String>): String? = when {
    articles.size > 5 -> "Add no more than five independent article links."
    articles.any { !verificationPublicUrl(it) } -> "Enter a valid http:// or https:// URL for every article."
    social.any { !verificationPublicUrl(it, social = true) } -> "Enter a valid https:// URL for every social profile."
    type.requiresArticle && articles.isEmpty() -> "Add at least one independent article about this business, brand or entity."
    social.isEmpty() && articles.isEmpty() -> "Add at least one public social profile or independent article."
    else -> null
}
