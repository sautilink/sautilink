package com.sautilink.nativeapp.ui.text

import java.util.Locale

enum class TextEntityKind { MENTION, HASHTAG }

/** Offsets are UTF-16 indices, as required by Compose AnnotatedString. */
data class TextEntity(val kind: TextEntityKind, val start: Int, val end: Int, val target: String)

private val profileHandle = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
private val externalUrl = Regex("(?:https?://|www\\.)[^\\s<>\"']+", RegexOption.IGNORE_CASE)
private fun hashtagPart(codePoint: Int) = Character.isLetterOrDigit(codePoint) || codePoint == '_'.code
private fun wordPart(codePoint: Int) = hashtagPart(codePoint) || Character.getType(codePoint) in listOf(
    Character.NON_SPACING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt())
private fun handlePart(char: Char) = char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '_' || char == '.'

/** Only internal entities. Emails, URL fragments and overlong tokens never become partial links. */
fun parseTextEntities(text: String): List<TextEntity> {
    val urls = externalUrl.findAll(text).map { it.range }.toList()
    val result = mutableListOf<TextEntity>()
    var index = 0
    while (index < text.length) {
        val char = text[index]
        if (char != '@' && char != '#') { index++; continue }
        val url = urls.firstOrNull { index in it }
        if (url != null) { index = url.last + 1; continue }
        val previous = if (index == 0) null else text.codePointBefore(index)
        if (previous != null && (wordPart(previous) || previous in listOf('@'.code, '.'.code, '/'.code, '\\'.code))) {
            index++; continue
        }
        var end = index + 1
        if (char == '@') {
            while (end < text.length && handlePart(text[end])) end++
            var visibleEnd = end
            while (visibleEnd > index + 1 && text[visibleEnd - 1] == '.') visibleEnd--
            val handle = text.substring(index + 1, visibleEnd).lowercase(Locale.ROOT)
            val continued = end < text.length && (wordPart(text.codePointAt(end)) || text[end] == '@')
            if (!continued && profileHandle.matches(handle)) {
                result += TextEntity(TextEntityKind.MENTION, index, visibleEnd, handle)
            }
        } else {
            while (end < text.length && hashtagPart(text.codePointAt(end))) end += Character.charCount(text.codePointAt(end))
            val count = text.codePointCount(index + 1, end)
            val continued = end < text.length && (wordPart(text.codePointAt(end)) || text[end] == '@')
            if (!continued && count in 1..64) result += TextEntity(TextEntityKind.HASHTAG, index, end, text.substring(index, end))
        }
        index = maxOf(index + 1, end)
    }
    return result
}

/** Identifier-shaped raw ranges protect underscores before formatting removes any delimiters.
 * Length bounds stay in parseTextEntities: an overlong identifier must remain literal, not shorten
 * into a different valid profile. An outer __ wrapper may close only at the raw token's end.
 */
fun postFormattingEntityRanges(text: String): List<IntRange> {
    val urls = externalUrl.findAll(text).map { it.range }.toList()
    val ranges = mutableListOf<IntRange>()
    var index = 0
    while (index < text.length) {
        val marker = text[index]
        if (marker !in "@#") { index++; continue }
        val url = urls.firstOrNull { index in it }
        if (url != null) { index = url.last + 1; continue }
        var boundary = index
        while (boundary > 0 && text[boundary - 1] == '_') boundary--
        val wrapper = index - boundary >= 2
        val before = if (wrapper) boundary else index
        val previous = if (before == 0) null else text.codePointBefore(before)
        if (previous != null && (wordPart(previous) || previous in listOf('@'.code, '.'.code, '/'.code, '\\'.code))) {
            index++; continue
        }
        var end = index + 1
        if (marker == '@') {
            while (end < text.length && handlePart(text[end])) end++
            while (end > index + 1 && text[end - 1] == '.') end--
            if (end - index >= 4 && text[index + 1].isLetterOrDigit()) ranges += index until end
        } else {
            while (end < text.length && hashtagPart(text.codePointAt(end))) end += Character.charCount(text.codePointAt(end))
            if (end > index + 1) ranges += index until end
        }
        index = maxOf(index + 1, end)
    }
    return ranges
}

fun parseEntityPostFormatting(text: String): List<PostFormatNode> =
    parsePostFormatting(text, protectedEntities = postFormattingEntityRanges(text))

/** Keep a complete 64-code-point hashtag, including its #; ordinary search retains its prior limit. */
fun normalizeExploreQuery(value: String): String {
    val clean = value.trim().replace("%", "").replace("*", "")
    return limitExploreQueryInput(clean)
}

/** Editing must retain spaces, so multiword searches can be typed with a native keyboard. */
fun limitExploreQueryInput(value: String): String {
    val limit = if (value.trimStart().startsWith('#')) 65 else 64
    return if (value.codePointCount(0, value.length) <= limit) value
        else value.substring(0, value.offsetByCodePoints(0, limit))
}

/** PostgREST owns the surrounding * wildcards; user underscores/backslashes remain literal. */
fun exploreLiteralPattern(query: String): String = "*" + query.replace("\\", "\\\\").replace("_", "\\_") + "*"
