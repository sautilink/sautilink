package com.sautilink.nativeapp.feature.videos

import androidx.compose.runtime.*
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.PostInteractionsClient
import com.sautilink.nativeapp.feature.home.StagingFeedPost
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

internal enum class ShortsFollowResult { CONFIRMED, FAILED, IGNORED }

/** Ephemeral presentation only: new mounts and explicit refreshes reconcile
 * Follow from the server and never restore a previous "Following" toast state.
 */
@Stable
internal class ShortsAuthorMetadata(
    private val auth: StagingAuthClient,
    private val actions: PostInteractionsClient,
    private val ownerId: String,
    private val stillCurrent: () -> Boolean
) {
    private val follows = mutableStateMapOf<String, ShortsFollowUiState>()
    private val reading = mutableSetOf<String>()
    var ranks by mutableStateOf<Map<String, ShortsTrendingRank>>(emptyMap())
        private set
    var rankingAttempted = false
        private set

    fun followFor(authorId: String): ShortsFollowUiState = follows[authorId] ?: ShortsFollowUiState()
    private fun active(): Boolean = stillCurrent() && auth.account?.id == ownerId

    suspend fun readFollow(authorId: String) = readFollows(listOf(authorId), retry = true)

    /** One bounded read prepares the current author and five upcoming authors.
     * In-flight versions prevent late reads from undoing an explicit Follow. */
    suspend fun readFollows(authorIds: List<String>, retry: Boolean = false) {
        if (!active()) return
        val pending = authorIds.distinct().filter { id ->
            val before = followFor(id)
            id != ownerId && id !in reading && !before.pending &&
                (retry || before.following == null && !before.readFailed)
        }.take(6).associateWith { followFor(it).version }
        if (pending.isEmpty()) return
        reading += pending.keys
        try {
            val result = withTimeout(18_000L) { actions.getFollowingStates(pending.keys.toList()) }
            if (active()) pending.forEach { (id, version) ->
                follows[id] = result[id]?.let { followFor(id).receiveRead(version, it) }
                    ?: followFor(id).failRead(version)
            }
        } catch (_: TimeoutCancellationException) {
            if (active()) pending.forEach { (id, version) -> follows[id] = followFor(id).failRead(version) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            if (active()) pending.forEach { (id, version) -> follows[id] = followFor(id).failRead(version) }
        } finally { reading -= pending.keys }
    }

    /** Exactly one POST follows a user's tap. An uncertain response requires a
     * read before another attempt; a read retry can never replay the mutation.
     */
    suspend fun follow(post: StagingFeedPost): ShortsFollowResult {
        if (!active() || post.authorId == ownerId) return ShortsFollowResult.IGNORED
        val before = followFor(post.authorId)
        if (shortsFollowPresentation(false, before) != ShortsFollowPresentation.FOLLOW) return ShortsFollowResult.IGNORED
        val request = before.beginFollow()
        follows[post.authorId] = request
        try {
            withTimeout(20_000L) { actions.setFollow(post.authorHandle, true) }
            if (!active()) return ShortsFollowResult.IGNORED
            follows[post.authorId] = followFor(post.authorId).confirmFollow(request.version)
            return ShortsFollowResult.CONFIRMED
        } catch (_: TimeoutCancellationException) {
            if (active()) follows[post.authorId] = followFor(post.authorId).failFollow(request.version)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            if (active()) follows[post.authorId] = followFor(post.authorId).failFollow(request.version)
        }
        return if (active()) ShortsFollowResult.FAILED else ShortsFollowResult.IGNORED
    }

    suspend fun readRanks() {
        if (!active() || rankingAttempted) return
        rankingAttempted = true
        try {
            val result = withTimeout(18_000L) { ShortsTrendingRanksClient(auth).load() }
            if (active()) ranks = result
        } catch (cancelled: CancellationException) {
            // Foreground/owner changes may cancel before the optional read ends.
            if (active()) rankingAttempted = false
            throw cancelled
        } catch (_: Exception) { /* No rank is shown when metadata is unavailable. */ }
    }
}

@Composable
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun rememberShortsAuthorMetadata(auth: StagingAuthClient, actions: PostInteractionsClient,
    refreshGeneration: Int, player: ExoPlayer?, foreground: Boolean, online: Boolean,
    currentPost: StagingFeedPost?, currentFrameReady: Boolean, wantsPlayback: Boolean,
    nearbyPosts: List<StagingFeedPost> = listOfNotNull(currentPost)): ShortsAuthorMetadata {
    val ownerId = auth.account?.id
    val requestScope = remember(auth, ownerId, refreshGeneration) {
        ownerId?.let { ShortsAuthorReadScope(it, refreshGeneration) }
    }
    val latestScope = rememberUpdatedState(requestScope)
    val state = remember(auth, ownerId, refreshGeneration) {
        ShortsAuthorMetadata(auth, actions, ownerId.orEmpty()) {
            requestScope != null && latestScope.value == requestScope
        }
    }
    val readScope = rememberCoroutineScope()
    val authorIds = nearbyPosts.map { it.authorId }.distinct().take(6)
    // Independent from first-frame readiness. Scrolling does not cancel a
    // useful pending batch; state still checks the owning account/generation.
    LaunchedEffect(state, authorIds, foreground, online) {
        if (foreground && online) readScope.launch { state.readFollows(authorIds) }
    }
    LaunchedEffect(state, player, foreground, online, currentPost?.id, currentFrameReady) {
        if (player == null || !foreground || !online || ownerId == null || !currentFrameReady || state.rankingAttempted) return@LaunchedEffect
        while (!shortsAuthorRanksEligible(foreground, online, player.isPlaying,
                player.playbackState == Player.STATE_READY, player.totalBufferedDuration)) delay(500L)
        state.readRanks()
    }
    return state
}
