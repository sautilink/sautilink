package com.sautilink.nativeapp.feature.settings

import android.content.res.Configuration
import android.graphics.Bitmap
import android.util.Log
import android.view.KeyEvent
import android.view.inspector.WindowInspector
import androidx.activity.ComponentDialog
import androidx.activity.findViewTreeOnBackPressedDispatcherOwner
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.filters.SdkSuppress
import com.sautilink.nativeapp.ui.theme.SautiTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real production settings control/dialog in an empty host, with a fake gateway and zero network. */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class NativeVerificationRemovalUiTest {
    private val noMotion = object : MotionDurationScale { override val scaleFactor = 0f }
    @get:Rule val compose = createComposeRule(effectContext = noMotion)
    private val firstOwner = "11111111-1111-4111-8111-111111111111"
    private val secondOwner = "22222222-2222-4222-8222-222222222222"
    private var owner by mutableStateOf<String?>(firstOwner)
    private var verified by mutableStateOf(true)
    private var loading by mutableStateOf(false)
    private var externallyEnabled by mutableStateOf(true)
    private var removing by mutableStateOf(false)
    private var visible by mutableStateOf(true)
    private val removedOwners = mutableListOf<String>()

    private data class Attempt(val ownerId: String, val requestId: String)
    private class Gateway : NativeVerificationRemovalGateway {
        val attempts = mutableListOf<Attempt>()
        var action: suspend (String, String) -> NativeVerificationRemovalResult = { ownerId, _ ->
            NativeVerificationRemovalResult(ownerId, "removed")
        }
        override suspend fun removeVerification(ownerId: String, requestId: String): NativeVerificationRemovalResult {
            attempts += Attempt(ownerId, requestId)
            return action(ownerId, requestId)
        }
    }

    @Composable
    private fun Frame(width: Int, fontScale: Float, dark: Boolean, content: @Composable () -> Unit) {
        val density = LocalDensity.current
        val configuration = Configuration(LocalConfiguration.current).apply {
            screenWidthDp = width
            screenHeightDp = 844
            this.fontScale = fontScale
            orientation = Configuration.ORIENTATION_PORTRAIT
        }
        CompositionLocalProvider(LocalConfiguration provides configuration,
            LocalDensity provides Density(density.density, fontScale)) {
            SautiTheme(darkTheme = dark) {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                    contentAlignment = Alignment.TopCenter) {
                    Column(Modifier.width(width.dp).fillMaxHeight().testTag("capture")
                        .verticalScroll(rememberScrollState()).padding(18.dp)) { content() }
                }
            }
        }
    }

    private fun render(gateway: Gateway, width: Int = 390, fontScale: Float = 1f, dark: Boolean = false) {
        compose.setContent { Frame(width, fontScale, dark) {
            if (visible) VerificationRemovalSetting(ownerId = owner, verified = verified, loading = loading,
                enabled = externallyEnabled && !removing, gateway = gateway,
                onBusyChange = { removing = it },
                onRemoved = { confirmedOwner ->
                    removedOwners += confirmedOwner
                    verified = false
                })
        } }
    }

    private fun open() {
        compose.onNodeWithTag("verification-removal-setting").assertIsDisplayed().performClick()
        compose.onNodeWithText(NativeVerificationRemovalPolicy.title).assertIsDisplayed()
    }

    private fun confirm() = compose.onNodeWithTag("verification-removal-confirm").performClick()

    @RequiresApi(29)
    private fun activeDialog(): ComponentDialog {
        val dialogs = WindowInspector.getGlobalWindowViews().mapNotNull {
            it.findViewTreeOnBackPressedDispatcherOwner() as? ComponentDialog
        }.filter { it.isShowing }.distinct()
        assertEquals("The empty fixture must have exactly one real dialog window", 1, dialogs.size)
        return dialogs.single()
    }

    @RequiresApi(29)
    private fun pressBack() {
        // Global key injection can go to Samsung's notification shade instead of the app.
        // Invoke the actual dialog's Android Back dispatcher, which Compose registers itself.
        compose.runOnIdle { activeDialog().onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    @RequiresApi(29)
    private fun pressEnter() {
        compose.runOnIdle {
            val dialog = activeDialog()
            dialog.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            dialog.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        }
        compose.waitForIdle()
    }

    private fun screenshot(name: String, dialog: Boolean = false) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().context
        val supplied = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = File(supplied ?: (context.externalCacheDir ?: context.cacheDir).absolutePath,
            "sautilink-verification-removal").apply { mkdirs() }
        val output = File(directory, "$name.png")
        val node = compose.onNodeWithTag(if (dialog) "verification-removal-dialog" else "capture")
        output.outputStream().use {
            assertTrue(node.captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        Log.i("SautiVerificationScreenshot", output.absolutePath)
    }

    private fun assertTextFits(text: String) {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue("A real layout is required for $text", layouts.isNotEmpty())
        layouts.forEach { result ->
            assertFalse("Text must not clip within its own layout", result.didOverflowHeight)
            for (line in 0 until result.lineCount) {
                assertFalse("Every line must remain readable", result.isLineEllipsized(line))
                assertTrue("Text must not run outside its width", result.getLineRight(line) <= result.size.width + 1f)
                assertTrue("Leading characters must remain visible", result.getLineLeft(line) >= -1f)
            }
            assertEquals("All warning characters must exist in the scrollable text", text.length,
                result.getLineEnd(result.lineCount - 1, visibleEnd = true))
        }
    }

    @Test fun settingAppearsOnlyWithCurrentCheckmark_standardOrTeam_andHidesDuringLoadLogoutOrUnverifiedHistory() {
        val gateway = Gateway()
        verified = false // Includes users whose old verification application was approved but removed.
        render(gateway)
        compose.onNodeWithTag("verification-removal-setting").assertDoesNotExist()
        compose.runOnIdle { verified = true }
        compose.onNodeWithTag("verification-removal-setting").assertIsDisplayed()
        compose.onNodeWithText("Remove your checkmark. Normal username change limits still apply (once every 30 days).")
            .assertIsDisplayed()
        // Both member and team artwork use exactly this server-verified Boolean gate.
        compose.runOnIdle { loading = true }
        compose.onNodeWithTag("verification-removal-setting").assertDoesNotExist()
        compose.runOnIdle { loading = false; owner = null }
        compose.onNodeWithTag("verification-removal-setting").assertDoesNotExist()
        compose.runOnIdle { owner = secondOwner; verified = false }
        compose.onNodeWithTag("verification-removal-setting").assertDoesNotExist()
        compose.runOnIdle { verified = true }
        compose.onNodeWithTag("verification-removal-setting").assertIsDisplayed()
        compose.runOnIdle { externallyEnabled = false }
        compose.onNodeWithTag("verification-removal-setting").assertIsNotEnabled()
        compose.runOnIdle { assertTrue(gateway.attempts.isEmpty()) }
    }

    @SdkSuppress(minSdkVersion = 29) // Public window inspection is needed only for window-targeted keys.
    @Test fun exactWarningAndKeepVerification_cancelWithoutAnyRequest_andBackIsAlsoSafe() {
        val gateway = Gateway()
        render(gateway)
        open()
        compose.onNodeWithText(NativeVerificationRemovalPolicy.warning).assertIsDisplayed()
        assertTrue(NativeVerificationRemovalPolicy.warning.contains("complete every verification step again"))
        assertTrue(NativeVerificationRemovalPolicy.warning.contains("does not guarantee approval"))
        assertTrue(NativeVerificationRemovalPolicy.warning.contains("normal change limits"))
        compose.onNodeWithTag("verification-removal-keep").assertIsEnabled().performClick()
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.onNodeWithTag("verification-removal-setting").assertIsDisplayed()
        open()
        pressBack()
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        open()
        compose.onNodeWithTag("verification-removal-keep").assertIsFocused()
        pressEnter()
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.runOnIdle { assertTrue(gateway.attempts.isEmpty()); assertTrue(verified); assertTrue(removedOwners.isEmpty()) }
    }

    @SdkSuppress(minSdkVersion = 29)
    @Test fun pendingConfirmationBlocksDuplicateClicksKeepAndBack_thenConfirmedSuccessHidesSetting() {
        val gateway = Gateway()
        val reply = CompletableDeferred<NativeVerificationRemovalResult>()
        gateway.action = { _, _ -> reply.await() }
        render(gateway)
        open()
        confirm()
        compose.onNodeWithTag("verification-removal-confirm").assertIsNotEnabled()
            .performTouchInput { click(center) }
        compose.onNodeWithTag("verification-removal-keep").assertIsNotEnabled()
        pressBack()
        compose.onNodeWithTag("verification-removal-dialog").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(1, gateway.attempts.size)
            assertEquals(firstOwner, gateway.attempts.single().ownerId)
            assertTrue(NativeVerificationRemovalPolicy.validId(gateway.attempts.single().requestId))
            assertTrue(verified)
            assertTrue(removedOwners.isEmpty())
            reply.complete(NativeVerificationRemovalResult(firstOwner, "removed"))
        }
        compose.waitUntil(5_000) { removedOwners.size == 1 }
        compose.onNodeWithTag("verification-removal-setting").assertDoesNotExist()
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.runOnIdle { assertEquals(listOf(firstOwner), removedOwners); assertEquals(1, gateway.attempts.size) }
    }

    @Test fun deferredFailureRetainsVerificationAndRow_retryReusesSameIdempotencyUuid() {
        val gateway = Gateway()
        val failure = CompletableDeferred<NativeVerificationRemovalResult>()
        var attempts = 0
        gateway.action = { id, _ ->
            if (attempts++ == 0) failure.await() else NativeVerificationRemovalResult(id, "already_removed")
        }
        render(gateway)
        open()
        confirm()
        compose.runOnIdle { failure.completeExceptionally(IllegalStateException("Offline fixture. Please try again.")) }
        compose.onNodeWithText("Offline fixture. Please try again.").assertIsDisplayed()
        compose.onNodeWithTag("verification-removal-confirm").assertIsEnabled()
        compose.runOnIdle { assertTrue(verified); assertTrue(removedOwners.isEmpty()); assertEquals(1, gateway.attempts.size) }
        confirm()
        compose.waitUntil(5_000) { removedOwners.size == 1 }
        compose.runOnIdle {
            assertEquals(2, gateway.attempts.size)
            assertEquals(gateway.attempts[0].requestId, gateway.attempts[1].requestId)
            assertEquals(listOf(firstOwner), removedOwners)
        }
    }

    @Test fun logoutOrAccountSwitchClosesUnconfirmedDialog_withoutCallingGateway() {
        val gateway = Gateway()
        render(gateway)
        open()
        compose.runOnIdle { owner = null }
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.runOnIdle { owner = secondOwner }
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        open()
        compose.runOnIdle { owner = firstOwner }
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.runOnIdle { assertTrue(gateway.attempts.isEmpty()); assertTrue(removedOwners.isEmpty()) }
    }

    @Test fun oldAccountPendingReplyCannotCallCurrentAccountCallback_orReopenDialog() {
        val gateway = Gateway()
        val reply = CompletableDeferred<NativeVerificationRemovalResult>()
        gateway.action = { _, _ -> withContext(NonCancellable) { reply.await() } }
        render(gateway)
        open()
        confirm()
        compose.runOnIdle { owner = secondOwner }
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.runOnIdle { reply.complete(NativeVerificationRemovalResult(firstOwner, "removed")) }
        compose.waitForIdle()
        compose.onNodeWithTag("verification-removal-setting").assertIsDisplayed()
        compose.runOnIdle { assertTrue(verified); assertTrue(removedOwners.isEmpty()); assertEquals(1, gateway.attempts.size) }
    }

    @Test fun leavingSettingsDisposesPendingAction_withoutChangingVerificationOrCallingCallback() {
        val gateway = Gateway()
        val reply = CompletableDeferred<NativeVerificationRemovalResult>()
        gateway.action = { _, _ -> withContext(NonCancellable) { reply.await() } }
        render(gateway)
        open()
        confirm()
        compose.runOnIdle { visible = false }
        compose.onNodeWithTag("verification-removal-dialog").assertDoesNotExist()
        compose.runOnIdle { reply.complete(NativeVerificationRemovalResult(firstOwner, "removed")) }
        compose.waitForIdle()
        compose.runOnIdle { assertTrue(verified); assertTrue(removedOwners.isEmpty()); assertFalse(removing) }
    }

    @Test fun unconfirmedGatewayStatusOrOwnerNeverDemotesCurrentProfile() {
        val gateway = Gateway()
        var attempt = 0
        gateway.action = { _, _ ->
            if (attempt++ == 0) NativeVerificationRemovalResult(firstOwner, "pending")
            else NativeVerificationRemovalResult(secondOwner, "removed")
        }
        render(gateway)
        open()
        confirm()
        compose.onNodeWithText(NativeVerificationRemovalPolicy.unconfirmed).assertIsDisplayed()
        compose.runOnIdle { assertTrue(verified); assertTrue(removedOwners.isEmpty()) }
        confirm()
        compose.waitForIdle()
        compose.onNodeWithTag("verification-removal-dialog").assertIsDisplayed()
        compose.runOnIdle { assertTrue(verified); assertTrue(removedOwners.isEmpty()); assertEquals(2, gateway.attempts.size) }
    }

    @Test fun confirmation390Light_hasAllCopyAndAccessibleButtons_cleanScreenshot() {
        val gateway = Gateway()
        render(gateway)
        screenshot("setting-light-390")
        open()
        compose.onNodeWithTag("verification-removal-confirm").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("verification-removal-keep").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertTextFits(NativeVerificationRemovalPolicy.warning)
        screenshot("confirmation-light-390", dialog = true)
        compose.runOnIdle { assertTrue(gateway.attempts.isEmpty()) }
    }

    @Test fun confirmation320DarkFont150_scrollsWholeWarning_andButtonsStayAccessible_cleanScreenshot() {
        val gateway = Gateway()
        render(gateway, width = 320, fontScale = 1.5f, dark = true)
        open()
        val dialog = compose.onNodeWithTag("verification-removal-dialog").assertIsDisplayed().fetchSemanticsNode()
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        assertTrue("The dialog must really use the narrow 320dp local width", dialog.boundsInRoot.width <= 280 * density + 2)
        assertTextFits(NativeVerificationRemovalPolicy.warning)
        compose.onNodeWithTag("verification-removal-dialog-content").performTouchInput { swipeUp() }
        compose.onNodeWithTag("verification-removal-confirm").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("verification-removal-keep").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        screenshot("confirmation-dark-320-font150", dialog = true)
        compose.onNodeWithTag("verification-removal-keep").performClick()
        compose.runOnIdle { assertTrue(gateway.attempts.isEmpty()); assertTrue(verified) }
    }
}
