package com.sautilink.nativeapp.feature.home

/** Main-thread read/write revisions; these are guards, not UI state. */
internal class FeedActionVersions {
    private val versions = mutableMapOf<String, Int>()

    fun snapshot(): Map<String, Int> = versions.toMap()

    fun changed(key: String) {
        versions[key] = (versions[key] ?: 0) + 1
    }

    fun reconcile(kind: String, current: Map<String, Boolean>, loaded: Map<String, Boolean>,
                  atRead: Map<String, Int>): Map<String, Boolean> = current + loaded.filterKeys { id ->
        versions["$kind:$id"] == atRead["$kind:$id"]
    }
}
