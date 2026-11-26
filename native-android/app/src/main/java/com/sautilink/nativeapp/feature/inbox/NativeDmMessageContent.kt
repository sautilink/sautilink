package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.stickers.*
import com.sautilink.nativeapp.ui.components.SautiEntityText
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlin.math.ceil

internal fun dmStandaloneSticker(body: String): Boolean = draftStickerPattern.containsMatchIn(body) && draftStickerPattern.replace(body, "").isBlank()
internal fun dmUsesStickerLayout(body: String): Boolean = draftStickerPattern.containsMatchIn(body)
internal fun dmConversationPreview(body: String): String = stickerSummary(body).replace(Regex("\\s+")," ").trim().ifBlank {"Conversation"}
internal fun dmStartsRightToLeft(body: String): Boolean = !java.text.Bidi(body,java.text.Bidi.DIRECTION_DEFAULT_LEFT_TO_RIGHT).baseIsLeftToRight()
internal fun dmMessageDayKey(timestamp: String, zone: ZoneId = ZoneId.systemDefault()): String = runCatching {
    OffsetDateTime.parse(timestamp).atZoneSameInstant(zone).toLocalDate().toString()
}.getOrDefault(timestamp.take(10))
internal fun dmSameMessageGroup(first: NativeMessage?, second: NativeMessage, zone: ZoneId = ZoneId.systemDefault()): Boolean {
    if (first == null || first.senderId != second.senderId || dmMessageDayKey(first.sentAt,zone) != dmMessageDayKey(second.sentAt,zone)) return false
    return runCatching { java.time.Duration.between(OffsetDateTime.parse(first.sentAt),OffsetDateTime.parse(second.sentAt)).seconds in 0..300 }.getOrDefault(false)
}

@Composable
internal fun NativeDmMessageContent(body: String, own: Boolean, bubbleColor: Color, clock: String,
    sentAt: String, edited: Boolean, receipts: NativePeerReceipts, stickerOnly: Boolean,
    quoteAuthor: String? = null, quoteBody: String = "", onQuote: () -> Unit = {},
    attachment: (@Composable () -> Unit)? = null, quoteThumbnail: (@Composable () -> Unit)? = null,
    modifier: Modifier = Modifier) {
    val ink = dmBubbleInk(bubbleColor)
    val metaInk = ink.copy(alpha = if(ink==Color.White) .88f else .65f)
    val footer: @Composable () -> Unit = {
        Row(Modifier.testTag("dm-message-meta"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(if (edited) "edited $clock" else clock, fontSize = 10.sp, lineHeight = 13.sp, color = metaInk, maxLines = 1)
            if (own) NativeDmReceiptTicks(sentAt, receipts, metaInk)
        }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (quoteAuthor != null) NativeDmReplyQuote(quoteAuthor,quoteBody,
            if(stickerOnly) MaterialTheme.colorScheme.onSurface else ink,onQuote,quoteThumbnail)
        if(attachment != null) CompositionLocalProvider(LocalContentColor provides ink) { attachment() }
        if (stickerOnly) {
            val caption=stickerCaption(androidx.compose.ui.text.input.TextFieldValue(body)).text.trim()
            if(caption.isNotBlank()) Surface(Modifier.align(if(own) Alignment.End else Alignment.Start),
                color=bubbleColor,shape=RoundedCornerShape(12.dp)) {
                SautiEntityText(caption,Modifier.padding(horizontal=10.dp,vertical=7.dp),color=ink,
                    style=MaterialTheme.typography.bodyMedium.copy(fontSize=16.sp,lineHeight=21.sp),linkSocialEntities=false)
            }
            val tokens=draftStickerPattern.findAll(body).joinToString(" "){it.value}
            NativeStickerText(tokens, Modifier.align(if (own) Alignment.End else Alignment.Start), stickerSize = 172.dp, motionSize = 96.dp) { part ->
                if (part.isNotBlank()) Text(part, color = ink, style = MaterialTheme.typography.bodySmall)
            }
            Surface(Modifier.align(Alignment.End), shape = RoundedCornerShape(10.dp), color = bubbleColor.copy(alpha=.93f)) {
                Box(Modifier.padding(horizontal=7.dp,vertical=3.dp)) { footer() }
            }
        } else if (body.isNotBlank() && !hasStickerTokens(body)) {
            NativeDmSmartText(body,ink,footer)
        } else {
            if (body.isNotBlank()) SautiEntityText(body, color=ink, linkSocialEntities=false,
                style=MaterialTheme.typography.bodyMedium.copy(fontSize=16.sp,lineHeight=21.sp))
            Box(Modifier.align(Alignment.End)) { footer() }
        }
    }
}

@Composable
internal fun NativeDmReplyQuote(author: String, body: String, ink: Color, onClick: () -> Unit,
    thumbnail: (@Composable () -> Unit)? = null) {
    val accent = if (ink == Color.White) Color(0xFFB7E0FF) else MaterialTheme.colorScheme.primary
    Row(Modifier.fillMaxWidth().background(ink.copy(alpha=.08f),RoundedCornerShape(7.dp)).clickable(onClick=onClick)
        .height(IntrinsicSize.Min),verticalAlignment=Alignment.CenterVertically) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(accent,RoundedCornerShape(2.dp)))
        Column(Modifier.weight(1f).padding(horizontal=8.dp,vertical=6.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(author,color=accent,fontWeight=FontWeight.SemiBold,fontSize=12.sp,lineHeight=16.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            Text(stickerSummary(body).ifBlank{"Attachment"},color=ink.copy(alpha=.72f),fontSize=12.sp,lineHeight=16.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
        }
        if (thumbnail != null) Box(Modifier.padding(3.dp).size(44.dp)) { thumbnail() }
    }
}

/** The footer shares the final line when it fits; otherwise it gets a reserved line, never overlapping text. */
@Composable
internal fun NativeDmSmartText(body: String, ink: Color, footer: @Composable () -> Unit) {
    val style=MaterialTheme.typography.bodyMedium.copy(fontSize=16.sp,lineHeight=21.sp)
    val measurer=rememberTextMeasurer()
    Layout(content={
        SautiEntityText(body,Modifier.testTag("dm-message-text"),color=ink,style=style,linkSocialEntities=false,
            renderStickers=false)
        Box { footer() }
    }) { children, constraints ->
        val limit=constraints.copy(minWidth=0,minHeight=0)
        val meta=children[1].measure(limit)
        val text=children[0].measure(limit)
        val measured=measurer.measure(body,style,constraints=limit)
        val last=ceil(measured.getLineRight(measured.lineCount-1)).toInt()
        val rtl=dmStartsRightToLeft(body) || measured.getParagraphDirection(measured.getLineStart(measured.lineCount-1).coerceAtMost((body.length-1).coerceAtLeast(0))) == androidx.compose.ui.text.style.ResolvedTextDirection.Rtl
        val gap=7.dp.roundToPx()
        val inline=!rtl && last+gap+meta.width<=constraints.maxWidth
        val width=constraints.constrainWidth(if(inline) maxOf(text.width,last+gap+meta.width) else maxOf(text.width,meta.width))
        val height=constraints.constrainHeight(if(inline) maxOf(text.height,meta.height) else text.height+meta.height)
        layout(width,height) {
            text.place(0,0)
            meta.place(width-meta.width,if(inline) (text.height-meta.height).coerceAtLeast(0) else text.height)
        }
    }
}
