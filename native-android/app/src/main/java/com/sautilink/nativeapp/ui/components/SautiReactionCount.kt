package com.sautilink.nativeapp.ui.components

/** Presentation only: keep the exact server count and never round up engagement. */
internal fun sautiReactionCount(value: Int): String? {
    if (value <= 0) return null
    val (scale, suffix) = when {
        value >= 1_000_000_000 -> 1_000_000_000 to "b"
        value >= 1_000_000 -> 1_000_000 to "m"
        value >= 1_000 -> 1_000 to "k"
        else -> return value.toString()
    }
    val tenths = value / (scale / 10)
    val decimal = tenths % 10
    return "${tenths / 10}${if (decimal == 0) "" else ".$decimal"}$suffix"
}

internal fun sautiPostReactionSummary(likes: Int, comments: Int, reposts: Int = 0): String =
    listOfNotNull(
        sautiReactionCount(likes)?.let { "$it ${if (likes == 1) "like" else "likes"}" },
        sautiReactionCount(comments)?.let { "$it ${if (comments == 1) "comment" else "comments"}" },
        sautiReactionCount(reposts)?.let { "$it ${if (reposts == 1) "repost" else "reposts"}" }
    ).joinToString(" · ")
