package com.sautilink.nativeapp.feature.videos

import com.sautilink.nativeapp.ui.components.*
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class HomeShortsHandoffPolicyTest {
    private val owner="11111111-1111-4111-8111-111111111111"
    private val id="00000000-0000-4000-8000-000000000001"
    private val origin="https://sautilink.com"
    private val now=1_792_540_000_000L
    private val token="header."+Base64.getUrlEncoder().withoutPadding().encodeToString(
        "{\"exp\":${(now+3_600_000)/1000}}".toByteArray())+".signature"
    private fun read(hls:Boolean)=NativePlaybackRead().apply {
        ownerId=owner;bearer=token;resolvedAtMillis=now-1000;sourceAttempt=attempt
        source=if(hls) NativeVideoSource(id,"$origin/api/sauti-media/$id/hls/m_example?c=payload.${"a".repeat(43)}",true,now+300_000)
            else NativeVideoSource(id,"$origin/api/sauti-media/$id",false)
    }
    private fun eligible(value:NativePlaybackRead,account:String=owner,credential:String?=token,time:Long=now)=
        homeShortsReadReusable(value,account,id,origin,credential,time)
    @Test fun liveMp4AndHlsKeepTheirExistingAuthorizationDeadline() {
        assertTrue(eligible(read(false)));assertTrue(eligible(read(true)))
        assertFalse(eligible(read(false),time=now+116_000))
        assertFalse(eligible(read(true),time=now+255_000))
    }
    @Test fun foreignOwnerTokenAndOriginNeverTransfer() {
        val value=read(true)
        assertFalse(eligible(value,account="another-account"))
        assertFalse(eligible(value,credential=null));assertFalse(eligible(value,credential="different-token"))
        assertFalse(homeShortsReadReusable(value,owner,id,"https://test.sautilink.com",token,now))
    }
    @Test fun failedDeniedAndRetriedReadMustUseTheNormalRecoveryPath() {
        assertFalse(eligible(read(true).apply {failure=true}))
        assertFalse(eligible(read(true).apply {denied=true}))
        assertFalse(eligible(read(true).apply {retry()}))
    }
    @Test fun bufferingPreparedMediaTransfersButIdleAndEndedPlayersDoNot() {
        assertTrue(homeShortsPlayerState(androidx.media3.common.Player.STATE_READY))
        assertTrue(homeShortsPlayerState(androidx.media3.common.Player.STATE_BUFFERING))
        assertFalse(homeShortsPlayerState(androidx.media3.common.Player.STATE_IDLE))
        assertFalse(homeShortsPlayerState(androidx.media3.common.Player.STATE_ENDED))
        assertFalse(eligible(NativePlaybackRead()))
    }
    @Test fun pendingTransferExpiresAndCannotSurviveClockRollback() {
        assertTrue(homeShortsTransferWindow(100,100));assertTrue(homeShortsTransferWindow(100,3099))
        assertFalse(homeShortsTransferWindow(100,3100));assertFalse(homeShortsTransferWindow(100,99))
        assertFalse(homeShortsTransferWindow(-1,100))
    }
}
