package com.sautilink.nativeapp.feature.integrity

/** Transport validation and sampling limits only. Nothing here grants or denies app access. */
internal object PlayIntegrityMonitorPolicy {
    const val MODE = "monitor"
    const val FAILURE_INTERVAL_SECONDS = 60L * 60L
    const val SUCCESS_INTERVAL_SECONDS = 6L * 60L * 60L
    const val MAX_INTERVAL_SECONDS = 24L * 60L * 60L
    const val CHALLENGE_TTL_MILLIS = 5L * 60L * 1000L
    const val MAX_TOKEN_CHARACTERS = 30_000
    private val challengeIdPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val requestHashPattern = Regex("^[A-Za-z0-9_-]{43}$")
    private val projectNumberPattern = Regex("^[1-9][0-9]{0,18}$")

    fun challenge(
        mode: String,
        id: String,
        requestHash: String,
        projectNumber: String,
        expiresAtMillis: Long,
        nowMillis: Long
    ): PlayIntegrityChallenge? {
        if (mode != MODE || !challengeIdPattern.matches(id) ||
            !requestHashPattern.matches(requestHash) || !projectNumberPattern.matches(projectNumber)) return null
        val number = projectNumber.toLongOrNull()?.takeIf { it > 0L } ?: return null
        if (!challengeFresh(expiresAtMillis, nowMillis)) return null
        return PlayIntegrityChallenge(id, requestHash, number, expiresAtMillis)
    }

    fun challengeFresh(expiresAtMillis: Long, nowMillis: Long): Boolean =
        nowMillis > 0L && expiresAtMillis > nowMillis &&
            expiresAtMillis - nowMillis in 1L..CHALLENGE_TTL_MILLIS

    fun due(nowMillis: Long, versionCode: Int, recordedVersion: Int,
        scheduledAtMillis: Long, retryAtMillis: Long): Boolean {
        if (nowMillis <= 0L || versionCode <= 0) return false
        if (versionCode != recordedVersion) return true
        // Clock corrections or corrupt timestamps cannot disable observations indefinitely.
        if (scheduledAtMillis <= 0L || nowMillis < scheduledAtMillis ||
            retryAtMillis <= scheduledAtMillis ||
            retryAtMillis - scheduledAtMillis > MAX_INTERVAL_SECONDS * 1000L) return true
        return nowMillis >= retryAtMillis
    }

    fun retryDelayMillis(recorded: Boolean, serverSeconds: Long?): Long {
        val minimum = if (recorded) SUCCESS_INTERVAL_SECONDS else FAILURE_INTERVAL_SECONDS
        return (serverSeconds ?: minimum).coerceIn(minimum, MAX_INTERVAL_SECONDS) * 1000L
    }
}

/** An opaque, one-use server challenge; contains no account identifiers or user content. */
internal class PlayIntegrityChallenge(
    val id: String,
    val requestHash: String,
    val cloudProjectNumber: Long,
    val expiresAtMillis: Long
)
