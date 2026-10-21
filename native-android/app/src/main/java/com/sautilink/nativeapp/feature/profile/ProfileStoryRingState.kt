package com.sautilink.nativeapp.feature.profile

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.rememberNetworkAvailable
import com.sautilink.nativeapp.feature.stories.LocalNativeStoryPresence
import com.sautilink.nativeapp.feature.stories.NativeStoriesClient
import com.sautilink.nativeapp.feature.stories.NativeStoryGroup
import com.sautilink.nativeapp.feature.stories.NativeStoryPolicy
import com.sautilink.nativeapp.feature.stories.StoryAvatarRing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.time.Instant

internal data class ProfileStoryRingScope(val accountId: String, val profileId: String, val username: String) {
    companion object {
        fun create(accountId: String?, profile: NativeProfile?): ProfileStoryRingScope? =
            if (accountId != null && NativeStoryPolicy.uuid.matches(accountId) && profile != null &&
                NativeStoryPolicy.uuid.matches(profile.id) && NativeStoryPolicy.handle.matches(profile.username))
                ProfileStoryRingScope(accountId, profile.id, profile.username) else null
    }
}
internal data class ProfileStoryRingTicket(val scope: ProfileStoryRingScope, val revision: Long)
internal data class ProfileStoryRingState(val scope: ProfileStoryRingScope? = null,
    val revision: Long = 0, val expiresAtMillis: Long = 0, val confirmed: Boolean = false) {
    fun begin(next: ProfileStoryRingScope): ProfileStoryRingState = copy(scope = next,
        revision = revision + 1, expiresAtMillis = if (scope == next) expiresAtMillis else 0,
        confirmed = scope == next && confirmed)
    fun ticket(): ProfileStoryRingTicket = ProfileStoryRingTicket(checkNotNull(scope), revision)
    fun complete(ticket: ProfileStoryRingTicket, result: NativeStoryGroup?): ProfileStoryRingState {
        if (scope != ticket.scope || revision != ticket.revision) return this
        val matching = result?.takeIf { it.author.id == ticket.scope.profileId && it.author.username == ticket.scope.username }
        val expiry = matching?.stories.orEmpty().filter { it.ownerId == ticket.scope.profileId }.mapNotNull {
            runCatching { Instant.parse(it.expiresAt).toEpochMilli() }.getOrNull()
        }.maxOrNull() ?: 0
        return copy(expiresAtMillis = expiry, confirmed = true)
    }
    fun activeFor(expected: ProfileStoryRingScope?, nowMillis: Long): Boolean =
        expected != null && scope == expected && expiresAtMillis > nowMillis
    fun visibleFor(expected: ProfileStoryRingScope?, nowMillis: Long, sharedActive: Boolean): Boolean =
        expected != null && (activeFor(expected, nowMillis) ||
            (sharedActive && (scope != expected || !confirmed)))
}

/** Profile lookups cover public authors outside the Home distribution. A known
 * live Home presence supplies an initial hint until this profile's first
 * authoritative response. Confirmed empty responses and expiry always win over
 * a stale Home hint. Profile reads recover on
 * refresh, reconnect, foreground return and a bounded 60-second poll. An old
 * request can neither clear a newer result nor leak across accounts/profiles.
 */
@Composable
internal fun rememberProfileStoryRingActive(auth: StagingAuthClient, profile: NativeProfile?, refreshRevision: Int): Boolean {
    val accountId = auth.account?.id
    val scope = ProfileStoryRingScope.create(accountId, profile)
    val sharedActive = scope != null && scope.username in LocalNativeStoryPresence.current.usernames
    val client = remember(auth) { NativeStoriesClient(auth) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val foreground = lifecycle.isAtLeast(Lifecycle.State.STARTED)
    val online = rememberNetworkAvailable()
    var state by remember(auth, accountId) { mutableStateOf(ProfileStoryRingState()) }
    var clock by remember(scope) { mutableLongStateOf(System.currentTimeMillis()) }
    val currentScope by rememberUpdatedState(scope)
    LaunchedEffect(auth, scope, refreshRevision, foreground, online, sharedActive) {
        if (scope == null) { state = ProfileStoryRingState(); return@LaunchedEffect }
        if (!foreground || !online) return@LaunchedEffect
        while (true) {
            state = state.begin(scope)
            val ticket = state.ticket()
            try {
                val result = client.profile(scope.username)
                if (auth.account?.id == scope.accountId && currentScope == scope) state = state.complete(ticket, result)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                // A transient lookup failure does not erase an already validated,
                // unexpired ring. The next foreground/read cycle tries again.
            }
            delay(60_000)
        }
    }
    LaunchedEffect(scope, state.expiresAtMillis, foreground) {
        clock = System.currentTimeMillis()
        val remaining = state.expiresAtMillis - clock
        if (foreground && remaining > 0) {
            delay(remaining + 1)
            clock = System.currentTimeMillis()
        }
    }
    return state.visibleFor(scope, clock, sharedActive)
}

/** The colored outline must wrap the white Surface. Placing it inside Surface's
 * 3dp border lets that border paint over the entire 2.5dp gradient stroke.
 */
@Composable
internal fun ProfileStoryAvatarFrame(active: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier,
    content: @Composable () -> Unit) {
    StoryAvatarRing(active, onOpen, modifier) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(3.dp, MaterialTheme.colorScheme.surface)) {
            Box { content() }
        }
    }
}
