package com.sautilink.nativeapp.feature.dashboard

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CreatorContentMediaTest {
    private fun id(number: Int) = "00000000-0000-4000-8000-${number.toString().padStart(12, '0')}"
    private fun media(post: Int, number: Int, position: Int, kind: String = "image") = JSONObject()
        .put("post_id", id(post)).put("id", id(number)).put("position", position).put("media_kind", kind)
    @Test fun realFirstAttachedMediaIsSelectedWithoutDependingOnResponseOrder() {
        val rows = JSONArray().put(media(1, 11, 3)).put(media(1, 12, 0, "video"))
            .put(media(2, 21, 1))
        assertEquals(mapOf(id(1) to CreatorPostMedia(id(12), "video"), id(2) to CreatorPostMedia(id(21), "image")),
            creatorContentMedia(rows, setOf(id(1), id(2))))
    }
    @Test fun ForeignRowsAndUnsupportedMalformedMediaCannotBecomeDashboardThumbnails() {
        val rows = JSONArray().put(media(9, 91, 0)).put(media(1, 11, -1))
            .put(media(1, 12, 0, "audio")).put(media(1, 13, 0).put("id", "../private"))
        assertTrue(creatorContentMedia(rows, setOf(id(1))).isEmpty())
    }
}
