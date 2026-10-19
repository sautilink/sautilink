package com.sautilink.nativeapp.ui

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
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
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.HomeFeedTabs
import com.sautilink.nativeapp.feature.marketplace.MarketplaceButton
import com.sautilink.nativeapp.feature.marketplace.NativeMarketplaceScreen
import com.sautilink.nativeapp.feature.menu.NativeMenuScreen
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real production controls in an empty host; no MainActivity, auth restore or backend calls. */
@OptIn(ExperimentalTestApi::class, ExperimentalMaterial3Api::class)
@RunWith(AndroidJUnit4::class)
class NativeHomeMarketplaceTest {
    private val noMotion = object : MotionDurationScale { override val scaleFactor = 0f }
    @get:Rule val compose = createComposeRule(effectContext = noMotion)

    @Composable
    private fun Frame(width: Int = 390, fontScale: Float = 1f, dark: Boolean = false,
        content: @Composable () -> Unit) {
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
                    Box(Modifier.width(width.dp).fillMaxHeight().testTag("capture")) { content() }
                }
            }
        }
    }

    private fun screenshot(name: String) {
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

    private fun signedOutFixture(): StagingAuthClient {
        val storage = object : ContextWrapper(
            InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        ) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                baseContext.getSharedPreferences("native_home_marketplace_fixture_$name", mode)
        }
        return StagingAuthClient("sb_publishable_offline_ui_fixture", storage,
            SautiBackend.PRODUCTION).apply { forgetSavedSession() }
    }

    private fun assertTabTextFits(label: String) {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(label, useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue("$label needs a real text layout", layouts.isNotEmpty())
        layouts.forEach { result ->
            assertTrue("$label may wrap over at most two complete lines", result.lineCount in 1..2)
            assertFalse("$label must not clip vertically", result.didOverflowHeight)
            for (line in 0 until result.lineCount) {
                assertFalse("$label must not ellipsize line $line", result.isLineEllipsized(line))
                assertTrue("$label must fit its available width", result.getLineRight(line) <= result.size.width + 1f)
                assertTrue("$label must keep its leading characters", result.getLineLeft(line) >= -1f)
            }
            assertEquals("Every character of $label must be visible", label.length,
                result.getLineEnd(result.lineCount - 1, visibleEnd = true))
        }
    }

    @Test fun productionHomeTabs_orderSelectionAndTouch320LargeText() {
        val selections = mutableListOf<String>()
        compose.setContent { Frame(width = 320, fontScale = 1.5f) {
            var mode by remember { mutableStateOf("for_you") }
            Column(Modifier.fillMaxWidth().padding(8.dp)) {
                HomeFeedTabs(mode, { mode = it; selections += it })
            }
        } }
        val following = compose.onNodeWithText("Following").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val forYou = compose.onNodeWithText("For You").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val trending = compose.onNodeWithText("Trending").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertTrue("Tabs follow Following, For You, Trending left to right", following.center.x < forYou.center.x && forYou.center.x < trending.center.x)
        compose.onNodeWithText("For You").assertIsSelected()
        listOf("Following", "For You", "Trending").forEach(::assertTabTextFits)
        compose.onNodeWithText("Following").performTouchInput { click(center) }.assertIsSelected()
        compose.onNodeWithText("For You").assertIsNotSelected()
        compose.onNodeWithText("Trending").performTouchInput { click(center) }.assertIsSelected()
        compose.onNodeWithText("For You").performTouchInput { click(center) }.assertIsSelected()
        compose.runOnIdle { assertEquals(listOf("following", "trending", "for_you"), selections) }
        screenshot("home-tabs-light-320-font150")
    }

    @Test fun productionTabsInFixedHeader_fixtureFeedScrollLeavesTabsAndMarketplaceVisible() {
        var marketplaceOpens = 0
        // This is explicitly a placement fixture: the real HomeFeedTabs and
        // MarketplaceButton sit above a fixture feed in Scaffold's fixed header.
        // It does not restore auth or claim to render the network-backed Home screen.
        compose.setContent { Frame {
            var mode by remember { mutableStateOf("for_you") }
            Scaffold(topBar = {
                Column {
                    TopAppBar(title = { Text("SautiLink") }, actions = {
                        MarketplaceButton { marketplaceOpens++ }
                    })
                    HomeFeedTabs(mode, { mode = it }, Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                }
            }) { padding ->
                LazyColumn(Modifier.fillMaxSize().padding(padding).testTag("fixture-feed")) {
                    items(60) { index ->
                        Text("Fixture post $index", Modifier.fillMaxWidth().height(94.dp).padding(18.dp))
                    }
                }
            }
        } }
        val before = compose.onNodeWithText("For You").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("fixture-feed").performScrollToIndex(45)
        compose.onNodeWithText("Fixture post 45").assertIsDisplayed()
        val after = compose.onNodeWithText("For You").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertEquals("Fixed tabs retain their vertical position after feed scrolling", before.top, after.top, 1f)
        compose.onNodeWithText("Following").assertIsDisplayed()
        compose.onNodeWithText("Trending").assertIsDisplayed()
        compose.onNodeWithContentDescription("Marketplace").assertIsDisplayed().performTouchInput { click(center) }
        compose.runOnIdle { assertEquals(1, marketplaceOpens) }
        screenshot("home-fixed-header-fixture-390-scrolled")
    }

    @Test fun nativeMarketplace_largeText_scrollsThroughVerificationAndFreeRegistrationCopy() {
        var backs = 0
        compose.setContent { Frame(width = 320, fontScale = 1.5f, dark = true) {
            NativeMarketplaceScreen { backs++ }
        } }
        compose.onNodeWithText("Coming soon").assertIsDisplayed()
        compose.onNodeWithText("We're testing a new way to buy and sell on SautiLink.").assertIsDisplayed()
        screenshot("marketplace-dark-320-font150-top")
        val content = listOf(
            "Shop with verified businesses",
            "Marketplace will be dedicated to buying and selling products from businesses verified by SautiLink.",
            "Business verification",
            "To sell products or advertise a business, business accounts will need to pass our verification process and receive certification from SautiLink Corporation.",
            "Always free to register",
            "Business registration and every registration step on the SautiLink platform will always be free.",
            "Marketplace is currently in testing. Rollout and registration details will be announced here.",
        )
        content.forEach { text -> compose.onNodeWithText(text).performScrollTo().assertIsDisplayed() }
        screenshot("marketplace-dark-320-font150-registration")
        compose.onNodeWithContentDescription("Back").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, backs) }
    }

    @Test fun nativeMenu_appealsUsesNativeCallback_andOtherProductsKeepTheirExactKeys() {
        val auth = signedOutFixture()
        var appeals = 0
        val websites = mutableListOf<String>()
        compose.setContent { Frame(width = 320, fontScale = 1.5f) {
            NativeMenuScreen(auth = auth, isDark = false, onBack = {}, onProfile = {}, onRooms = {},
                onSaved = {}, onNotifications = {}, onSettings = {}, onVerification = {},
                onPrivacy = {}, onLanguage = {}, onAppeals = { appeals++ },
                onWebsite = { websites += it }, onToggleTheme = {}, onSignOut = {})
        } }
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Appeals"))
        compose.onNodeWithText("Appeals").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, appeals); assertTrue(websites.isEmpty()) }
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Other SautiLink Products"))
        compose.onNodeWithText("Other SautiLink Products").assertIsDisplayed()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Cloud Engine"))
        compose.onNodeWithText("Cloud Engine").assertIsDisplayed().performClick()
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Router Setup"))
        compose.onNodeWithText("Router Setup").assertIsDisplayed().performClick()
        compose.runOnIdle {
            assertEquals(listOf("cloud-engine", "router-setup"), websites)
            assertEquals(1, appeals)
        }
        screenshot("menu-products-light-320-font150")
    }
}
