package com.sautilink.nativeapp.ui

import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Bitmap
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.auth.AuthBirthDateField
import com.sautilink.nativeapp.feature.auth.NativeAuthScreen
import com.sautilink.nativeapp.feature.auth.NativeGoogleSignIn
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.runBlocking
import com.sautilink.nativeapp.feature.auth.NativeRecoveryLink
import com.sautilink.nativeapp.feature.auth.NativeRecoveryScreen
import com.sautilink.nativeapp.feature.auth.NativeRegistrationScreen
import com.sautilink.nativeapp.feature.auth.NativeSignInIntro
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.SautiWelcomeContent
import com.sautilink.nativeapp.feature.auth.SautiWelcomeOnboarding
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.notifications.NativePushSound
import com.sautilink.nativeapp.feature.home.commentSheetHeightFraction
import com.sautilink.nativeapp.feature.dashboard.CreatorAnalytics
import com.sautilink.nativeapp.feature.dashboard.CreatorDaily
import com.sautilink.nativeapp.feature.dashboard.CreatorDashboardOverview
import com.sautilink.nativeapp.feature.dashboard.DashboardMetric
import com.sautilink.nativeapp.feature.stories.NativeStoryQuota
import com.sautilink.nativeapp.feature.rooms.RoomInfoTabs
import com.sautilink.nativeapp.feature.rooms.RoomSettingsScreen
import com.sautilink.nativeapp.feature.rooms.RoomSectionHeading
import com.sautilink.nativeapp.feature.rooms.RoomTab
import com.sautilink.nativeapp.feature.rooms.NativeRoom
import com.sautilink.nativeapp.feature.rooms.RoomMessageReference
import com.sautilink.nativeapp.feature.rooms.NativeRoomPost
import com.sautilink.nativeapp.feature.rooms.RoomChatActivity
import com.sautilink.nativeapp.feature.rooms.RoomGroupHeader
import com.sautilink.nativeapp.feature.rooms.RoomInlineComposer
import com.sautilink.nativeapp.feature.rooms.RoomPostCard
import com.sautilink.nativeapp.feature.rooms.RoomPostUi
import com.sautilink.nativeapp.feature.rooms.RoomWallpaper
import com.sautilink.nativeapp.feature.rooms.RoomsState
import com.sautilink.nativeapp.ui.components.SautiBottomBar
import com.sautilink.nativeapp.ui.components.SautiCommentActions
import com.sautilink.nativeapp.ui.components.SautiPostText
import com.sautilink.nativeapp.ui.components.SautiHugeVectors
import com.sautilink.nativeapp.ui.components.SautiIcon
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.LocalDate

/**
 * Real Compose rendering in an empty test host. MainActivity is never started.
 * Auth has an empty account in strictly prefixed fixture preferences in the preview sandbox.
 * No test presses a submit/send button, restores a session, or requests backend data.
 * Screenshots are review artifacts rather than comparisons against unreviewed goldens.
 */
@OptIn(ExperimentalTestApi::class, ExperimentalLayoutApi::class)
@RunWith(AndroidJUnit4::class)
class NativeUiRegressionTest {
    private val noMotion = object : MotionDurationScale { override val scaleFactor = 0f }
    @get:Rule val compose = createComposeRule(effectContext = noMotion)

