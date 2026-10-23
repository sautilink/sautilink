package com.sautilink.nativeapp.feature.home

import android.os.SystemClock
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.media3.common.util.UnstableApi
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.*
import kotlinx.coroutines.delay

internal data class FeedVideoHealth(val mediaId: String, val playing: Boolean,
    val bufferedMs: Long, val autoQuality: Boolean, val sampledAt: Long, val manualPaused: Boolean = false)

/** This object belongs to this mounted feed/account/tab/refresh, never a global
 * grant cache. Only player health crosses the local; media bytes use the usual
 * session replay binding, and visible players still resolve their own grants. */
@Stable
internal class FeedVideoLookaheadState {
    var health by mutableStateOf<FeedVideoHealth?>(null)
        private set
    fun report(value: FeedVideoHealth) { health = value }
    fun clear(mediaId: String) { if (health?.mediaId == mediaId) health = null }
}

internal val LocalFeedVideoLookahead = staticCompositionLocalOf<FeedVideoLookaheadState?> { null }

internal fun feedLookaheadAnchor(videoPostIndices: List<Int>, firstVisiblePost: Int): Int =
    videoPostIndices.indexOfLast { it <= firstVisiblePost }

internal fun feedByteWarmupEligible(foreground: Boolean, online: Boolean, autoplay: Boolean,
    saveData: Boolean, metered: Boolean, measuredMbps: Double?, stressed: Boolean,
    visible: FeedVideoHealth?, idleReading: Boolean): Boolean {
    if (visible != null) return shortsPreloadEligible(foreground, online, autoplay,
        visible.playing, visible.bufferedMs, saveData, metered, measuredMbps, stressed, visible.autoQuality)
    return foreground && online && autoplay && idleReading && !saveData && !stressed &&
        (!metered || measuredMbps?.let { it.isFinite() && it >= 3.0 } == true)
}

@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun rememberFeedVideoLookahead(auth: StagingAuthClient, posts: List<StagingFeedPost>,
    listState: LazyListState, scopeKey: Any, enabled: Boolean, online: Boolean): FeedVideoLookaheadState {
    val account = auth.account?.id
    val state = remember(auth, account, scopeKey) { FeedVideoLookaheadState() }
    val reads = remember(auth, account, scopeKey) { linkedMapOf<String, NativePlaybackRead>() }
    val context = LocalContext.current
    val network = rememberNativeVideoNetwork()
    val blocked = LocalNativePlaybackBlocked.current
    val inventory = remember(posts) { posts.mapIndexedNotNull { index, post ->
        post.media.sortedBy { it.position }.firstOrNull { it.kind == "video" }?.let { index to it.id }
    }.distinctBy { it.second } }
    val firstVisiblePost by remember(posts, listState) { derivedStateOf {
        val keys = listState.layoutInfo.visibleItemsInfo.map { it.key }.toSet()
        posts.indexOfFirst { it.id in keys }.coerceAtLeast(0)
    } }
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(enabled, blocked) {
        while (enabled && !blocked) { tick = SystemClock.elapsedRealtime();delay(500L) }
    }
    val visible = state.health?.takeIf { tick - it.sampledAt in 0L..1_250L && inventory.any { item -> item.second == it.mediaId } }
    val current = visible?.let { health -> inventory.indexOfFirst { it.second == health.mediaId } }
        ?: feedLookaheadAnchor(inventory.map { it.first }, firstVisiblePost)
    val indices = videoLookaheadIndices(current, inventory.size)
    val retainedIds = ((current-2).coerceAtLeast(0)..minOf(inventory.lastIndex,current+5))
        .mapNotNull { inventory.getOrNull(it)?.second }.toSet()
    reads.keys.toList().filterNot(retainedIds::contains).forEach(reads::remove)
    val candidates = indices.map { inventory[it].second }
    candidates.forEach { reads.getOrPut(it) { NativePlaybackRead() } }
    val stressed = videoDeviceStressed(context)
    val allowed = enabled && !blocked && account != null && NativePlaybackPreferences.autoplayEnabled
    val metadataAllowed = videoMetadataWarmupEligible(allowed && visible?.manualPaused != true,
        online, true, network.saveData, stressed, false)
    val resolved = rememberVideoLookaheadReads(auth, candidates, reads, metadataAllowed)
    val sources = resolved.mapNotNull { (id, read) -> read.source?.takeIf { it.hls && !read.denied }?.let { source ->
        inventory.indexOfFirst { it.second == id } to source
    } }
    val token = resolved.firstNotNullOfOrNull { it.second.bearer }
    val latestBearer by rememberUpdatedState(token)
    val replayOwner = LocalNativeVideoReplayOwner.current
    val resources = remember(auth, account, scopeKey, token, replayOwner) {
        if (token == null || account == null || replayOwner == null) null
        else nativeVideoPlaybackResources(context, auth.mediaOrigin, token,
            authorizationToken = { latestBearer }, replay = replayOwner.bindingFor(auth,account,token)) {
            auth.account?.id == account
        }
    }
    val loader = remember(resources) {
        resources?.let { runCatching { NativeShortsPreloading(context,it,createPlayer=false) }.getOrNull() }
    }
    DisposableEffect(loader, resources) { onDispose { loader?.close();resources?.close() } }
    var idleSettled by remember(firstVisiblePost, enabled, blocked) { mutableStateOf(false) }
    LaunchedEffect(firstVisiblePost, enabled, blocked) {
        if (enabled && !blocked) { delay(750L);idleSettled=true }
    }
    var continuing by remember(current) { mutableStateOf(false) }
    val runway = visible?.copy(bufferedMs=videoPreloadRunway(visible.bufferedMs,continuing))
    val bytesAllowed = feedByteWarmupEligible(allowed, online, true, network.saveData,
        network.isMetered,network.measuredMbps,stressed,runway,idleSettled && !listState.isScrollInProgress)
    SideEffect { continuing=bytesAllowed }
    LaunchedEffect(loader, sources, current, bytesAllowed, metadataAllowed) {
        sources.forEach { (_, source) -> resources?.hlsGrants?.authorize(source) }
        loader?.warmWindow(current,sources,bytesAllowed,retainPrepared=metadataAllowed)
    }
    return state
}
