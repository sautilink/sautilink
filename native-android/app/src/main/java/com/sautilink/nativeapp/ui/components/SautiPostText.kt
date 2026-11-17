package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import com.sautilink.nativeapp.ui.text.PostFormatNode
import com.sautilink.nativeapp.ui.text.PostTextFormat
import com.sautilink.nativeapp.ui.text.parseEntityPostFormatting
import com.sautilink.nativeapp.ui.text.parseTextEntities
import com.sautilink.nativeapp.ui.text.TextEntityKind
import com.sautilink.nativeapp.ui.theme.SautiColors

/** Supplied by the existing app destinations; previews remain noninteractive without navigation. */
data class SautiTextNavigation(val onProfile: (String) -> Unit, val onHashtag: (String) -> Unit,
    val onUrl: (String) -> Unit)
val LocalSautiTextNavigation = staticCompositionLocalOf<SautiTextNavigation?> { null }

/** Existing post-body markers rendered as safe native spans, with the caller's layout and typography. */
@Composable
fun SautiPostText(text: String, modifier: Modifier = Modifier,
    color: Color = Color.Unspecified, style: TextStyle = LocalTextStyle.current,
    maxLines: Int = Int.MAX_VALUE, overflow: TextOverflow = TextOverflow.Clip,
    linkEntities: Boolean = true, expandedMaxHeight: Dp? = null) {
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
            appendNodes(parseEntityPostFormatting(text), emptySet())
        }
    }
    SautiEntityTextContent(formatted, modifier, color, style, maxLines, overflow,
        linkEntities, linkSocialEntities = true, expandedMaxHeight = expandedMaxHeight)
}

/** Bio/comment text stays literal: formatting markers in these fields are never removed. */
@Composable
fun SautiEntityText(text: String, modifier: Modifier = Modifier,
    color: Color = Color.Unspecified, style: TextStyle = LocalTextStyle.current,
    maxLines: Int = Int.MAX_VALUE, overflow: TextOverflow = TextOverflow.Clip,
    linkSocialEntities: Boolean = true) {
    val literal = remember(text) { buildAnnotatedString { append(text) } }
    SautiEntityTextContent(literal, modifier, color, style, maxLines, overflow,
        linkEntities = true, linkSocialEntities = linkSocialEntities)
}

@Composable
private fun SautiEntityTextContent(formatted: androidx.compose.ui.text.AnnotatedString,
    modifier: Modifier, color: Color, style: TextStyle, maxLines: Int,
    overflow: TextOverflow, linkEntities: Boolean, linkSocialEntities: Boolean, expandedMaxHeight: Dp? = null) {
    val navigation = LocalSautiTextNavigation.current
    val currentNavigation by rememberUpdatedState(navigation)
    val lightTextOnMedia = color != Color.Unspecified && color.luminance() > .7f
    val darkSurface = MaterialTheme.colorScheme.surface.luminance() < .5f
    val entityColor = if (lightTextOnMedia || darkSurface) SautiColors.EntityOrangeDark
        else SautiColors.EntityOrangeLight
    val linked = remember(formatted, linkEntities, linkSocialEntities, navigation != null, entityColor) {
        buildAnnotatedString {
            append(formatted)
            if (linkEntities && navigation != null) parseTextEntities(formatted.text).forEach { entity ->
                if (entity.kind != TextEntityKind.URL && !linkSocialEntities) return@forEach
                addLink(LinkAnnotation.Clickable(
                    tag = "${entity.kind}:${entity.target}",
                    styles = TextLinkStyles(style = SpanStyle(color = entityColor),
                        focusedStyle = SpanStyle(textDecoration = TextDecoration.Underline)),
                    linkInteractionListener = {
                        when (entity.kind) {
                            TextEntityKind.MENTION -> currentNavigation?.onProfile?.invoke(entity.target)
                            TextEntityKind.HASHTAG -> currentNavigation?.onHashtag?.invoke(entity.target)
                            TextEntityKind.URL -> currentNavigation?.onUrl?.invoke(entity.target)
                        }
                    }), entity.start, entity.end)
            }
        }
    }
    if (expandedMaxHeight == null) {
        Text(linked, modifier = modifier, color = color, style = style, maxLines = maxLines, overflow = overflow)
    } else {
        ExpandablePostText(linked, modifier, color, style, maxLines, expandedMaxHeight)
    }
}

@Composable
private fun ExpandablePostText(text: AnnotatedString, modifier: Modifier, color: Color,
    style: TextStyle, lines: Int, expandedMaxHeight: Dp) {
    var expanded by rememberSaveable(text.text) { mutableStateOf(false) }
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier) {
        val size = Constraints(maxWidth = constraints.maxWidth)
        val overflows = remember(text, style, lines, size, measurer) {
            val layout = measurer.measure(text, style, overflow = TextOverflow.Ellipsis, maxLines = lines,
                constraints = size)
            layout.hasVisualOverflow || layout.isLineEllipsized(layout.lineCount - 1)
        }
        if (expanded && overflows) {
            val linked = buildAnnotatedString {
                append(text)
                append(" ")
                val start = length
                append("See less")
                addLink(LinkAnnotation.Clickable(tag = "Collapse caption",
                    styles = TextLinkStyles(style = SpanStyle(fontWeight = FontWeight.SemiBold)),
                    linkInteractionListener = { expanded = false }), start, length)
            }
            Text(linked, Modifier.heightIn(max = expandedMaxHeight).verticalScroll(rememberScrollState()),
                color = color, style = style)
        } else if (overflows) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(text, Modifier.weight(1f), color = color, style = style,
                    maxLines = lines, overflow = TextOverflow.Ellipsis)
                Text("See more", Modifier.clickable(role = Role.Button) { expanded = true }.padding(start = 4.dp),
                    color = color, style = style, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        } else {
            Text(text, color = color, style = style, maxLines = lines)
        }
    }
}
