package com.sautilink.nativeapp.feature.home

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.ui.theme.SautiTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException

/** The real production token effect with an injected read: no account, backend or player. */
@RunWith(AndroidJUnit4::class)
class FeedVideoTokenReadTest {
    @get:Rule val compose = createComposeRule()

    @Test fun retryWorksWhenStartedAlreadyTrue_afterFirstTokenFetchFails() {
        var attempt by mutableIntStateOf(0)
        var calls = 0
        compose.setContent { SautiTheme(darkTheme = false) {
            val read = rememberFeedVideoTokenRead("fixture-scope", "fixture-account", "fixture-media", true, true, attempt,
                stillAccount = { true }, fetchToken = {
                    calls++
                    if (calls == 1) throw IOException("Synthetic initial network failure")
                    "fixture-token"
                })
            Column {
                Text(if (read.token != null) "Video ready" else "Awaiting token")
                if (read.failure != null) Button(onClick = { attempt++ }) { Text("Retry token") }
            }
        } }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Retry token").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Retry token").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Video ready").fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { assertEquals(2, calls) }
    }

    @Test fun tokenWaitsForPlaybackAndSignedInSession_andHealthyTokenDoesNotRefetch() {
        var started by mutableStateOf(false)
        var ready by mutableStateOf(false)
        var attempt by mutableIntStateOf(0)
        var calls = 0
        compose.setContent { SautiTheme(darkTheme = true) {
            val read = rememberFeedVideoTokenRead("fixture-scope", "fixture-account", "fixture-media", started, ready, attempt,
                stillAccount = { true }, fetchToken = { calls++; "fixture-token" })
            Text(if (read.token == null) "No token" else "Video ready")
        } }
        compose.runOnIdle { assertEquals(0, calls); started = true }
        compose.runOnIdle { assertEquals(0, calls); ready = true }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Video ready").fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { attempt++ }
        compose.runOnIdle { assertEquals(1, calls) }
    }

    @Test fun accountSwitchDiscardsLateToken_andStartsWithAnEmptyNewScope() {
        var owner by mutableStateOf("first-account")
        val oldResponse = CompletableDeferred<String>()
        var oldState: FeedVideoTokenRead? = null
        compose.setContent { SautiTheme(darkTheme = false) {
            val expected = owner
            val read = rememberFeedVideoTokenRead("fixture-scope", expected, "fixture-media", true, true, 0,
                stillAccount = { owner == expected }, fetchToken = {
                    if (expected == "first-account") withContext(NonCancellable) { oldResponse.await() }
                    else "second-fixture-token"
                })
            if (expected == "first-account") oldState = read
            Text(read.token ?: "No token")
        } }
        compose.runOnIdle { assertNull(oldState?.token); owner = "second-account" }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("second-fixture-token").fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { oldResponse.complete("obsolete-fixture-token") }
        compose.runOnIdle { assertNull("A late previous-account token must be discarded", oldState?.token) }
        compose.onNodeWithText("obsolete-fixture-token").assertDoesNotExist()
    }
}