    private fun signedOutFixture(): StagingAuthClient {
        // Instrumentation executes under the preview UID. Its test-package data directory may
        // not exist, so use a strictly prefixed store in the writable preview app sandbox.
        val storage = object : ContextWrapper(
            InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        ) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                baseContext.getSharedPreferences("native_ui_fixture_$name", mode)
        }
        return StagingAuthClient("sb_publishable_offline_ui_fixture", storage,
            SautiBackend.PRODUCTION).apply { forgetSavedSession() }
    }

    @Composable
    private fun Frame(width: Int = 390, height: Int = 844, fontScale: Float = 1f,
        dark: Boolean = false, onSafeTop: ((Dp) -> Unit)? = null, content: @Composable () -> Unit) {
        val density = LocalDensity.current
        if (onSafeTop != null) {
            val inset = with(density) { WindowInsets.safeDrawing.getTop(density).toDp() }
            SideEffect { onSafeTop(inset) }
        }
        val config = Configuration(LocalConfiguration.current).apply {
            screenWidthDp = width
            screenHeightDp = height
            this.fontScale = fontScale
            orientation = if (width > height) Configuration.ORIENTATION_LANDSCAPE
                else Configuration.ORIENTATION_PORTRAIT
        }
        CompositionLocalProvider(LocalConfiguration provides config,
            LocalDensity provides Density(density.density, fontScale)) {
            SautiTheme(darkTheme = dark) {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                    contentAlignment = Alignment.TopCenter) {
                    Box(Modifier.width(width.dp).fillMaxHeight().testTag("capture")) { content() }
                }
            }
        }
    }

    private fun assertAuthBackBelowSystemBars(readSafeTop: () -> Dp) {
        val back = compose.onNodeWithContentDescription("Back").performScrollTo().assertIsDisplayed()
        val top = back.getUnclippedBoundsInRoot().top
        val safeTop = readSafeTop()
        assertTrue("Back button at $top must start at or below the safe top $safeTop", top >= safeTop)
        assertTrue("Back button must avoid double top spacing (position $top, safe top $safeTop)",
            top <= safeTop + 24.dp)
    }

    private fun screenshot(name: String) {
        // Material press indications are allowed to finish before a review image is exported.
        compose.mainClock.advanceTimeBy(600)
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().context
        val supplied = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = File(supplied ?: (context.externalCacheDir ?: context.cacheDir).absolutePath,
            "sautilink-ui").apply { mkdirs() }
        val output = File(directory, "$name.png")
        output.outputStream().use {
            assertTrue(compose.onNodeWithTag("capture").captureToImage().asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        Log.i("SautiUiScreenshot", output.absolutePath)
    }

    private fun assertReadableDarkText(text: String) {
        val node = compose.onNodeWithText(text).performScrollTo().assertIsDisplayed()
        compose.waitForIdle()
        val pixels = node.captureToImage().toPixelMap()
        var samples = 0
        var readableInk = 0
        for (y in 0 until pixels.height step 2) for (x in 0 until pixels.width step 2) {
            samples++
            if (pixels[x, y].luminance() > .35f) readableInk++
        }
        assertTrue("'$text' needs visible light ink on the dark background; found $readableInk/$samples pixels",
            samples > 0 && readableInk.toFloat() / samples > .02f)
    }

    private fun assertMethodLabelsFit() {
        val methodParent = SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected)
        listOf("Password", "Email code", "Phone code").forEach { label ->
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNode(hasText(label) and hasAnyAncestor(methodParent), useUnmergedTree = true).performScrollTo()
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertTrue("Missing text layout for $label", layouts.isNotEmpty())
            layouts.forEach { layout ->
                val details = "$label size=${layout.size} paragraph=${layout.multiParagraph.width}x${layout.multiParagraph.height} " +
                    "lines=${layout.lineCount} widthOverflow=${layout.didOverflowWidth} heightOverflow=${layout.didOverflowHeight} " +
                    "line0=${layout.getLineLeft(0)}..${layout.getLineRight(0)} bottom=${layout.getLineBottom(0)} " +
                    "ellipsis=${layout.isLineEllipsized(0)} styleLineHeight=${layout.layoutInput.style.lineHeight}"
                Log.i("SautiUiLayout", details)
                assertEquals("$label should remain readable on one line at large text", 1, layout.lineCount)
                assertFalse("$label must not ellipsize: $details", layout.isLineEllipsized(0))
                assertTrue("$label clips its leading edge: $details", layout.getLineLeft(0) >= -1f)
                assertTrue("$label clips its trailing edge: $details", layout.getLineRight(0) <= layout.size.width + 1f)
                assertTrue("$label clips vertically: $details", layout.getLineBottom(0) <= layout.size.height + 1f)
                assertEquals("$label must show every character: $details", label.length, layout.getLineEnd(0, visibleEnd = true))
            }
        }
        compose.onNode(hasText("Password") and hasAnyAncestor(methodParent), useUnmergedTree = true).performScrollTo()
    }

    @Test fun newSignInIntroShowsBrandCopyAndBothAuthChoices() {
        var registrations = 0
        var logins = 0
        compose.setContent {
            Frame(width = 360) {
                NativeSignInIntro(onCreateAccount = { registrations++ }, onLogin = { logins++ })
            }
        }
        compose.onNodeWithContentDescription("SautiLink").assertIsDisplayed()
        listOf("Link it.", "Share.", "Connect").forEach { compose.onNodeWithText(it).assertIsDisplayed() }
        screenshot("sautilink-intro")
        compose.onNodeWithText("Create account").assertIsDisplayed().performClick()
        compose.onNodeWithText("Login").assertIsDisplayed().performClick()
        compose.runOnIdle {
            assertEquals(1, registrations)
            assertEquals(1, logins)
        }
    }

    @Test fun signInIntroKeepsActionsReachableWithVeryLargeText() {
        compose.setContent {
            Frame(width = 320, fontScale = 1.8f) {
                NativeSignInIntro(onCreateAccount = {}, onLogin = {})
            }
        }
        compose.onNodeWithText("Connect").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Create account").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Login").performScrollTo().assertIsDisplayed()
    }

    @Test fun deviceHasSeparateNotificationChannelsAndDecodesBothTones() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(NotificationManager::class.java)
        assertEquals(NativePushSound.MESSAGE, NativePushSound.forType("message"))
        assertEquals(NativePushSound.ACTIVITY, NativePushSound.forType("social"))
        val durations = NativePushSound.entries.map { tone ->
            assertNotNull(manager.getNotificationChannel(tone.channelId))
            MediaPlayer().let { player ->
                try {
                    player.setDataSource(context, tone.uri(context))
                    player.prepare()
                    player.duration
                } finally {
                    player.release()
                }
            }
        }
        assertTrue(durations.all { it in 400..800 })
        assertEquals(2, durations.distinct().size)
    }

    @Test fun signOutConfirmationFollowsLocalSessionClear() = runBlocking {
        val client = signedOutFixture()
        var called = false
        client.signOut {
            assertNull(client.account)
            assertEquals(StagingSessionState.SIGNED_OUT, client.sessionState)
            called = true
        }
        assertTrue(called)
    }

    @Test fun welcomeNotificationPreviewShowsExamplesAndForwardsActions() {
        var enableClicks = 0
        var closeClicks = 0
        var syncing by mutableStateOf(false)
        compose.setContent { Frame(dark = true) {
            SautiWelcomeContent(complete = false, note = null, syncing = syncing,
                onEnable = { enableClicks++; syncing = true },
                onLater = {}, onComplete = { closeClicks++ })
        } }

        compose.onNodeWithText("Never miss a moment").assertIsDisplayed()
        compose.onNodeWithText("Notification preview").assertIsDisplayed()
        compose.onNodeWithText("New message").assertIsDisplayed()
        compose.onNodeWithText("New follower").assertIsDisplayed()
        screenshot("welcome-notifications-dark")
        compose.onNodeWithText("Enable notifications").performScrollTo().performClick()
        compose.onNodeWithText("Enabling notifications").assertIsNotEnabled()
        compose.onNodeWithText("Not now").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Skip welcome steps").assertIsNotEnabled()
        compose.runOnIdle {
            assertEquals(1, enableClicks)
            syncing = false
        }
        compose.onNodeWithContentDescription("Skip welcome steps").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, closeClicks) }
    }

    @Test fun welcomeNotificationsCanBeSkippedOnShortScreenWithLargeText() {
        val client = signedOutFixture()
        var completed = 0
        compose.setContent { Frame(width = 320, fontScale = 1.6f) {
            Box(Modifier.height(515.dp)) {
                SautiWelcomeOnboarding(client, onComplete = { completed++ })
            }
        } }

        compose.onNodeWithText("Never miss a moment").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Not now").performScrollTo().performClick()
        compose.onNodeWithText("You're all set").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Notifications are optional. You can enable them later in Settings.")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Enable notifications").assertDoesNotExist()
        compose.onNodeWithText("Go to SautiLink").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, completed) }
    }

    @Test fun realLogin_light390_keepsAllMethodsAndNavigation() {
        val client = signedOutFixture()
        var registrations = 0
        var recoveries = 0
        var googleStarts = 0
        var safeTop = 0.dp
        compose.setContent { Frame(onSafeTop = { safeTop = it }) {
            NativeAuthScreen(client, {}, {}, onRegister = { registrations++ },
                onRecovery = { recoveries++ }, onGoogle = { googleStarts++ })
        } }
        assertAuthBackBelowSystemBars { safeTop }
        compose.onNodeWithText("Login").assertIsDisplayed().assertIsSelected()
        compose.onNode(hasText("Sign in") and hasClickAction()).assertIsNotEnabled()
        val loginName = compose.onNode(hasSetTextAction() and hasText("Email or username")).assertExists()
        compose.onNodeWithText("Phone code").assertIsDisplayed()
        screenshot("login-light-390")
        loginName.performTextInput("design_preview")
        compose.onNode(hasSetTextAction() and hasText("Password")).performTextInput("PreviewOnly72!")
        compose.onNode(hasText("Sign in") and hasClickAction()).assertIsEnabled()
        compose.onNodeWithContentDescription("Show password").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Hide password").assertExists()
        compose.onNodeWithText("Email code").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Email address")).assertExists()
        compose.onNodeWithText("Phone code").performClick()
        compose.onNode(hasSetTextAction() and hasText("Phone (+255...)")).assertExists()
        compose.onNode(hasText("Send code") and hasClickAction()).assertIsNotEnabled()
        compose.onNodeWithText("Password").performScrollTo().performClick()
        compose.onNodeWithText("Forgot password?").performScrollTo().performClick()
        compose.onNodeWithText("Continue with Google").performScrollTo().performClick()
        compose.onNodeWithText("Signup").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(1, recoveries)
            assertEquals(1, registrations)
            assertEquals(1, googleStarts)
        }
    }

    @Test fun realLogin_dark320_largeText_remainsScrollable() {
        val client = signedOutFixture()
        compose.setContent { Frame(width = 320, fontScale = 1.5f, dark = true) {
            NativeAuthScreen(client, {}, {}, onRegister = {}, onRecovery = {}, isEntry = true,
                onGoogle = {})
        } }
        compose.onNodeWithText("Login").assertIsDisplayed().assertIsSelected()
        assertReadableDarkText("Login")
        screenshot("login-dark-320-font150-before-label-check")
        assertMethodLabelsFit()
        screenshot("login-dark-320-font150-top")
        compose.onNodeWithText("Signup").performScrollTo().assertIsDisplayed()
        screenshot("login-dark-320-font150-actions")
        val google = compose.onNodeWithText("Continue with Google").performScrollTo().assertIsDisplayed()
        val pixels = google.captureToImage().toPixelMap()
        val background = pixels[pixels.width / 18, pixels.height / 2]
        assertTrue("Google keeps its white background in dark mode", background.luminance() > .93f)
        screenshot("login-dark-google")
        compose.onNodeWithText("Phone code").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Phone (+255...)")).performScrollTo().assertIsDisplayed()
    }

    @Test fun realRegistration_light390_fieldsAndExistingCodeFlowRemain() {
        val client = signedOutFixture()
        var loginTabClicks = 0
        var googleStarts = 0
        var safeTop = 0.dp
        compose.setContent { Frame(onSafeTop = { safeTop = it }) {
            NativeRegistrationScreen(client, {}, {}, onLogin = { loginTabClicks++ }, onGoogle = { googleStarts++ })
        } }
        assertAuthBackBelowSystemBars { safeTop }
        compose.onNodeWithText("Signup").assertIsDisplayed().assertIsSelected()
        screenshot("signup-light-390-top")
        compose.onNodeWithText("Login").performClick()
        compose.onNodeWithText("Continue with Google").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, loginTabClicks); assertEquals(1, googleStarts) }
        compose.onNode(hasSetTextAction() and hasText("Username")).assertExists()
        compose.onNodeWithContentDescription("Choose date of birth").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Show confirm password").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Hide confirm password").assertExists()
        compose.onNodeWithText("Already have a signup email code?").performScrollTo().performClick()
        assertAuthBackBelowSystemBars { safeTop }
        compose.onNodeWithText("Create account").assertIsDisplayed()
        assertTrue(compose.onNodeWithText("Create account").getUnclippedBoundsInRoot().top >= safeTop)
        compose.onNodeWithText("2 of 4 · Verify email").performScrollTo().assertIsDisplayed()
        compose.onNode(hasSetTextAction() and hasText("8-digit email code")).assertExists()
        screenshot("signup-email-code-light-390")
    }

    @Test fun googleSignInBindsBrowserResultToThisAttempt() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val storage = object : ContextWrapper(context) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                baseContext.getSharedPreferences("native_google_fixture_$name", mode)
        }
        val google = NativeGoogleSignIn(storage)
        val auth = signedOutFixture()
        val authorize = requireNotNull(google.startIntent().data)
        assertEquals("rggpyiterdbbugluejcs.supabase.co", authorize.host)
        assertEquals("google", authorize.getQueryParameter("provider"))
        assertEquals("s256", authorize.getQueryParameter("code_challenge_method"))
        assertEquals(43, authorize.getQueryParameter("code_challenge")?.length)
        val redirect = Uri.parse(authorize.getQueryParameter("redirect_to"))
        val callback = redirect.buildUpon().appendQueryParameter("error", "access_denied").build()
        assertEquals(callback, NativeGoogleSignIn.callbackFrom(Intent(Intent.ACTION_VIEW, callback)))
        assertNull(NativeGoogleSignIn.callbackFrom(Intent(Intent.ACTION_VIEW,
            callback.buildUpon().authority("sautilink.com.evil.example").build())))
        assertFalse(google.finish(Uri.parse("https://sautilink.com/home?native_auth=" +
            "x".repeat(43) + "&error=access_denied"), auth))
        val cancelled = runCatching { google.finish(callback, auth) }.exceptionOrNull()
        assertTrue(cancelled is AuthRequestException)
        assertFalse(google.finish(callback, auth))
    }

    @Test fun realRecovery_dark320_largeText_keepsDisabledEmptySubmit() {
        val client = signedOutFixture()
        compose.setContent { Frame(width = 320, fontScale = 1.5f, dark = true) {
            NativeRecoveryScreen(client,
                recoveryNotice = "This recovery link is invalid or expired. Enter your email to request a new one.",
                onBack = {})
        } }
        assertReadableDarkText("Recover your account")
        compose.onNodeWithText("This recovery link is invalid or expired.", substring = true)
            .performScrollTo().assertIsDisplayed()
        val email = compose.onNode(hasSetTextAction() and hasText("Email address")).performScrollTo().assertIsDisplayed()
        val send = compose.onNodeWithText("Send recovery link").performScrollTo().assertIsNotEnabled()
        email.performTextInput("invalid")
        send.assertIsNotEnabled()
        email.performTextReplacement("recovery-preview@example.invalid")
        send.assertIsEnabled()
        compose.onNodeWithText("Forgot email?").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Protect your account").performScrollTo().assertIsDisplayed()
    }

    @Test fun recoveryOpensOfficialContactPageAndHandlesBrowserFailure() {
        val client = signedOutFixture()
        var contact: Intent? = null
        var canOpenPage = true
        var backClicks = 0
        var safeTop = 0.dp
        compose.setContent { Frame(dark = true, onSafeTop = { safeTop = it }) {
            val host = LocalContext.current
            val intercepted = remember(host) {
                object : ContextWrapper(host) {
                    override fun startActivity(intent: Intent) {
                        if (!canOpenPage) throw ActivityNotFoundException()
                        contact = intent
                    }
                }
            }
            CompositionLocalProvider(LocalContext provides intercepted) {
                NativeRecoveryScreen(client) { backClicks++ }
            }
        } }
        assertAuthBackBelowSystemBars { safeTop }
        compose.onNodeWithText("Forgot email?").assertIsDisplayed()
        compose.onNodeWithText("SautiLink support agents will never ask", substring = true).assertIsDisplayed()
        screenshot("recovery-dark-390")
        compose.onNodeWithText("Contact Support").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals("com.sautilink.nativeapp.feature.browser.NativeWebBrowserActivity",
                contact?.component?.className)
            assertEquals("https://sautilink.com/contact", contact?.getStringExtra("web_browser_url"))
            canOpenPage = false
        }
        compose.onNodeWithText("Contact Support").performClick()
        compose.onNodeWithText("Could not open the support page. Please try again.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, backClicks) }
    }

    @Test fun recoveryCallbackKeepsCredentialsInFragmentAndRejectsSpoofedOrExpiredLinks() {
        val origin = "https://sautilink.com/home"
        val credentials = "access_token=abc.def.ghi&refresh_token=fixture-refresh&type=recovery&expires_in=3600"
        val uri = Uri.parse("$origin?auth_action=recovery&next=https%3A%2F%2Fevil.example#$credentials")
        val result = NativeRecoveryLink.from(Intent(Intent.ACTION_VIEW, uri))?.browserUrl
        assertNotNull(result)
        assertEquals("auth_action=recovery", result?.encodedQuery)
        assertTrue(result?.encodedFragment.orEmpty().contains("access_token=abc.def.ghi"))
        assertTrue(result?.encodedFragment.orEmpty().contains("refresh_token=fixture-refresh"))
        assertFalse(result.toString().contains("evil.example"))
        assertEquals(result, NativeRecoveryLink.parse(requireNotNull(result))?.browserUrl)
        assertNull(NativeRecoveryLink.parse(Uri.parse("https://sautilink.com.evil.example/home?auth_action=recovery#$credentials")))
        assertNull(NativeRecoveryLink.parse(Uri.parse("https://sautilink.com@evil.example/home?auth_action=recovery#$credentials")))
        assertNull(NativeRecoveryLink.parse(Uri.parse("$origin?native_auth=fixture&code=google")))
        assertNull(NativeRecoveryLink.parse(Uri.parse("$origin?auth_action=recovery&error_code=otp_expired"))?.browserUrl)
        assertNotNull(NativeRecoveryLink.parse(Uri.parse("$origin?auth_action=recovery")))
        assertNull(NativeRecoveryLink.parse(Uri.parse("$origin?auth_action=recovery#type=recovery&access_token=abc.def.ghi"))?.browserUrl)
        assertNotNull(NativeRecoveryLink.parse(Uri.parse("$origin?type=recovery&token_hash=fixture-hash"))?.browserUrl)
    }

    @Test fun datePicker_returnsExistingDigitsWithoutChangingAuthFormat() {
        var value by mutableStateOf("01011995")
        compose.setContent { Frame {
            Column(Modifier.padding(20.dp)) {
                AuthBirthDateField(value, { value = it }, Modifier.fillMaxWidth())
            }
        } }
        compose.onNodeWithContentDescription("Choose date of birth").performClick()
        compose.onNodeWithText("Use date").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("01011995", value) }
    }

    @Test fun nativeRoomTabs_320_largeText_showLabelsAndPreserveSelection() {
        var selected by mutableStateOf(RoomTab.ABOUT)
        compose.setContent { Frame(width = 320, fontScale = 1.5f) {
            Column(Modifier.fillMaxWidth().padding(10.dp)) {
                RoomInfoTabs(selected, { selected = it }, members = true, media = true)
            }
        } }
        compose.onNodeWithText("Overview").assertIsSelected()
        compose.onNodeWithText("Members").assertIsNotSelected().performClick()
        compose.onNodeWithText("Members").assertIsSelected().assertIsDisplayed()
        compose.onNodeWithText("Overview").assertIsDisplayed()
        compose.onNodeWithText("Media").assertIsDisplayed()
        compose.onNodeWithText("Links").assertIsDisplayed()
        screenshot("room-tabs-light-320-font150")
    }

    @Test fun groupChatShowsAvatarsAndKeepsAttachmentsAndReplyInsideConversation() {
        val auth = signedOutFixture()
        val room = NativeRoom("room-fixture", "author-fixture", "mwanza-tech", "Mwanza Tech",
            "A local group for learning and sharing", "open", "member", null, memberCount = 32)
        val incoming = NativeRoomPost("post-1", "author-fixture", "Amina", "amina",
            "Tukutane Jumamosi saa nne kujadili mradi wetu.", "2026-11-16T11:30:00Z", false, "standard")
        val outgoing = incoming.copy(id = "post-2", authorId = "viewer-fixture", authorName = "Neema", authorHandle = "neema",
            body = "Sawa, nitakuja na mifano ya kujaribu.",
            reply = RoomMessageReference(incoming.id, incoming.authorName, "Tukutane Jumamosi…"))
        var reply by mutableStateOf<NativeRoomPost?>(null)
        var jumpedTo: String? = null
        var activity by mutableStateOf(RoomChatActivity(onlineCount = 4))
        compose.setContent { Frame(width = 390) {
            val scope = rememberCoroutineScope()
            val context = androidx.compose.ui.platform.LocalContext.current
            val state = remember { RoomsState(auth, null, context, scope) }
            DisposableEffect(state) { onDispose { state.dispose() } }
            Column(Modifier.fillMaxSize()) {
                RoomGroupHeader(auth, room, activity.label(room.memberCount), {}, {}, {}, {}, {})
                Box(Modifier.weight(1f)) {
                    RoomWallpaper()
                    Column(Modifier.align(Alignment.BottomCenter).padding(10.dp)) {
                        for (post in listOf(incoming, outgoing)) {
                            RoomPostCard(auth, post, RoomPostUi(liked = false),
                                own = post == outgoing, grouped = false,
                                onOpenProfile = {}, onLike = {}, onRetry = {},
                                onReply = { reply = post }, onJumpToReply = { jumpedTo = it })
                        }
                    }
                }
                RoomInlineComposer(room, state, replyTo = reply, onCloseReply = { reply = null }, onSent = {})
            }
        } }
        compose.onNodeWithText("32 members, 4 online").assertIsDisplayed()
        compose.runOnIdle { activity = activity.copy(typingCount = 1) }
        compose.onNodeWithText("Someone is typing…").assertIsDisplayed()
        compose.onNodeWithContentDescription("Amina avatar").assertIsDisplayed()
        compose.onNodeWithContentDescription("Neema avatar").assertIsDisplayed()
        val quote = compose.onNodeWithText("Tukutane Jumamosi…")
        quote.assertIsDisplayed().performClick()
        compose.runOnIdle { check(jumpedTo == incoming.id) }
        screenshot("sautilink-room-conversation")
        compose.onNodeWithContentDescription("Add attachment").performClick()
        for (option in listOf("Photos", "Videos", "Browse files")) compose.onNodeWithText(option).assertIsDisplayed()
        compose.onNodeWithText("Message").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close attachments").performClick()
        compose.onNodeWithContentDescription("Send message").assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput("Hii ni draft ya majaribio.")
        compose.onNodeWithContentDescription("Send message").assertIsEnabled()
        compose.onNodeWithText(incoming.body).performTouchInput { longClick() }
        compose.onNodeWithText("Repost").assertDoesNotExist()
        compose.onNodeWithText("View replies").assertDoesNotExist()
        compose.onNodeWithText("Reply").assertIsDisplayed().performClick()
        compose.onNodeWithText("Reply to Amina").assertIsDisplayed()
        compose.onNodeWithContentDescription("Add attachment").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send reply").assertIsEnabled()
        compose.onNodeWithContentDescription("Cancel reply").performClick()
        compose.onNodeWithContentDescription("Send message").assertIsEnabled()
    }

    @Test fun groupEditSavesPrivacyAndKeepsPrivateVisibilityLocked() {
        val auth = signedOutFixture()
        val room = NativeRoom("room-fixture", "owner-fixture", "mwanza-tech", "Mwanza Tech",
            "Group for sharing technology", "private", "owner", null, privacy = "private",
            postApprovalRequired = true, memberPrivacyAvailable = true)
        var savedProfile: com.sautilink.nativeapp.feature.rooms.NativeRoomSettings? = null
        compose.setContent { Frame(width = 390) {
            RoomSettingsScreen(auth, "owner-fixture", room, busy = false, error = null, onDismiss = {}) { _, value, _ ->
                savedProfile = value
            }
        } }
        compose.onNodeWithText("Edit group").assertIsDisplayed()
        compose.onNodeWithText("Set group photo").assertIsDisplayed()
        compose.onNodeWithText("Review member posts").assertDoesNotExist()
        compose.onNodeWithText("Private").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithContentDescription("Hide members").performScrollTo().assertIsOff()
            .performClick().assertIsOn()
        compose.onNodeWithText("All messages").performScrollTo().performClick()
        compose.onNodeWithText("Messages sent after joining").performClick()
        compose.onNodeWithText("Save").performClick()
        compose.runOnIdle {
            check(savedProfile?.name == room.name)
            check(savedProfile?.postApprovalRequired == false)
            check(savedProfile?.privacy == "private")
            check(savedProfile?.hideMembers == true)
            check(savedProfile?.showHistoryToNewMembers == false)
        }
    }

    @Test fun creatorDashboardRendersReferenceLayoutAndFiltersActualPeriodValues() {
        val today = LocalDate.of(2026, 11, 17)
        val data = CreatorAnalytics(listOf(
            CreatorDaily(today, 321, 7, 9, 2, 6),
            CreatorDaily(today.minusDays(1), 988, 3, 21, 2, 25),
        ), emptyList(), weeklyPosts = 5)
        var window by mutableIntStateOf(28)
        var opened: DashboardMetric? = null
        var earningsOpened = false
        compose.setContent { Frame(width = 390, dark = true) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                CreatorDashboardOverview(data, true, NativeStoryQuota(2, 1, "fixture"), window, today,
                    onWindow = { window = it }, onMetric = { opened = it }, onEarnings = { earningsOpened = true })
            }
        } }
        compose.onNodeWithText("5/7").assertIsDisplayed()
        compose.onNodeWithText("3/6").assertIsDisplayed()
        compose.onNodeWithText("Approximate earnings").assertIsDisplayed().performClick()
        compose.onNodeWithText("Coming soon").assertIsDisplayed()
        compose.onNodeWithText("28 days").assertIsSelected()
        compose.onNodeWithText("Today").performClick().assertIsSelected()
        compose.onNodeWithText("321").assertIsDisplayed()
        compose.onNodeWithText("Views").performClick()
        compose.runOnIdle {
            check(opened == DashboardMetric.VIEWS)
            check(earningsOpened)
        }
        screenshot("creator-dashboard-dark")
    }

    @Test fun glassNavigationRetainsSixDestinationsAndUnreadCount() {
        var selected by mutableIntStateOf(0)
        compose.setContent { Frame(width = 320, dark = true) {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.align(Alignment.BottomCenter)) {
                    SautiBottomBar(selected, unreadNotifications = 40) { selected = it }
                }
            }
        } }
        compose.onNodeWithContentDescription("Home").assertIsSelected()
            .assertHeightIsEqualTo(54.dp).assertWidthIsAtLeast(48.dp)
        for (label in listOf("Explore", "Messages", "Notifications, 40 unread", "Short Videos", "Profile")) {
            compose.onNodeWithContentDescription(label).assertIsNotSelected().performClick().assertIsSelected()
        }
        compose.onNodeWithText("40").assertIsDisplayed()
    }

    @Test fun allLicensedVectors_parseAndRenderWithMotionDisabled() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets
            .open("source.json").bufferedReader().use { JSONObject(it.readText()) }
        val names = fixture.getJSONObject("definitions").keys().asSequence().toList().sorted()
        assertEquals("Cover every licensed source definition", 85, names.size)
        val vectors = names.map { name ->
            val vector = requireNotNull(SautiHugeVectors.get(name)) { "Missing vector $name" }
            assertEquals(name, vector.name)
            assertEquals(24f, vector.viewportWidth, 0f)
            assertEquals(24f, vector.viewportHeight, 0f)
            assertTrue("$name has no drawable geometry", vector.root.size > 0)
            vector
        }
        compose.setContent { Frame {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("SautiLink · Licensed icon rendering", style = MaterialTheme.typography.titleMedium)
                Text("All 85 local vectors · motion disabled", style = MaterialTheme.typography.bodySmall)
                FlowRow(maxItemsInEachRow = 7, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    vectors.forEach { vector ->
                        Box(Modifier.size(45.dp), contentAlignment = Alignment.Center) {
                            SautiIcon(vector, vector.name, Modifier.size(25.dp))
                        }
                    }
                }
            }
        } }
        compose.onNodeWithContentDescription("home-0-1").assertExists()
        compose.onNodeWithContentDescription("information-circle").assertExists()
        screenshot("licensed-icons-light-390-motion0")
    }

    @Test fun animatedIcon_doesNotConsumeParentTouch_whenMotionIsDisabled() {
        var clicks by mutableIntStateOf(0)
        var providedScale: Float? = null
        compose.setContent { Frame {
            val scale = rememberCoroutineScope().coroutineContext[MotionDurationScale]?.scaleFactor
            SideEffect { providedScale = scale }
            Column(Modifier.padding(20.dp)) {
                IconButton(onClick = { clicks++ }, modifier = Modifier.testTag("icon-action")) {
                    SautiIcon(Icons.Rounded.FavoriteBorder, "Like fixture", selected = clicks % 2 == 1)
                }
                Text("Clicks: $clicks")
            }
        } }
        compose.runOnIdle { assertEquals(0f, providedScale ?: -1f, 0f) }
        compose.onNodeWithTag("icon-action").performTouchInput { click() }
        compose.onNodeWithText("Clicks: 1").assertExists()
        compose.onNodeWithTag("icon-action").performTouchInput { click() }
        compose.onNodeWithText("Clicks: 2").assertExists()
        compose.waitForIdle() // A zero system duration scale must settle, not leave an infinite animation.
    }

    @Test fun commentActionsKeepThumbControlsAndUseSingularAndPluralReplyLabels() {
        var replies by mutableIntStateOf(1)
        var likes by mutableIntStateOf(0)
        compose.setContent {
            Frame {
                SautiCommentActions(likes, 0, replies, likes > 0, false, reactionEnabled = true,
                    replyEnabled = true, onLike = { likes++ }, onDislike = {}, onReply = {}, onViewReplies = { replies++ })
            }
        }
        compose.onNodeWithContentDescription("Like comment").assertHasClickAction().performClick()
        compose.onNodeWithContentDescription("Remove like from comment").assertExists()
        compose.onNodeWithContentDescription("Dislike comment").assertHasClickAction()
        compose.onNodeWithText("View 1 reply").assertIsDisplayed().performClick()
        compose.onNodeWithText("View 2 replies").assertIsDisplayed()
    }

    @Test fun shortsCaptionExpandsWithInlineLinkAndPreservesTail() {
        val caption = "This is a long caption showing how the video was made. ".repeat(5) + "Final caption line"
        compose.setContent {
            Frame {
                SautiPostText(caption, Modifier.width(220.dp), style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2, expandedMaxHeight = 170.dp)
            }
        }
        val collapsed = compose.onNodeWithText(caption, useUnmergedTree = true)
        val layouts = mutableListOf<TextLayoutResult>()
        collapsed.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertEquals(2, layouts.single().lineCount)
        assertTrue(layouts.single().isLineEllipsized(1))
        compose.onNodeWithText("See more").assertIsDisplayed().performClick()
        compose.onNodeWithText("Final caption line See less", substring = true).assertExists()
    }

    @Test fun commentSheetPolicy_halfPortrait_fullCompactLandscape() {
        var width by mutableIntStateOf(390)
        var height by mutableIntStateOf(844)
        var fraction = 0f
        compose.setContent { Frame(width = width, height = height) {
            val current = commentSheetHeightFraction()
            SideEffect { fraction = current }
            Text("Comment sheet: $current", Modifier.padding(18.dp))
        } }
        compose.runOnIdle { assertEquals(.56f, fraction, 0f); width = 640; height = 360 }
        compose.runOnIdle { assertEquals(1f, fraction, 0f) }
    }

    @Test fun commentSheetPolicy_expandsForActualKeyboard() {
        var fraction = 0f
        compose.setContent { Frame {
            val current = commentSheetHeightFraction()
            val focus = LocalFocusManager.current
            val keyboard = LocalSoftwareKeyboardController.current
            val requester = remember { FocusRequester() }
            var draft by remember { mutableStateOf("") }
            SideEffect { fraction = current }
            DisposableEffect(Unit) { onDispose { keyboard?.hide() } }
            Column(Modifier.padding(18.dp)) {
                Text("Comment sheet: $current")
                OutlinedTextField(draft, { draft = it }, label = { Text("Keyboard fixture") },
                    modifier = Modifier.focusRequester(requester).testTag("keyboard-field"),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); keyboard?.hide() }))
                Button(onClick = { requester.requestFocus(); keyboard?.show() }) { Text("Show fixture keyboard") }
            }
        } }
        compose.runOnIdle { assertEquals(.56f, fraction, 0f) }
        compose.onNodeWithText("Show fixture keyboard").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { fraction == 1f }
        screenshot("comment-keyboard-policy-light-390")
        compose.onNodeWithTag("keyboard-field").performImeAction()
    }
}
