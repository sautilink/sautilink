package com.sautilink.nativeapp.feature.inbox

import org.junit.Assert.*
import org.junit.Test

class NativeDmChatPolicyTest {
    private val sent="2026-11-26T08:00:00Z"
    @Test fun mixedArabicAndLatinTextKeepsItsOriginalReadingDirection() {
        assertTrue(dmStartsRightToLeft("مرحبا بك في SautiLink"))
        assertFalse(dmStartsRightToLeft("Habari SautiLink"))
    }
    @Test fun ticksReflectOnlyRecipientConfirmedDeliveryAndReadTimes() {
        assertEquals(NativeDmReceiptState.Sent,dmReceiptState(sent,NativePeerReceipts(null,null)))
        assertEquals(NativeDmReceiptState.Delivered,dmReceiptState(sent,NativePeerReceipts("2026-11-26T08:01:00Z",null)))
        assertEquals(NativeDmReceiptState.Seen,dmReceiptState(sent,NativePeerReceipts(null,"2026-11-26T11:01:00+03:00")))
        assertEquals(NativeDmReceiptState.Sent,dmReceiptState(sent,NativePeerReceipts("2026-11-26T07:59:59Z","2026-11-26T07:59:59Z")))
        assertEquals(NativeDmReceiptState.Sent,dmReceiptState("invalid",NativePeerReceipts(sent,sent)))
    }
    @Test fun standaloneStickersAreSeparatedFromCaptionsWithoutExposingTheWireFormat() {
        assertTrue(dmStandaloneSticker("[[sl-sticker:sl-happy]]"))
        assertTrue(dmStandaloneSticker("\n:slv-love: [[sl-sticker:sl-happy]] "))
        assertFalse(dmStandaloneSticker("Hello [[sl-sticker:sl-happy]]"))
        assertTrue(dmUsesStickerLayout("Hello [[sl-sticker:sl-happy]]"))
        assertTrue(dmUsesStickerLayout("Hello :slv-wave:"))
        assertEquals("Hello Sticker",dmConversationPreview("Hello\n:slv-wave:"))
        assertFalse(dmStandaloneSticker("Hello")); assertFalse(dmStandaloneSticker(""))
    }
    @Test fun dateHeadersAndMessageGroupsUseTheViewersLocalMidnight() {
        val zone=java.time.ZoneId.of("Africa/Dar_es_Salaam")
        val first=NativeMessage("1","alice","Hi","2026-11-26T20:59:00Z",false)
        assertFalse(dmSameMessageGroup(first,first.copy(id="2",sentAt="2026-11-26T21:01:00Z"),zone))
        val beforeUtcMidnight=first.copy(sentAt="2026-11-26T23:59:00Z")
        assertTrue(dmSameMessageGroup(beforeUtcMidnight,first.copy(id="2",sentAt="2026-11-27T00:01:00Z"),zone))
        assertEquals("2026-11-27",dmMessageDayKey(beforeUtcMidnight.sentAt,zone))
    }
    @Test fun consecutiveBubblesGroupOnlyWithinTheSameSenderDayAndFiveMinutes() {
        val first=NativeMessage("1","alice","Hello",sent,false)
        assertTrue(dmSameMessageGroup(first,first.copy(id="2",sentAt="2026-11-26T08:04:59Z")))
        assertFalse(dmSameMessageGroup(first,first.copy(id="2",senderId="bob")))
        assertFalse(dmSameMessageGroup(first,first.copy(id="2",sentAt="2026-11-26T08:05:01Z")))
        assertFalse(dmSameMessageGroup(first,first.copy(id="2",sentAt="2026-11-27T08:00:00Z")))
        assertFalse(dmSameMessageGroup(null,first))
    }
}
