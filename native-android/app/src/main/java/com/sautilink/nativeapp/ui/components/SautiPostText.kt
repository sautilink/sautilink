package com.sautilink.nativeapp.ui.components

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import com.sautilink.nativeapp.ui.text.PostFormatNode
import com.sautilink.nativeapp.ui.text.PostTextFormat
import com.sautilink.nativeapp.ui.text.parsePostFormatting

/** Existing post-body markers rendered as safe native spans, with the caller's layout and typography. */
@Composable
fun SautiPostText(text: String, modifier: Modifier = Modifier,
    color: Color = Color.Unspecified, style: TextStyle = LocalTextStyle.current,
    maxLines: Int = Int.MAX_VALUE, overflow: TextOverflow = TextOverflow.Clip) {
    val formatted = remember(text) {
        buildAnnotatedString {
            fun appendNodes(nodes: List<PostFormatNode>, inherited: Set<PostTextFormat>) {
                nodes.forEach { node ->
                    val format = node.format
                    if (format != null) appendNodes(node.children, inherited + format)
                    else node.text?.let { value ->
                        val start = length
                        append(value)
                        val decorations = buildList {
                            if (PostTextFormat.UNDERLINE in inherited) add(TextDecoration.Underline)
                            if (PostTextFormat.STRIKETHROUGH in inherited) add(TextDecoration.LineThrough)
                        }
                        if (inherited.isNotEmpty() && value.isNotEmpty()) addStyle(SpanStyle(
                            fontWeight = if (PostTextFormat.BOLD in inherited) FontWeight.Bold else null,
                            fontStyle = if (PostTextFormat.ITALIC in inherited) FontStyle.Italic else null,
                            textDecoration = if (decorations.isEmpty()) null else TextDecoration.combine(decorations)
                        ), start, length)
                    }
                }
            }
            appendNodes(parsePostFormatting(text), emptySet())
        }
    }
    Text(formatted, modifier = modifier, color = color, style = style,
        maxLines = maxLines, overflow = overflow)
}
