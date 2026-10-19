package com.sautilink.nativeapp.feature.auth

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.ResolverStyle
import java.util.Locale

internal fun normalizeLoginUsername(value: String): String =
    value.trim().trimStart('@').lowercase(Locale.ROOT)

internal fun validLoginUsername(value: String): Boolean =
    Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(normalizeLoginUsername(value))

internal fun normalizedSignupPhone(value: String): String =
    value.trim().replace(Regex("[\\s()\\-]"), "")

internal fun validSignupPhone(value: String): Boolean {
    val phone = normalizedSignupPhone(value)
    if (!Regex("^\\+[1-9][0-9]{7,14}$").matches(phone)) return false
    return !phone.startsWith("+255") || Regex("^\\+255[67][0-9]{8}$").matches(phone)
}

internal fun birthDateDigits(value: String): String = value.filter { it in '0'..'9' }.take(8)

internal fun formattedBirthDate(value: String): String {
    val digits = birthDateDigits(value)
    return buildString {
        digits.forEachIndexed { index, digit ->
            append(digit)
            if (index == 1 || index == 3) append('/')
        }
    }
}

internal fun birthDateDisplayOffset(offset: Int, digitCount: Int): Int =
    offset.coerceIn(0, digitCount) + (if (digitCount >= 2 && offset >= 2) 1 else 0) +
        (if (digitCount >= 4 && offset >= 4) 1 else 0)

internal fun birthDateInputOffset(offset: Int, digitCount: Int): Int =
    (offset - (if (offset > 2) 1 else 0) - (if (offset > 5) 1 else 0)).coerceIn(0, digitCount)

private val birthDateFormat = DateTimeFormatter.ofPattern("dd/MM/uuuu", Locale.ROOT)
    .withResolverStyle(ResolverStyle.STRICT)

/** Date fields display day/month/year; the existing private API still receives ISO dates. */
internal fun signupBirthDateIso(value: String, today: LocalDate = LocalDate.now()): String? {
    val display = if (Regex("^[0-9]{8}$").matches(value)) formattedBirthDate(value) else value.trim()
    if (!Regex("^[0-9]{2}/[0-9]{2}/[0-9]{4}$").matches(display)) return null
    return try {
        LocalDate.parse(display, birthDateFormat)
            .takeIf { it.year >= 1900 && !it.isAfter(today) }?.toString()
    } catch (_: DateTimeParseException) { null }
}

internal fun birthDateDigitsFromIso(value: String): String = try {
    LocalDate.parse(value).format(birthDateFormat).replace("/", "")
} catch (_: DateTimeParseException) { "" }

data class SignupRequirements(
    val required: Boolean,
    val phoneVerified: Boolean,
    val termsAccepted: Boolean,
    // Missing server capability preserves the previously approved phone requirement.
    val phoneRequired: Boolean = true
) {
    fun phoneReady(phoneProvided: Boolean): Boolean = phoneVerified || (!phoneRequired && !phoneProvided)
    fun needsSetup(phoneProvided: Boolean): Boolean =
        required && (!termsAccepted || !phoneReady(phoneProvided))
}
