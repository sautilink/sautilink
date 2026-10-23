package com.sautilink.nativeapp.feature.videos

import android.content.Context
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.NativeShortsPreloading
import com.sautilink.nativeapp.ui.components.NativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.components.NativeVideoReplayBinding
import com.sautilink.nativeapp.ui.components.NativeVideoReplayOwner
import com.sautilink.nativeapp.ui.components.nativeVideoPlaybackResources
import java.io.Closeable

/** One resource/manager/decoder lifetime. The screen remembers this exact tuple
 * by auth owner, account, initial credential and replay owner, never by clip.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class ShortsPlaybackEngine(
    val resources: NativeVideoPlaybackResources,
    val preloading: NativeShortsPreloading,
    val player: ExoPlayer,
) : Closeable {
    override fun close() {
        preloading.close()
        resources.close()
    }
}

/** Keep nullable construction flow outside the screen's large composition.
 * authorizationToken reads the latest remembered bearer on every real request;
 * the initial credential only selects the existing conservative replay scope.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun createShortsPlaybackEngine(
    context: Context,
    auth: StagingAuthClient,
    accountId: String?,
    initialToken: String?,
    replayOwner: NativeVideoReplayOwner?,
    authorizationToken: () -> String?,
    muted: Boolean,
): ShortsPlaybackEngine? {
    if (initialToken == null) return null
    val replay: NativeVideoReplayBinding? = if (accountId != null && replayOwner != null) {
        replayOwner.bindingFor(auth, accountId, initialToken)
    } else null
    val resources: NativeVideoPlaybackResources = nativeVideoPlaybackResources(
        context, auth.mediaOrigin, initialToken, authorizationToken = authorizationToken, replay = replay,
    ) { accountId != null && auth.account?.id == accountId }
    val preloading: NativeShortsPreloading = try {
        NativeShortsPreloading(context, resources)
    } catch (error: Exception) {
        resources.close()
        throw error
    }
    try {
        val player: ExoPlayer = preloading.player
        player.repeatMode = Player.REPEAT_MODE_ONE
        player.volume = if (muted) 0f else 1f
        return ShortsPlaybackEngine(resources, preloading, player)
    } catch (error: Exception) {
        preloading.close()
        resources.close()
        throw error
    }
}
