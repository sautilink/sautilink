package com.sautilink.nativeapp.ui.text

import java.net.IDN
import java.net.URI
import java.text.Normalizer
import java.util.Locale

enum class TextEntityKind { MENTION, HASHTAG, URL }

/** Offsets are UTF-16 indices, as required by Compose AnnotatedString. */
data class TextEntity(val kind: TextEntityKind, val start: Int, val end: Int, val target: String)

private val profileHandle = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
private val externalUrl = Regex(
    "(?:https?://|www\\.)[^\\s\\p{Z}\\p{Cc}\\p{Cf}<>\"\\u0060]+",
    RegexOption.IGNORE_CASE)
private fun hashtagPart(codePoint: Int) = Character.isLetterOrDigit(codePoint) || codePoint == '_'.code
private fun wordPart(codePoint: Int) = hashtagPart(codePoint) || Character.getType(codePoint) in listOf(
    Character.NON_SPACING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt())
private fun handlePart(char: Char) = char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '_' || char == '.'

/** Keep prose punctuation outside a link, but retain balanced brackets in its path/query. */
private fun trimUrlPunctuation(value: String, closingQuote: Char? = null): String {
    var end = value.length
    var quote = closingQuote
    val brackets = mapOf(')' to '(', ']' to '[', '}' to '{')
    while (end > 0) {
        val last = value[end - 1]
        if (quote != null && last == quote) { end--; quote = null; continue }
        if (last in ".,!?;:\u2026") { end--; continue }
        val opener = brackets[last] ?: break
        val prefix = value.substring(0, end)
        if (prefix.count { it == last } <= prefix.count { it == opener }) break
        end--
    }
    return value.substring(0, end)
}

private fun visibleUrl(text: String, match: MatchResult): String {
    var before = match.range.first - 1
    while (before >= 0 && text[before] in "*_~") before--
    val closingQuote = when (text.getOrNull(before)) {
        '\'' -> '\''
        '\u2018' -> '\u2019'
        '\u201c' -> '\u201d'
        else -> null
    }
    return trimUrlPunctuation(match.value, closingQuote)
}

private fun urlBoundary(text: String, start: Int): Boolean {
    var boundary = start
    while (boundary > 0 && text[boundary - 1] == '_') boundary--
    if (start - boundary < 2) boundary = start
    val previous = if (boundary == 0) null else text.codePointBefore(boundary)
    return previous == null || (!wordPart(previous) &&
        previous !in listOf('@'.code, '#'.code, '.'.code, '/'.code, '\\'.code))
}

/** HTTP(S) only. The displayed text keeps its spelling; the destination uses a valid ASCII URI. */
fun normalizeExternalUrl(value: String): String? {
    if (value.any { it.isWhitespace() || Character.isSpaceChar(it) || it.isISOControl() }) return null
    val candidate = if (value.startsWith("www.", ignoreCase = true)) "https://" + value else value
    return runCatching {
        val parsed = URI(candidate)
        val scheme = parsed.scheme?.lowercase(Locale.ROOT)
        if (scheme !in setOf("http", "https") || parsed.isOpaque) return null
        val authority = parsed.rawAuthority ?: return null
        if (parsed.rawUserInfo != null || '@' in authority) return null
        val asciiAuthority = if (parsed.host != null) authority.lowercase(Locale.ROOT) else {
            // URI does not recognize Unicode hostnames until they have been converted to IDN ASCII.
            if (authority.count { it == ':' } > 1) return null
            val host = authority.substringBefore(':')
            val port = authority.substringAfter(':', "")
            if (':' in authority && (port.isEmpty() || port.any { it !in '0'..'9' })) return null
            val asciiHost = IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES).lowercase(Locale.ROOT)
            // Java's legacy IDNA mappings must never silently change the requested hostname.
            val original = Normalizer.normalize(host.lowercase(Locale.ROOT), Normalizer.Form.NFC)
            val roundTrip = Normalizer.normalize(IDN.toUnicode(asciiHost).lowercase(Locale.ROOT),
                Normalizer.Form.NFC)
            if (original != roundTrip) return null
            asciiHost + if (':' in authority) ":" + port else ""
        }
        val suffix = candidate.substring(candidate.indexOf("://") + 3 + authority.length)
        val normalized = URI(scheme + "://" + asciiAuthority + suffix)
        if (normalized.host.isNullOrBlank() || normalized.port !in -1..65535) return null
        normalized.toASCIIString()
    }.getOrNull()
}

/** Ordered, disjoint links. Emails, URL fragments and overlong handles stay out of internal routes. */
fun parseTextEntities(text: String): List<TextEntity> {
    val candidates = externalUrl.findAll(text).toList()
    val urls = candidates.map { it.range }
    val result = candidates.mapNotNull { match ->
        if (!urlBoundary(text, match.range.first)) return@mapNotNull null
        val visible = visibleUrl(text, match)
        val target = normalizeExternalUrl(visible) ?: return@mapNotNull null
        TextEntity(TextEntityKind.URL, match.range.first, match.range.first + visible.length, target)
    }.toMutableList()
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
    return result.sortedBy { it.start }
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
    parsePostFormatting(text, protectedEntities = postFormattingEntityRanges(text),
        protectedUrls = externalUrl.findAll(text).map {
            it.range.first until it.range.first + visibleUrl(text, it).length
        }.toList())

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
