package com.sautilink.nativeapp.ui.text

const val POST_BODY_LIMIT = 2000

enum class PostTextFormat(val marker: String, val webTag: String, val label: String, val glyph: String) {
    BOLD("**", "strong", "Bold", "B"),
    ITALIC("*", "em", "Italic", "I"),
    UNDERLINE("__", "u", "Underline", "U"),
    STRIKETHROUGH("~~", "s", "Strikethrough", "S")
}

data class PostFormatNode(
    val text: String? = null,
    val format: PostTextFormat? = null,
    val children: List<PostFormatNode> = emptyList()
)

private data class FormatMatch(val format: PostTextFormat, val open: Int, val close: Int)

// Match the existing web grammar in src/post-text-formatting.js, including its
// delimiter order, literal unmatched markers and bounded inline nesting.
private fun nextFormat(source: String, start: Int, protectedEntities: List<IntRange>,
    protectedUrls: List<IntRange>): FormatMatch? {
    var match: FormatMatch? = null
    for (format in listOf(PostTextFormat.BOLD, PostTextFormat.UNDERLINE,
        PostTextFormat.STRIKETHROUGH, PostTextFormat.ITALIC)) {
        var open = source.indexOf(format.marker, start)
        while (open != -1) {
            if (protectedEntities.any { open in it } || protectedUrls.any { open in it }) {
                open = source.indexOf(format.marker, open + 1)
                continue
            }
            if (format == PostTextFormat.ITALIC &&
                ((open > 0 && source[open - 1] == '*') ||
                    (open + 1 < source.length && source[open + 1] == '*'))) {
                open = source.indexOf(format.marker, open + 1)
                continue
            }
            var close = source.indexOf(format.marker, open + format.marker.length)
            while (close != -1 && (protectedEntities.any { close in it &&
                    (it.first != open + format.marker.length || close + format.marker.length != it.last + 1) } ||
                    protectedUrls.any { close in it && close + format.marker.length != it.last + 1 })) {
                // A final marker can close formatting opened outside a URL. Its internal markers stay literal.
                close = source.indexOf(format.marker, close + 1)
            }
            if (close > open + format.marker.length && !source.substring(open, close).contains('\n')) {
                val previous = match
                if (previous == null || open < previous.open ||
                    (open == previous.open && format.marker.length > previous.format.marker.length)) {
                    match = FormatMatch(format, open, close)
                }
                break
            }
            open = source.indexOf(format.marker, open + format.marker.length)
        }
    }
    return match
}

fun parsePostFormatting(source: String, depth: Int = 0,
    protectedEntities: List<IntRange> = emptyList(),
    protectedUrls: List<IntRange> = emptyList()): List<PostFormatNode> {
    if (depth > 4) return listOf(PostFormatNode(text = source))
    val nodes = mutableListOf<PostFormatNode>()
    var cursor = 0
    while (cursor < source.length) {
        val match = nextFormat(source, cursor, protectedEntities, protectedUrls)
        if (match == null) {
            nodes += PostFormatNode(text = source.substring(cursor))
            break
        }
        if (match.open > cursor) nodes += PostFormatNode(text = source.substring(cursor, match.open))
        val innerStart = match.open + match.format.marker.length
        val inner = source.substring(innerStart, match.close)
        val innerProtected = protectedEntities.mapNotNull { range ->
            val start = maxOf(range.first, innerStart)
            val end = minOf(range.last, match.close - 1)
            if (start <= end) (start - innerStart)..(end - innerStart) else null
        }
        val innerUrls = protectedUrls.mapNotNull { range ->
            val start = maxOf(range.first, innerStart)
            val end = minOf(range.last, match.close - 1)
            if (start <= end) (start - innerStart)..(end - innerStart) else null
        }
        nodes += PostFormatNode(format = match.format,
            children = parsePostFormatting(inner, depth + 1, innerProtected, innerUrls))
        cursor = match.close + match.format.marker.length
    }
    return nodes
}

data class PostFormattingInsertion(val text: String, val selectionStart: Int, val selectionEnd: Int)

/** Wrap selected text exactly as the web composer does; marker characters count toward the limit. */
fun insertPostFormatting(text: String, selectionStart: Int, selectionEnd: Int,
    format: PostTextFormat): PostFormattingInsertion? {
    val start = minOf(selectionStart, selectionEnd).coerceIn(0, text.length)
    val end = maxOf(selectionStart, selectionEnd).coerceIn(0, text.length)
    val selection = text.substring(start, end).ifEmpty { "text" }
    val wrapped = format.marker + selection + format.marker
    if (text.length - (end - start) + wrapped.length > POST_BODY_LIMIT) return null
    val result = text.substring(0, start) + wrapped + text.substring(end)
    val innerStart = start + format.marker.length
    return PostFormattingInsertion(result, innerStart, innerStart + selection.length)
}
