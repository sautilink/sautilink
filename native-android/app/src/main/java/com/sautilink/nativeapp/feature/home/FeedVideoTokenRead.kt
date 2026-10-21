package com.sautilink.nativeapp.feature.home

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException

internal class FeedVideoTokenRead {
    internal var generation = 0
    var token by mutableStateOf<String?>(null)
        internal set
    var loading by mutableStateOf(false)
        internal set
    var failure by mutableStateOf<Throwable?>(null)
        internal set
    val canRecover: Boolean get() = failure?.let { followReadRetryDelay(it) != null } == true
}

/** Each explicit attempt runs token acquisition once; it never retries auth POSTs.
 * The attempt key is separate from `started`, which remains true after a failed first play.
 */
@Composable
internal fun rememberFeedVideoTokenRead(scopeKey: Any, accountId: String?, mediaId: String, started: Boolean,
    sessionReady: Boolean, attempt: Int, stillAccount: () -> Boolean,
    fetchToken: suspend () -> String): FeedVideoTokenRead {
    val state = remember(scopeKey, accountId, mediaId) { FeedVideoTokenRead() }
    val freshAccount by rememberUpdatedState(stillAccount)
    val freshFetch by rememberUpdatedState(fetchToken)
    LaunchedEffect(scopeKey, accountId, mediaId, started, sessionReady, attempt) {
        val generation = ++state.generation
        if (!started || !sessionReady || accountId == null || state.token != null) {
            state.loading = false
            return@LaunchedEffect
        }
        state.loading = true
        state.failure = null
        val accountStillMatches = freshAccount
        try {
            val token = freshFetch()
            if (accountStillMatches() && state.generation == generation) state.token = token
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { if (accountStillMatches() && state.generation == generation) state.failure = error }
        finally { if (state.generation == generation) state.loading = false }
    }
    return state
}
