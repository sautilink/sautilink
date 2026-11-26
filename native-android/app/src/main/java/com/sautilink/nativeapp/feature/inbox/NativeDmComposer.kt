package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.feature.stickers.*
import com.sautilink.nativeapp.ui.components.sautiActionFeedback
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.theme.sautiChromeInk

@Composable
internal fun NativeDmComposer(draft: String, onChange: (String) -> Unit, sending: Boolean,
    mediaEnabled: Boolean, onAttach: () -> Unit, onCamera: () -> Unit, onVoice: () -> Unit, onSend: () -> Unit) {
    val colors=MaterialTheme.colorScheme
    val ink=sautiChromeInk()
    val dark=colors.surface.luminance()<.5f
    // BasicTextField's String adapter owns IME selection/composition synchronously.
    // An asynchronous copy of draft can overwrite newer keystrokes while typing quickly.
    val caption=stickerCaption(TextFieldValue(draft)).text
    val ready=draft.isNotBlank()
    Column(Modifier.fillMaxWidth().background(colors.surface).imePadding()) {
        NativeStickerDraftPreview(draft,!sending && mediaEnabled,onChange)
        Row(Modifier.fillMaxWidth().padding(horizontal=3.dp,vertical=4.dp),verticalAlignment=Alignment.Bottom) {
            DmComposerAction(Icons.Rounded.Add,"Attach photo, camera or document",!sending && mediaEnabled,onAttach)
            Row(Modifier.weight(1f).heightIn(min=36.dp).background(if(dark) Color(0xFF202C33) else Color.White,RoundedCornerShape(22.dp))
                .border(.6.dp,if(dark) Color(0xFF44525A) else Color(0xFFD0D4D7),RoundedCornerShape(22.dp)),
                verticalAlignment=Alignment.Bottom) {
                BasicTextField(caption,{ next ->
                    onChange(editStickerCaption(draft,TextFieldValue(next),4000).text)
                },modifier=Modifier.weight(1f).heightIn(min=36.dp,max=132.dp).testTag("dm-composer-field")
                    .padding(start=12.dp,top=7.dp,bottom=7.dp),enabled=!sending,
                    textStyle=MaterialTheme.typography.bodyMedium.copy(fontSize=16.sp,lineHeight=21.sp,color=ink),
                    cursorBrush=SolidColor(colors.primary),maxLines=5,
                    keyboardOptions=KeyboardOptions(capitalization=KeyboardCapitalization.Sentences),
                    decorationBox={ input -> Box { if(caption.isEmpty()) Text("Message",color=ink.copy(alpha=.45f),
                        fontSize=16.sp,lineHeight=21.sp); input() } })
                NativeStickerButton(!sending && mediaEnabled,Modifier.size(36.dp),artwork={NativeDmStickerGlyph(ink)}) { token ->
                    val wire=insertNativeSticker(TextFieldValue(draft,TextRange(draft.length)),token,4000)
                    onChange(wire.text)
                }
            }
            if (!ready) DmComposerAction(Icons.Rounded.PhotoCamera,"Open chat camera",!sending && mediaEnabled,onCamera)
            if (ready || sending) {
                val interaction=remember { MutableInteractionSource() }
                Box(Modifier.size(44.dp)
                    .semantics { contentDescription="Send message"; role=Role.Button }
                    .clickable(interactionSource=interaction,indication=null,enabled=ready && !sending && mediaEnabled,onClick=onSend),contentAlignment=Alignment.Center) {
                    Box(Modifier.size(36.dp).background(Color(0xFF0068DF),CircleShape),contentAlignment=Alignment.Center) {
                        if(sending) CircularProgressIndicator(Modifier.size(17.dp),color=Color.White,strokeWidth=2.dp)
                        else Icon(Icons.Rounded.ArrowUpward,null,Modifier.size(24.dp).sautiActionFeedback(interaction),tint=Color.White)
                    }
                }
            } else DmComposerAction(Icons.Rounded.Mic,"Record voice note (max 1 minute)",mediaEnabled,onVoice)
        }
    }
}

@Composable
private fun DmComposerAction(icon: ImageVector,label:String,enabled:Boolean,onClick:()->Unit) {
    val interaction=remember{MutableInteractionSource()}
    IconButton(onClick,enabled=enabled,interactionSource=interaction,modifier=Modifier.size(44.dp)) {
        Icon(icon,label,Modifier.size(27.dp).sautiActionFeedback(interaction),tint=sautiChromeInk())
    }
}

@Composable
internal fun NativeDmStickerGlyph(ink:Color) {
    Canvas(Modifier.size(23.dp).semantics { contentDescription="Stickers and motion emoji" }) {
        val stroke=1.6.dp.toPx()
        val path=Path().apply {
            moveTo(size.width*.53f,size.height*.91f)
            lineTo(size.width*.30f,size.height*.91f)
            quadraticTo(size.width*.08f,size.height*.91f,size.width*.08f,size.height*.69f)
            lineTo(size.width*.08f,size.height*.31f)
            quadraticTo(size.width*.08f,size.height*.09f,size.width*.30f,size.height*.09f)
            lineTo(size.width*.69f,size.height*.09f)
            quadraticTo(size.width*.91f,size.height*.09f,size.width*.91f,size.height*.31f)
            lineTo(size.width*.91f,size.height*.53f)
            quadraticTo(size.width*.91f,size.height*.76f,size.width*.53f,size.height*.91f)
            lineTo(size.width*.57f,size.height*.65f)
            quadraticTo(size.width*.59f,size.height*.57f,size.width*.68f,size.height*.57f)
            lineTo(size.width*.91f,size.height*.53f)
        }
        drawPath(path,ink,style=Stroke(stroke,cap=StrokeCap.Round,join=StrokeJoin.Round))
    }
}
