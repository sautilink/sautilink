package com.sautilink.nativeapp.feature.auth

/** Explicit separation: staging tokens must never be sent to the production API, or vice versa. */
enum class SautiBackend(val title: String, val id: String, val project: String, val siteOrigin: String) {
    STAGING("Staging", "staging", "bbrydwzlhweuqxpgbahu", "https://test.sautilink.com"),
    PRODUCTION("Production", "production", "rggpyiterdbbugluejcs", "https://sautilink.com");

    val supabaseOrigin: String get() = "https://$project.supabase.co"
    val postgrestOrigin: String get() = "$supabaseOrigin/rest/v1/"
}
