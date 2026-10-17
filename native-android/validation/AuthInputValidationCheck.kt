package com.sautilink.nativeapp.feature.auth

import java.time.LocalDate

/** Compile with AuthInputValidation.kt and run main; uses only existing Kotlin/JDK runtime. */
fun main() {
    val today = LocalDate.of(2026, 10, 15)
    check(signupBirthDateIso("29/02/2000", today) == "2000-02-29")
    check(signupBirthDateIso("29022000", today) == "2000-02-29")
    check(signupBirthDateIso("29/02/1900", today) == null)
    check(signupBirthDateIso("31/04/2000", today) == null)
    check(signupBirthDateIso("16/10/2026", today) == null)
    check(signupBirthDateIso("31/12/1899", today) == null)
    check(signupBirthDateIso("1/2/2000", today) == null)
    check(signupBirthDateIso("2000-02-29", today) == null)
    check(signupBirthDateIso("", today) == null)
    check(signupBirthDateIso("15/10/2026", today) == "2026-10-15")
    check(birthDateDigitsFromIso("2000-02-29") == "29022000")
    check(formattedBirthDate(birthDateDigitsFromIso("2000-02-29")) == "29/02/2000")
    check(formattedBirthDate("1") == "1")
    check(formattedBirthDate("12") == "12/")
    check(formattedBirthDate("1203") == "12/03/")
    check(birthDateDigits("29/02/2000") == "29022000")
    check(birthDateDigits("29022000123") == "29022000")
    for (length in 0..8) {
        val displayLength = formattedBirthDate("12345678".take(length)).length
        for (offset in 0..length) {
            val mapped = birthDateDisplayOffset(offset, length)
            check(mapped in 0..displayLength)
            check(birthDateInputOffset(mapped, length) == offset)
        }
        for (offset in 0..displayLength) check(birthDateInputOffset(offset, length) in 0..length)
    }
    check(normalizeLoginUsername("  @Cloud_Engine ") == "cloud_engine")
    check(validLoginUsername("@cloud_engine"))
    check(!validLoginUsername("x"))
    check(!validLoginUsername("name@example.com"))
    check(!validLoginUsername("bad name"))
    check(validSignupPhone("+1 (202) 555-0123"))
    check(validSignupPhone("+255 712 345 678"))
    check(!validSignupPhone("+255 512 345 678"))
    check(!validSignupPhone(""))
    check(!validSignupPhone("2025550123"))
    val legacy = SignupRequirements(required = true, phoneVerified = false, termsAccepted = true)
    check(legacy.phoneRequired)
    check(legacy.needsSetup(phoneProvided = false))
    val optional = legacy.copy(phoneRequired = false)
    check(!optional.needsSetup(phoneProvided = false))
    check(optional.needsSetup(phoneProvided = true))
    check(optional.copy(termsAccepted = false).needsSetup(phoneProvided = false))
    check(!optional.copy(phoneVerified = true).needsSetup(phoneProvided = true))
    check(!legacy.copy(required = false).needsSetup(phoneProvided = false))
    println("PASS: strict DOB, display/resume/cursor mapping, username/phone inputs and signup admission predicates.")
}
