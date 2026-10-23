package com.sautilink.nativeapp.feature.dashboard

import org.json.JSONArray

internal fun creatorContentMedia(rows: JSONArray, postIds: Set<String>): Map<String, CreatorPostMedia> {
    val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
    val selected = mutableMapOf<String, Pair<Int, CreatorPostMedia>>()
    for (index in 0 until rows.length()) {
        val row = rows.optJSONObject(index) ?: continue
        val postId = row.optString("post_id")
        val id = row.optString("id")
        val kind = row.optString("media_kind")
        val position = row.optInt("position", -1)
        if (postId !in postIds || !uuid.matches(id) || kind !in setOf("image", "video") || position < 0) continue
        if (position < (selected[postId]?.first ?: Int.MAX_VALUE)) selected[postId] = position to CreatorPostMedia(id, kind)
    }
    return selected.mapValues { it.value.second }
}
