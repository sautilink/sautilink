package com.sautilink.nativeapp.feature.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class NativeDmModernChatTest {
    @get:Rule val compose=createComposeRule()
    private val sent="2026-11-26T08:00:00Z"
    private val receipts=NativePeerReceipts(sent,sent)

    @Test fun rapidKeyboardEventsDoNotLoseLettersOrResetTheCursor() {
        var wire by mutableStateOf("")
        compose.setContent {SautiTheme(darkTheme=false) {
            NativeDmComposer(wire,{wire=it},false,true,{},{},{},{})
        }}
        val field=compose.onNodeWithTag("dm-composer-field")
        field.performClick()
        val descriptor=InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("input text UI_preview_check")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use {it.readBytes()}
        compose.waitForIdle()
        compose.runOnIdle {assertEquals("UI_preview_check",wire)}
        field.performTextInputSelection(TextRange(2))
        field.performTextInput(" X ")
        compose.runOnIdle {assertEquals("UI X _preview_check",wire)}
    }

    @Test fun standaloneStickerLoadsAtChatSizeWithoutAnOpaqueBubble() {
        var body by mutableStateOf("[[sl-sticker:sl-happy]]")
        compose.setContent { SautiTheme(darkTheme=false) {
            Box(Modifier.width(200.dp).background(Color.Magenta).testTag("sticker-message")) {
                NativeDmMessageContent(body,true,outgoingBubble("blue"),"11:01 AM",sent,false,receipts,true)
            }
        } }
        val node=compose.onNodeWithTag("sticker-message")
        compose.waitUntil(15000) {val bounds=node.getUnclippedBoundsInRoot();bounds.bottom.value-bounds.top.value>180f}
        compose.onAllNodesWithText("[[sl-sticker:sl-happy]]",substring=true).assertCountEquals(0)
        val pixels=node.captureToImage().toPixelMap()
        assertEquals("Sticker art must float over the wallpaper",Color.Magenta.toArgb(),pixels[pixels.width-1,1].toArgb())
        compose.onNodeWithContentDescription("Seen").assertIsDisplayed()
        compose.runOnIdle {body="Safari 😊\n[[sl-sticker:sl-happy]]"}
        compose.onNodeWithText("Safari 😊").assertIsDisplayed()
        val mixed=node.captureToImage().toPixelMap()
        assertEquals(Color.Magenta.toArgb(),mixed[mixed.width-1,1].toArgb())
    }
    @Test fun rightToLeftTextAndTrailingNewlinesReserveTheirOwnFooterSpace() {
        var body by mutableStateOf("مرحبا بك في SautiLink")
        compose.setContent { SautiTheme(darkTheme=false) { Box(Modifier.width(210.dp)) {
            NativeDmMessageContent(body,false,Color.White,"11:01 AM",sent,false,receipts,false)
        } } }
        for(value in listOf("مرحبا بك في SautiLink","Line one\n")) {
            compose.runOnIdle {body=value}
            val text=compose.onNodeWithTag("dm-message-text").fetchSemanticsNode().boundsInRoot
            val meta=compose.onNodeWithTag("dm-message-meta").fetchSemanticsNode().boundsInRoot
            val layouts=mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("dm-message-text").performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
            val last=layouts.single().let {it.getLineRight(it.lineCount-1)}
            assertTrue("Timestamp must follow the last text line without overlap",meta.top>=text.bottom-1 || meta.left>=text.left+last-1)
            if(!value.endsWith("\n")) assertTrue("RTL timestamps get a reserved footer line",meta.top>=text.bottom-1)
        }
    }

    @Test fun shortMessageSharesItsLastLineWithTimeAndModernReadTicks() {
        compose.setContent { SautiTheme(darkTheme=false) {
            NativeDmMessageBubbleSurface(true,"blue",messageWallpaper("system"),Modifier.widthIn(max=280.dp)) {
                NativeDmMessageContent("Hey",true,outgoingBubble("blue"),"11:00 AM",sent,false,receipts,false,modifier=Modifier.padding(10.dp))
            }
        } }
        val text=compose.onNodeWithTag("dm-message-text").fetchSemanticsNode().boundsInRoot
        val meta=compose.onNodeWithTag("dm-message-meta").fetchSemanticsNode().boundsInRoot
        assertTrue("Short-message footer should stay on the same line",meta.top<text.bottom)
        assertTrue("The footer must be after, never over, the text",meta.left>=text.right)
        compose.onNodeWithContentDescription("Seen").assertIsDisplayed()
    }
    @Test fun longMultilineTextAndLargeFontsNeverCollideWithItsTimestamp() {
        compose.setContent { SautiTheme(darkTheme=true) {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,1.6f)) {
                Box(Modifier.width(200.dp)) {
                    NativeDmMessageContent("This is a long message with a link https://sautilink.com/contact and another final line.",false,
                        Color(0xFF1F2C34),"11:00 AM",sent,false,receipts,false)
                }
            }
        } }
        val node=compose.onNodeWithTag("dm-message-text")
        val text=node.fetchSemanticsNode().boundsInRoot
        val meta=compose.onNodeWithTag("dm-message-meta").fetchSemanticsNode().boundsInRoot
        val results=mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(results)}
        val layout=results.single()
        assertTrue(meta.top>=text.bottom-1 || meta.left>=text.left+layout.getLineRight(layout.lineCount-1)-1)
    }
    @Test fun composerIsSlimKeepsStickerAttachmentAndSwitchesCameraAndMicToSend() {
        var wire by mutableStateOf("")
        var sends=0;var cameras=0;var voices=0
        compose.setContent { SautiTheme(darkTheme=false) {
            NativeDmComposer(wire,{wire=it},false,true,{}, {cameras++},{voices++},{sends++})
        } }
        val field=compose.onNodeWithTag("dm-composer-field")
        val bounds=field.getUnclippedBoundsInRoot()
        assertTrue(bounds.bottom.value-bounds.top.value<=40f)
        compose.onNodeWithContentDescription("Open chat camera").assertIsDisplayed()
        compose.onNodeWithContentDescription("Record voice note (max 1 minute)").assertIsDisplayed()
        field.performTextInput("Habari")
        compose.onAllNodesWithContentDescription("Open chat camera").assertCountEquals(0)
        compose.onNodeWithContentDescription("Send message").performClick()
        compose.runOnIdle {assertEquals(1,sends);assertEquals(0,cameras);assertEquals(0,voices)}
        compose.runOnIdle {wire="Habari\n[[sl-sticker:sl-happy]]"}
        field.performTextInputSelection(TextRange(3))
        field.performTextInput(" X ")
        compose.runOnIdle {assertTrue(wire.startsWith("Hab X ari"));assertTrue(wire.endsWith("[[sl-sticker:sl-happy]]"))}
        compose.onAllNodesWithText("[[sl-sticker:sl-happy]]",substring=true).assertCountEquals(0)
    }
    @Test fun replyQuoteAndAllReceiptStatesStayAccessible() {
        var jumps=0
        compose.setContent {SautiTheme(darkTheme=false) {Column {
            NativeDmMessageContent("Nakuja",true,outgoingBubble("blue"),"11:00 AM",sent,false,receipts,false,
                quoteAuthor="Mteja Dar",quoteBody="Uko wapi?",onQuote={jumps++})
            NativeDmReceiptTicks(sent,NativePeerReceipts(null,null),Color.Gray)
            NativeDmReceiptTicks(sent,NativePeerReceipts(sent,null),Color.Gray)
        }}}
        compose.onNodeWithText("Uko wapi?").performClick()
        compose.runOnIdle {assertEquals(1,jumps)}
        listOf("Sent","Delivered","Seen").forEach {compose.onNodeWithContentDescription(it).assertIsDisplayed()}
    }
    @Test fun lightAndDarkChatPreviewUseBrandBlueAndTheProductionComposer() {
        var dark by mutableStateOf(false)
        compose.setContent {SautiTheme(darkTheme=dark) {
            val wallpaper=messageWallpaper("system")
            Column(Modifier.fillMaxSize().background(wallpaper).dmWallpaperDoodles(wallpaper).systemBarsPadding()) {
                Text("SautiLink Messages",Modifier.padding(16.dp),style=MaterialTheme.typography.titleLarge)
                Column(Modifier.weight(1f).padding(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    NativeDmMessageBubbleSurface(false,"blue",wallpaper,Modifier.widthIn(max=260.dp)) {
                        NativeDmMessageContent("Mambo! Uko wapi?",false,incomingMessageBubbleColor(wallpaper,MaterialTheme.colorScheme),"11:00 AM",sent,false,receipts,false,modifier=Modifier.padding(10.dp))
                    }
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
                        NativeDmMessageBubbleSurface(true,"blue",wallpaper,Modifier.widthIn(max=280.dp)) {
                            NativeDmMessageContent("Nakuja sasa 😊",true,outgoingBubble("blue"),"11:01 AM",sent,false,receipts,false,
                                quoteAuthor="You",quoteBody="Tutaonana muda si mrefu.",modifier=Modifier.padding(10.dp))
                        }
                    }
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
                        NativeDmMessageBubbleSurface(true,"blue",wallpaper,Modifier.widthIn(max=280.dp),tail=false) {
                            NativeDmMessageContent("See you soon",true,outgoingBubble("blue"),"11:01 AM",sent,false,receipts,false,modifier=Modifier.padding(10.dp))
                        }
                    }
                }
                NativeDmComposer("",{},false,true,{},{},{},{})
            }
        }}
        savePreview("dm-modern-light")
        compose.runOnIdle {dark=true}
        savePreview("dm-modern-dark")
    }
    private fun savePreview(name:String) {
        compose.waitForIdle()
        val instrument=InstrumentationRegistry.getInstrumentation()
        val file=File(instrument.targetContext.externalCacheDir,"$name.png")
        val bitmap=instrument.uiAutomation.takeScreenshot()
        try {file.outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}} finally {bitmap.recycle()}
    }
}
