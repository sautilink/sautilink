package com.sautilink.nativeapp.ui

import android.content.res.Configuration
import android.graphics.Bitmap
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.auth.AuthBirthDateField
import com.sautilink.nativeapp.feature.auth.NativeAuthScreen
import com.sautilink.nativeapp.feature.auth.NativeRecoveryScreen
import com.sautilink.nativeapp.feature.auth.NativeRegistrationScreen
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.commentSheetHeightFraction
import com.sautilink.nativeapp.feature.rooms.RoomContentTabs
import com.sautilink.nativeapp.feature.rooms.RoomSectionHeading
import com.sautilink.nativeapp.feature.rooms.RoomTab
import com.sautilink.nativeapp.ui.components.SautiHugeVectors
import com.sautilink.nativeapp.ui.components.SautiIcon
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Real Compose rendering in an empty test host. MainActivity is never started.
 * Auth has an empty account in the instrumentation APK's isolated preferences.
 * No test presses a submit/send button, restores a session, or requests backend data.
 * Screenshots are review artifacts rather than comparisons against unreviewed goldens.
 */
@OptIn(ExperimentalTestApi::class, ExperimentalLayoutApi::class)
@RunWith(AndroidJUnit4::class)
class NativeUiRegressionTest {
    private val noMotion = object : MotionDurationScale { override val scaleFactor = 0f }
    @get:Rule val compose = createComposeRule(effectContext = noMotion)

    private fun signedOutFixture(): StagingAuthClient = StagingAuthClient(
        "sb_publishable_offline_ui_fixture",
        InstrumentationRegistry.getInstrumentation().context,
        SautiBackend.PRODUCTION
    ).apply { forgetSavedSession() }

    @Composable
    private fun Frame(width: Int = 390, height: Int = 844, fontScale: Float = 1f,
        dark: Boolean = false, content: @Composable () -> Unit) {
        val density = LocalDensity.current
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

    private fun screenshot(name: String) {
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

    @Test fun realLogin_light390_keepsAllMethodsAndNavigation() {
        val client = signedOutFixture()
        var registrations = 0
        var recoveries = 0
        compose.setContent { Frame {
            NativeAuthScreen(client, {}, {}, onRegister = { registrations++ },
                onRecovery = { recoveries++ }, isEntry = true)
        } }
        compose.onNodeWithText("Welcome back").assertIsDisplayed()
        compose.onNode(hasText("Sign in") and hasClickAction()).assertIsNotEnabled()
        compose.onNode(hasSetTextAction() and hasText("Email or username")).assertExists()
        screenshot("login-light-390")
        compose.onNodeWithContentDescription("Show password").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Hide password").assertExists()
        compose.onNodeWithText("Email code").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Email address")).assertExists()
        compose.onNodeWithText("Phone code").performClick()
        compose.onNode(hasSetTextAction() and hasText("Phone (+255...)")).assertExists()
        compose.onNode(hasText("Send code") and hasClickAction()).assertIsNotEnabled()
        compose.onNodeWithText("Password").performScrollTo().performClick()
        compose.onNodeWithText("Forgot password?").performScrollTo().performClick()
        compose.onNodeWithText("Create an account").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, recoveries); assertEquals(1, registrations) }
    }

    @Test fun realLogin_dark320_largeText_remainsScrollable() {
        val client = signedOutFixture()
        compose.setContent { Frame(width = 320, fontScale = 1.5f, dark = true) {
            NativeAuthScreen(client, {}, {}, onRegister = {}, onRecovery = {}, isEntry = true)
        } }
        compose.onNodeWithText("Welcome back").assertIsDisplayed()
        screenshot("login-dark-320-font150-top")
        compose.onNodeWithText("Create an account").performScrollTo().assertIsDisplayed()
        screenshot("login-dark-320-font150-actions")
        compose.onNodeWithText("Phone code").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Phone (+255...)")).performScrollTo().assertIsDisplayed()
    }

    @Test fun realRegistration_light390_fieldsAndExistingCodeFlowRemain() {
        val client = signedOutFixture()
        compose.setContent { Frame { NativeRegistrationScreen(client, {}, {}) } }
        compose.onNodeWithText("A place for your voice.").assertIsDisplayed()
        compose.onNode(hasSetTextAction() and hasText("Username")).assertExists()
        screenshot("signup-light-390-top")
        compose.onNodeWithContentDescription("Choose date of birth").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Show confirm password").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Hide confirm password").assertExists()
        compose.onNodeWithText("Already have a signup email code?").performScrollTo().performClick()
        compose.onNodeWithText("2 of 4 · Verify email").performScrollTo().assertIsDisplayed()
        compose.onNode(hasSetTextAction() and hasText("8-digit email code")).assertExists()
        screenshot("signup-email-code-light-390")
    }

    @Test fun realRecovery_dark320_largeText_keepsDisabledEmptySubmit() {
        val client = signedOutFixture()
        compose.setContent { Frame(width = 320, fontScale = 1.5f, dark = true) {
            NativeRecoveryScreen(client, {})
        } }
        compose.onNodeWithText("Let’s get you back in").assertExists()
        compose.onNode(hasSetTextAction() and hasText("Email address")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Send recovery link").performScrollTo().assertIsNotEnabled()
        screenshot("recovery-dark-320-font150")
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

    @Test fun nativeRoomTabs_320_largeText_keepMeaningAndSelectedOnlyLabel() {
        var selected by mutableStateOf(RoomTab.DISCUSSION)
        compose.setContent { Frame(width = 320, fontScale = 1.5f) {
            Column(Modifier.fillMaxWidth()) {
                RoomSectionHeading("Room rules", modifier = Modifier.padding(18.dp))
                RoomContentTabs(selected) { selected = it }
            }
        } }
        compose.onNodeWithContentDescription("Discussion").assertIsSelected()
        compose.onNodeWithContentDescription("People").assertIsNotSelected().performScrollTo().performClick()
        compose.onNodeWithContentDescription("People").assertIsSelected()
        compose.onNodeWithText("People").assertIsDisplayed()
        compose.onNodeWithText("Discussion").assertDoesNotExist()
        compose.onNodeWithContentDescription("About").assertExists()
        compose.onNodeWithContentDescription("Media").assertExists()
        screenshot("room-tabs-light-320-font150")
    }

    @Test fun allLicensedVectors_parseAndRenderWithMotionDisabled() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets
            .open("source.json").bufferedReader().use { JSONObject(it.readText()) }
        val names = fixture.getJSONObject("definitions").keys().asSequence().toList().sorted()
        assertEquals("Cover every licensed source definition", 84, names.size)
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
                Text("All 84 local vectors · motion disabled", style = MaterialTheme.typography.bodySmall)
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
