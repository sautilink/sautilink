package com.sautilink.nativeapp

import android.os.Bundle
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.sautilink.nativeapp.feature.inbox.NativeMessagesClient
import com.sautilink.nativeapp.feature.inbox.NativeDmRealtime
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.dashboard.NativeDashboardScreen
import com.sautilink.nativeapp.feature.menu.NativeMenuScreen
import com.sautilink.nativeapp.feature.marketplace.NativeMarketplaceScreen
import com.sautilink.nativeapp.feature.stories.NativeStoriesScreen
import com.sautilink.nativeapp.feature.stories.NativeStoriesClient
import com.sautilink.nativeapp.feature.stories.NativeStoriesFeed
import com.sautilink.nativeapp.feature.stories.NativeStoryPresence
import com.sautilink.nativeapp.feature.stories.LocalNativeStoryPresence
import com.sautilink.nativeapp.feature.safety.NativeAppealsScreen
import com.sautilink.nativeapp.feature.verification.NativeVerificationScreen
import com.sautilink.nativeapp.feature.home.NativePlaybackPreferences
import com.sautilink.nativeapp.feature.home.StagingFeedScreen
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import com.sautilink.nativeapp.feature.home.NativePostDetailScreen
import com.sautilink.nativeapp.feature.inbox.InboxScreen
import com.sautilink.nativeapp.feature.inbox.NativeInboxScreen
import com.sautilink.nativeapp.feature.profile.NativeProfile
import com.sautilink.nativeapp.feature.profile.NativeProfileScreen
import com.sautilink.nativeapp.feature.posts.NativePostComposer
import com.sautilink.nativeapp.feature.posts.NativeOwnPostsScreen
import com.sautilink.nativeapp.feature.settings.NativeSettingsScreen
import com.sautilink.nativeapp.feature.other.NotificationsScreen
import com.sautilink.nativeapp.feature.notifications.NativeNotificationsScreen
import com.sautilink.nativeapp.feature.notifications.NativeNotificationsClient
import com.sautilink.nativeapp.feature.notifications.NativePushManager
import com.sautilink.nativeapp.feature.integrity.NativePlayIntegrityMonitor
import com.sautilink.nativeapp.feature.videos.ProductionShortVideosScreen
import com.sautilink.nativeapp.feature.explore.NativeExploreScreen
import com.sautilink.nativeapp.feature.rooms.NativeRoomsScreen
import com.sautilink.nativeapp.feature.media.MediaViewerScreen
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.NativeAuthScreen
import com.sautilink.nativeapp.feature.auth.SautiStartupSplash
import com.sautilink.nativeapp.feature.auth.SautiWelcomeOnboarding
import com.sautilink.nativeapp.feature.auth.NativeRegistrationScreen
import com.sautilink.nativeapp.feature.auth.NativeRecoveryScreen
import com.sautilink.nativeapp.ui.components.SautiBottomBar
import com.sautilink.nativeapp.ui.components.LocalSautiTextNavigation
import com.sautilink.nativeapp.ui.components.SautiTextNavigation
import com.sautilink.nativeapp.ui.text.parseTextEntities
import com.sautilink.nativeapp.ui.text.normalizeExternalUrl
import com.sautilink.nativeapp.ui.text.TextEntityKind
import com.sautilink.nativeapp.ui.theme.SautiColors
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.ui.theme.SautiTheme
import com.sautilink.nativeapp.ui.state.SessionScreenReturnHost
import com.sautilink.nativeapp.ui.state.sessionDestinationKey
import com.sautilink.nativeapp.ui.state.LocalSessionScreenPresentation
import com.sautilink.nativeapp.ui.components.NativeVideoReplaySession
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    companion object { const val EXTRA_PUSH_ROUTE = "sautilink_push_route" }
    private var pendingPushRoute by mutableStateOf<String?>(null)
    private var appResumeVersion by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativePushManager.createChannel(this)
        NativePlaybackPreferences.restore(this)
        if (savedInstanceState == null) NativePlaybackPreferences.resetSessionSound()
        pendingPushRoute = NativePushManager.routeFromIntent(intent)
        setContent { SautiNativePreview(pendingPushRoute, { pendingPushRoute = null }, appResumeVersion) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingPushRoute = NativePushManager.routeFromIntent(intent)
        if (BuildConfig.DEBUG) Log.d("SautiPushRoute", "intent accepted=${pendingPushRoute != null}")
    }

    override fun onResume() { super.onResume(); appResumeVersion++ }
}

/** Live production feed is the main Home; demo content remains an explicit design sandbox. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SautiNativePreview(pendingPushRoute: String?, onPushRouteConsumed: () -> Unit,
    appResumeVersion: Int) {
    val context = LocalContext.current
    // Local-only appearance preference. No account API or analytics is involved.
    val themePrefs = remember(context) {
        context.getSharedPreferences("sautilink_native_appearance", Context.MODE_PRIVATE)
    }
    var darkOverride by remember(themePrefs) {
        mutableStateOf<Boolean?>(
            if (themePrefs.contains("dark_theme_override"))
                themePrefs.getBoolean("dark_theme_override", false) else false
        )
    }
    // Light is the default; explicit in-app choices are persisted.
    val isDark = darkOverride ?: false
    // Retain light UI state on rotation / ordinary activity recreation.
    var startupSplash by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(1_050)
        startupSplash = false
    }
    var root by rememberSaveable { mutableStateOf(0) }
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    var composerOpen by rememberSaveable { mutableStateOf(false) }
    var composerInFlight by remember { mutableStateOf(false) }
    var postDraft by rememberSaveable { mutableStateOf("") }
    var postsRefresh by remember { mutableIntStateOf(0) }
    var unreadNotifications by remember { mutableIntStateOf(0) }
    var storiesRevision by remember { mutableIntStateOf(0) }
    var storyReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var storyDeepId by rememberSaveable { mutableStateOf<String?>(null) }
    var storyProfile by rememberSaveable { mutableStateOf<String?>(null) }
    var activityRevision by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current
    var visibleOnScreen by remember(lifecycle) {
        mutableStateOf(lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
    }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) visibleOnScreen = true
            if (event == Lifecycle.Event.ON_STOP) visibleOnScreen = false
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    var savedRequestVersion by remember { mutableIntStateOf(0) }
    var menuEntryDestination by rememberSaveable { mutableStateOf<String?>(null) }
    var settingsPrivacyFocus by rememberSaveable { mutableStateOf(false) }
    var mediaStartIndex by rememberSaveable { mutableStateOf(0) }
    var previousDetail by rememberSaveable { mutableStateOf<String?>(null) }
    var profileReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var memberProfileReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var viewedProfileHandle by rememberSaveable { mutableStateOf("") }
    var entityExploreActive by rememberSaveable { mutableStateOf(false) }
    var entityExploreQuery by rememberSaveable { mutableStateOf("") }
    var entityExploreReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var entityExploreProfile by rememberSaveable { mutableStateOf("") }
    var entityExploreMemberReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var entityExplorePostId by rememberSaveable { mutableStateOf("") }
    var entityExplorePostReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var entityExploreAccount by rememberSaveable { mutableStateOf<String?>(null) }
    var notificationPostId by rememberSaveable { mutableStateOf("") }
    var postReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var dashboardReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var notificationRoomSlug by rememberSaveable { mutableStateOf<String?>(null) }
    var roomReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var messageDeepId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingMessagePeerId by rememberSaveable { mutableStateOf<String?>(null) }
    val productionAuth = remember(context.applicationContext) {
        StagingAuthClient(BuildConfig.PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
            context.applicationContext, SautiBackend.PRODUCTION)
    }
    var initialRestoreFinished by remember(productionAuth) { mutableStateOf(false) }
    // A local, per-user welcome choice only. Never persist credentials here.
    val welcomePreferences = remember(context.applicationContext) {
        context.applicationContext.getSharedPreferences("sautilink_native_welcome_v1", Context.MODE_PRIVATE)
    }
    val activeAccountId = productionAuth.account?.id
    DisposableEffect(productionAuth, activeAccountId) {
        onDispose { StagingFeedClient(productionAuth).clearCache() }
    }
    var storiesFeed by remember(activeAccountId) { mutableStateOf(NativeStoriesFeed()) }
    var storiesClock by remember(activeAccountId) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(activeAccountId, visibleOnScreen, appResumeVersion, storiesRevision) {
        if (activeAccountId == null || !visibleOnScreen) return@LaunchedEffect
        while (true) {
            try {
                val result = NativeStoriesClient(productionAuth).feed()
                if (productionAuth.account?.id == activeAccountId) storiesFeed = result
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { /* Feed navigation and existing posts do not wait for Stories. */ }
            storiesClock = System.currentTimeMillis()
            delay(60_000)
        }
    }
    LaunchedEffect(activeAccountId) {
        if (entityExploreActive && entityExploreAccount != activeAccountId) {
            entityExploreActive = false
            if (detail == "entity-explore") detail = null
        }
    }
    LaunchedEffect(detail) {
        if (detail !in setOf("entity-explore", "member-profile", "post", "media")) entityExploreActive = false
    }
    // Memory-only menu identity, scoped to the active account and cleared on sign-out/switch.
    var menuProfile by remember(activeAccountId) { mutableStateOf<NativeProfile?>(null) }
    var welcomeDone by remember(activeAccountId) {
        mutableStateOf(activeAccountId == null ||
            welcomePreferences.getBoolean("completed_$activeAccountId", false))
    }
    // Don't allow a partially verified registration to bypass its existing server-side gates.
    var profileGate by remember(activeAccountId) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(activeAccountId) {
        if (activeAccountId == null) { profileGate = null; return@LaunchedEffect }
        profileGate = null
        profileGate = try { productionAuth.loadOwnProfile() != null }
        catch (_: Exception) {
            // A temporary profile lookup error cannot invalidate a legitimate offline session.
            true
        }
    }
    LaunchedEffect(productionAuth) {
        productionAuth.restoreSession()
        initialRestoreFinished = true
        if (productionAuth.sessionState == StagingSessionState.RETRYABLE_ERROR) {
            delay(2000); productionAuth.restoreSession()
        }
    }
    LaunchedEffect(productionAuth.account?.id, appResumeVersion) {
        if (productionAuth.account != null) {
            NativePushManager.sync(context, productionAuth)
            runCatching { NativeNotificationsClient(productionAuth).load() }
                .onSuccess { notices -> unreadNotifications = notices.count { !it.isRead } }
        } else unreadNotifications = 0
    }
    // A sampled background observation only; auth, navigation, and content never wait for it.
    LaunchedEffect(activeAccountId, visibleOnScreen, appResumeVersion) {
        if (activeAccountId == null || !visibleOnScreen) return@LaunchedEffect
        delay(2_000)
        NativePlayIntegrityMonitor.syncIfDue(context.applicationContext, productionAuth)
    }
    // Platform-wide activity is ephemeral, opt-in, reciprocal and foreground-only.
    LaunchedEffect(productionAuth.account?.id, visibleOnScreen, activityRevision, appResumeVersion) {
        if (productionAuth.account == null || !visibleOnScreen) return@LaunchedEffect
        val dm = NativeMessagesClient(productionAuth)
        if (!runCatching { dm.activityStatusEnabled() }.getOrDefault(false)) return@LaunchedEffect
        val live = NativeDmRealtime(productionAuth, null, null, {}, {}, {})
        try {
            live.start(this, true)
            while (true) {
                runCatching { dm.touchActivity() }
                delay(180_000)
            }
        } finally { live.close() }
    }
    LaunchedEffect(pendingPushRoute) {
        val route = pendingPushRoute ?: return@LaunchedEffect
        val path = route.substringBefore('?').trimEnd('/')
        if (BuildConfig.DEBUG) Log.d("SautiPushRoute", "apply accepted route")
        when {
            path == "/notifications" -> detail = "notifications"
            path == "/home" -> { detail = null; root = 0 }
            path == "/explore" -> { detail = null; root = 1 }
            path == "/videos" -> detail = "videos"
            path == "/stories" -> { storyDeepId = null; storyProfile = null; storyReturn = null; detail = "stories" }
            path.startsWith("/stories/") -> {
                storyDeepId = path.removePrefix("/stories/"); storyProfile = null; storyReturn = null; detail = "stories"
            }
            path == "/profile" -> { detail = null; root = 4 }
            path == "/rooms" -> { notificationRoomSlug = null; roomReturn = null; detail = "rooms" }
            path.startsWith("/rooms/") -> {
                notificationRoomSlug = path.removePrefix("/rooms/"); roomReturn = null; detail = "rooms"
            }
            path == "/settings" -> detail = "settings"
            path.startsWith("/post/") -> {
                notificationPostId = path.removePrefix("/post/"); postReturn = null; detail = "post"
            }
            path.startsWith("/u/") -> {
                viewedProfileHandle = path.removePrefix("/u/")
                memberProfileReturn = null; detail = "member-profile"
            }
            path == "/messages" -> { detail = null; root = 3 }
            path.startsWith("/messages/") -> {
                messageDeepId = path.removePrefix("/messages/"); detail = null; root = 3
            }
        }
        onPushRouteConsumed()
    }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    fun notice(message: String) { scope.launch { snackbar.showSnackbar(message) } }
    fun openMedia(index: Int) { mediaStartIndex = index; previousDetail = detail; detail = "media" }
    fun closeMedia() { detail = previousDetail; previousDetail = null }
    fun openWebsite(section: String) {
        // Only allow official, verified destinations; no arbitrary URL input from content.
        val destination = when (section) {
            "cloud-engine" -> "https://cloudengine.sautilink.com/"
            "router-setup" -> "https://router.sautilink.com/"
            in setOf("terms", "community-guidelines", "help", "about", "contact", "privacy") -> "https://sautilink.com/$section"
            else -> return
        }
        val url = android.net.Uri.parse(destination)
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
        }.onFailure { notice("Unable to open this page. Try again later.") }
    }
    fun openDeviceLanguage() {
        runCatching {
            context.startActivity(Intent(android.provider.Settings.ACTION_LOCALE_SETTINGS))
        }.onFailure { notice("Language settings are unavailable on this device.") }
    }

    fun openEntityUrl(value: String) {
        val destination = normalizeExternalUrl(value) ?: return
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(destination))
                .addCategory(Intent.CATEGORY_BROWSABLE))
        }.onFailure { notice("Unable to open this link on this device.") }
    }

    fun toggleTheme() {
        val nextDark = !isDark
        darkOverride = nextDark
        themePrefs.edit().putBoolean("dark_theme_override", nextDark).apply()
    }

    fun openEntityProfile(handle: String) {
        // A canonical card target can legitimately end in a dot; prose punctuation rules do not apply.
        val normalized = handle.trim().lowercase()
        if (!Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(normalized)) return
        // A mention inside a profile must not replace its Back destination with itself.
        if (detail != "member-profile") memberProfileReturn = detail
        viewedProfileHandle = normalized
        detail = "member-profile"
    }
    fun openEntityHashtag(hashtag: String) {
        val entity = parseTextEntities(hashtag).singleOrNull()
        if (entity?.kind != TextEntityKind.HASHTAG || entity.end != hashtag.length) return
        if (!entityExploreActive) {
            entityExploreReturn = detail
            entityExploreProfile = viewedProfileHandle
            entityExploreMemberReturn = memberProfileReturn
            entityExplorePostId = notificationPostId
            entityExplorePostReturn = postReturn
            entityExploreAccount = activeAccountId
            entityExploreActive = true
        }
        entityExploreQuery = entity.target
        detail = "entity-explore"
    }
    fun closeEntityExplore() {
        viewedProfileHandle = entityExploreProfile
        memberProfileReturn = entityExploreMemberReturn
        notificationPostId = entityExplorePostId
        postReturn = entityExplorePostReturn
        detail = entityExploreReturn
        entityExploreActive = false
    }

    BackHandler(detail != null || composerOpen || root != 0) {
        when {
            composerOpen -> if (!composerInFlight) composerOpen = false else notice("Wait for upload to finish")
            detail == "entity-explore" -> closeEntityExplore()
            detail == "media" -> closeMedia()
            detail == "menu" -> detail = null
            detail == menuEntryDestination && menuEntryDestination != null -> {
                menuEntryDestination = null
                detail = "menu"
            }
            detail == "dashboard" -> detail = dashboardReturn
            detail == "production-profile" -> detail = profileReturn
            detail == "member-profile" -> detail = memberProfileReturn
            detail == "my-posts" -> detail = null
            detail == "post" -> detail = postReturn
            detail == "stories" -> { detail = storyReturn; storyDeepId = null; storyProfile = null }
            detail == "rooms" && notificationRoomSlug != null -> {
                notificationRoomSlug = null; detail = roomReturn
            }
            detail == "production-signup" || detail == "production-recovery" -> detail = "production-auth"
            detail != null -> detail = null
            else -> root = 0
        }
    }

    val currentEntityProfile by rememberUpdatedState<(String) -> Unit>(::openEntityProfile)
    val currentEntityHashtag by rememberUpdatedState<(String) -> Unit>(::openEntityHashtag)
    val currentEntityUrl by rememberUpdatedState<(String) -> Unit>(::openEntityUrl)
    val textNavigation = remember {
        SautiTextNavigation(onProfile = { currentEntityProfile(it) }, onHashtag = { currentEntityHashtag(it) },
            onUrl = { currentEntityUrl(it) })
    }
    SautiTheme(darkTheme = isDark) {
      CompositionLocalProvider(LocalSautiTextNavigation provides textNavigation,
          LocalNativeStoryPresence provides NativeStoryPresence(
              storiesFeed.activeGroups(storiesClock).map { it.author.username }.toSet(),
              open = { handle -> storyProfile = handle; storyDeepId = null; storyReturn = detail; detail = "stories" })) {
        when {
            // Keep the auth screen mounted during a later Retry session. Replacing it
            // with splash cancels its remembered coroutine scope and aborts the retry.
            startupSplash || (!initialRestoreFinished &&
                productionAuth.sessionState == StagingSessionState.CHECKING) -> {
                SautiStartupSplash()
            }
            productionAuth.account == null -> {
                when (detail) {
                    "production-signup" -> NativeRegistrationScreen(
                        client = productionAuth,
                        onBack = { detail = "production-auth" },
                        onFinished = { detail = null; root = 0 })
                    "production-recovery" -> NativeRecoveryScreen(client = productionAuth,
                        onBack = { detail = "production-auth" })
                    else -> NativeAuthScreen(client = productionAuth,
                        onBack = { detail = "production-auth" },
                        onViewProfile = { detail = "production-auth" },
                        onRegister = { detail = "production-signup" },
                        onRecovery = { detail = "production-recovery" },
                        isEntry = true,
                        onBeforeSignOut = { NativePushManager.unregister(context, productionAuth) })
                }
            }
            detail == "production-signup" -> {
                NativeRegistrationScreen(client = productionAuth,
                    onBack = { detail = "production-auth" },
                    onFinished = { detail = null; root = 0; profileGate = true })
            }
            profileGate == null -> SautiStartupSplash()
            profileGate == false -> {
                NativeRegistrationScreen(client = productionAuth,
                    onBack = { detail = "production-auth" },
                    onFinished = { detail = null; root = 0; profileGate = true })
            }
            !welcomeDone -> {
                SautiWelcomeOnboarding(auth = productionAuth, onComplete = {
                    activeAccountId?.let { id ->
                        welcomePreferences.edit().putBoolean("completed_$id", true).apply()
                    }
                    welcomeDone = true
                    if (detail == "production-auth") detail = null
                })
            }
            else -> {
                NativeVideoReplaySession(productionAuth) {
                Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                // Primary destinations keep one stable navigation bar, including Notifications and Videos.
                if (detail == null || detail == "notifications" || detail == "videos") {
                    val selectedTab = when (detail) {
                        "notifications" -> 3
                        "videos" -> 4
                        else -> when (root) { 0 -> 0; 1 -> 1; 3 -> 2; 4 -> 5; else -> 0 }
                    }
                    SautiBottomBar(selectedTab, unreadNotifications) { tab ->
                        entityExploreActive = false
                        menuEntryDestination = null
                        when (tab) {
                            0 -> { detail = null; root = 0 }
                            1 -> { detail = null; root = 1 }
                            2 -> { detail = null; root = 3 }
                            3 -> { detail = "notifications" }
                            4 -> { detail = "videos" }
                            5 -> { detail = null; root = 4 }
                        }
                    }
                }
            },
            floatingActionButton = {
                // Twitter/X-inspired composer above the bottom navigation, never inside it.
                if (detail == null && root == 0) {
                    FloatingActionButton(
                        onClick = { composerOpen = true },
                        shape = androidx.compose.foundation.shape.CircleShape,
                        containerColor = Color.Transparent,
                        contentColor = Color.White,
                        modifier = Modifier.size(58.dp),
                        elevation = FloatingActionButtonDefaults.elevation(
                            defaultElevation = 6.dp, pressedElevation = 10.dp
                        )
                    ) {
                        Box(Modifier.fillMaxSize().background(Brush.linearGradient(
                            listOf(SautiColors.LogoOrange, SautiColors.LogoPink)),
                            androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.Add, "Create a post", Modifier.size(28.dp))
                        }
                    }
                }
            },
            floatingActionButtonPosition = FabPosition.End
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets)) {
                // Crossfade retains the old destination under the next screen and exposes
                // stale frames on slower devices. Switch destinations in one composition.
                val returnEntity = when (detail) {
                    "member-profile" -> viewedProfileHandle
                    "post" -> notificationPostId
                    "entity-explore" -> entityExploreQuery
                    else -> ""
                }
                SessionScreenReturnHost(productionAuth, productionAuth.backend.id, activeAccountId,
                    sessionDestinationKey(detail, root, returnEntity), { productionAuth.account?.id }, postsRefresh) {
                val sessionPresentations = checkNotNull(LocalSessionScreenPresentation.current)
                when (detail) {
                    "entity-explore" -> NativeExploreScreen(auth = productionAuth,
                        initialQuery = entityExploreQuery, onBack = ::closeEntityExplore,
                        onSignIn = { detail = "production-auth" },
                        onOpenProfile = ::openEntityProfile,
                        onOpenPost = { id -> notificationPostId = id; postReturn = "entity-explore"; detail = "post" })
                    "settings" -> NativeSettingsScreen(
                        auth = productionAuth,
                        focusPrivacy = settingsPrivacyFocus,
                        isDark = isDark,
                        onBack = {
                            detail = if (menuEntryDestination == "settings") "menu" else null
                            menuEntryDestination = null
                            settingsPrivacyFocus = false
                        },
                        onToggleTheme = ::toggleTheme,
                        onSignIn = { detail = "production-auth" },
                        onOpenProfile = { profileReturn = "settings"; detail = "production-profile" },
                        onOpenNotifications = { detail = "notifications" },
                        onOpenAuth = { detail = "production-auth" },
                        onOpenRecovery = { detail = "production-recovery" },
                        onVerificationRemoved = { ownerId ->
                            // Only a confirmed removal for the still-active owner may update
                            // local identity. Other profiles and later server reviews stay authoritative.
                            if (productionAuth.account?.id == ownerId) {
                                menuProfile = menuProfile?.takeIf { it.id == ownerId }?.copy(
                                    verified = false, badgeType = "standard", verifiedSince = "")
                                StagingFeedClient(productionAuth).confirmOwnVerificationRemoved(ownerId)
                                sessionPresentations.invalidate("feed:")
                                postsRefresh++
                            }
                        }
                    )
                    "verification" -> NativeVerificationScreen(
                        auth = productionAuth,
                        onBack = { detail = "menu" }
                    )
                    "marketplace" -> NativeMarketplaceScreen(onBack = { detail = null })
                    "stories" -> NativeStoriesScreen(auth = productionAuth,
                        onBack = { detail = storyReturn; storyDeepId = null; storyProfile = null },
                        onSignIn = { detail = "production-auth" }, initialStoryId = storyDeepId,
                        initialUsername = storyProfile, onChanged = { storiesRevision++ },
                        onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = "stories"; detail = "member-profile" })
                    "appeals" -> NativeAppealsScreen(auth = productionAuth,
                        onBack = { menuEntryDestination = null; detail = "menu" },
                        onSignIn = { detail = "production-auth" })
                    "menu" -> NativeMenuScreen(
                        auth = productionAuth,
                        isDark = isDark,
                        confirmedProfile = menuProfile,
                        onProfileConfirmed = { menuProfile = it },
                        onBack = { detail = null },
                        onProfile = {
                            if (productionAuth.account == null) detail = "production-auth"
                            else { detail = null; root = 4 }
                        },
                        onRooms = {
                            menuEntryDestination = "rooms"
                            notificationRoomSlug = null
                            detail = "rooms"
                        },
                        onSaved = {
                            detail = null
                            root = 0
                            savedRequestVersion++
                        },
                        onNotifications = {
                            menuEntryDestination = "notifications"
                            detail = "notifications"
                        },
                        onVerification = { detail = "verification" },
                        onSettings = {
                            menuEntryDestination = "settings"
                            settingsPrivacyFocus = false
                            detail = "settings"
                        },
                        onPrivacy = {
                            menuEntryDestination = "settings"
                            settingsPrivacyFocus = true
                            detail = "settings"
                        },
                        onLanguage = ::openDeviceLanguage,
                        onAppeals = { menuEntryDestination = "appeals"; detail = "appeals" },
                        onWebsite = ::openWebsite,
                        onToggleTheme = ::toggleTheme,
                        onSignOut = {
                            scope.launch {
                                runCatching { NativePushManager.unregister(context, productionAuth) }
                                runCatching { productionAuth.signOut() }
                                    .onSuccess { detail = null; root = 0; notice("Signed out") }
                                    .onFailure { notice("Could not complete sign out. Try again.") }
                            }
                        }
                    )
                    "production-auth" -> NativeAuthScreen(client = productionAuth, onBack = { detail = null; root = 0 },
                        onViewProfile = { profileReturn = "production-auth"; detail = "production-profile" },
                        onRegister = { detail = "production-signup" },
                        onRecovery = { detail = "production-recovery" },
                        onBeforeSignOut = { NativePushManager.unregister(context, productionAuth) })
                    "production-signup" -> NativeRegistrationScreen(client = productionAuth,
                        onBack = { detail = "production-auth" },
                        onFinished = { detail = null; root = 0 })
                    "production-recovery" -> NativeRecoveryScreen(client = productionAuth,
                        onBack = { detail = "production-auth" })
                    "dashboard" -> NativeDashboardScreen(auth = productionAuth,
                        onBack = { detail = dashboardReturn },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "dashboard"; detail = "post" })
                    "production-profile" -> NativeProfileScreen(auth = productionAuth,
                        onOpenStories = { handle -> storyProfile = handle; storyDeepId = null; storyReturn = "production-profile"; detail = "stories" },
                        onBack = { detail = profileReturn }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = "production-profile"; detail = "member-profile" },
                        onOpenPosts = { detail = "my-posts" },
                        onOpenDashboard = { dashboardReturn = "production-profile"; detail = "dashboard" },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "production-profile"; detail = "post" })
                    "member-profile" -> NativeProfileScreen(auth = productionAuth, username = viewedProfileHandle,
                        onOpenStories = { handle -> storyProfile = handle; storyDeepId = null; storyReturn = "member-profile"; detail = "stories" },
                        onBack = { detail = memberProfileReturn }, onSignIn = { detail = "production-auth" },
                        onStartMessage = { recipientId ->
                            pendingMessagePeerId = recipientId
                            detail = null
                            root = 3
                        },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "member-profile"; detail = "post" })
                    "my-posts" -> NativeOwnPostsScreen(auth = productionAuth, refreshKey = postsRefresh,
                        onBack = { detail = null; root = 4 }, onCreate = { composerOpen = true },
                        onChanged = { StagingFeedClient(productionAuth).clearCache(); postsRefresh++ })
                    "notifications" -> NativeNotificationsScreen(auth = productionAuth,
                        onUnreadChanged = { unreadNotifications = it },
                        onBack = {
                            detail = if (menuEntryDestination == "notifications") "menu" else null
                            menuEntryDestination = null
                        }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "notifications"; detail = "member-profile"
                        }, onOpenRoom = { slug -> notificationRoomSlug = slug; roomReturn = "notifications"; detail = "rooms" },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "notifications"; detail = "post" },
                        onOpenStory = { id -> storyDeepId = id; storyProfile = null; storyReturn = "notifications"; detail = "stories" },
                        onOpenInbox = { detail = null; root = 3 })
                    "post" -> NativePostDetailScreen(auth = productionAuth, postId = notificationPostId,
                        onBack = { detail = postReturn }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "post"; detail = "member-profile"
                        }, initialComments = postReturn == "videos")
                    "videos" -> ProductionShortVideosScreen(auth = productionAuth,
                        onBack = { detail = null }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "videos"; detail = "member-profile"
                        })
                    "rooms" -> NativeRoomsScreen(auth = productionAuth,
                        onBack = {
                            detail = if (notificationRoomSlug != null) roomReturn
                                else if (menuEntryDestination == "rooms") "menu" else null
                            menuEntryDestination = null
                            notificationRoomSlug = null
                        }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "rooms"; detail = "member-profile"
                        }, initialRoomSlug = notificationRoomSlug)
                    "media" -> MediaViewerScreen(startIndex = mediaStartIndex, onBack = ::closeMedia, onNotice = ::notice)
                    else -> when (root) {
                        0 -> StagingFeedScreen(
                            auth = productionAuth,
                            onBack = {},
                            onSignIn = { detail = "production-auth" },
                            asHome = true,
                            savedRequestVersion = savedRequestVersion,
                            onOpenMenu = { detail = "menu" },
                            onOpenMarketplace = { detail = "marketplace" },
                            onOpenStories = { storyReturn = null; storyDeepId = null; storyProfile = null; detail = "stories" },
                            unseenStories = storiesFeed.unreadCount(activeAccountId, storiesClock),
                            onOpenNotifications = { menuEntryDestination = null; detail = "notifications" },
                            onOpenSettings = { detail = "settings" },
                            onOpenVideos = { detail = "videos" },
                            onOpenRooms = { detail = "rooms" },
                            onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile" },
                            onOpenPost = { id -> notificationPostId = id; postReturn = null; detail = "post" }
                        )
                        1 -> NativeExploreScreen(auth = productionAuth,
                            onSignIn = { detail = "production-auth" },
                            onOpenProfile = { handle ->
                                viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile"
                            },
                            onOpenPost = { id -> notificationPostId = id; postReturn = null; detail = "post" })
                        3 -> NativeInboxScreen(auth = productionAuth,
                            onSignIn = { detail = "production-auth" },
                            onOpenPrivacy = { settingsPrivacyFocus = true; detail = "settings" },
                            onActivityVisibilityChanged = { activityRevision++ },
                            initialPeerId = pendingMessagePeerId,
                            onPeerConsumed = { pendingMessagePeerId = null },
                            onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile" },
                            initialConversationId = messageDeepId,
                            onDeepLinkConsumed = { messageDeepId = null })
                        4 -> NativeProfileScreen(auth = productionAuth,
                            onOpenStories = { handle -> storyProfile = handle; storyDeepId = null; storyReturn = null; detail = "stories" },
                            onSignIn = { detail = "production-auth" },
                            onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile" },
                            onOpenPosts = { detail = "my-posts" },
                            onOpenDashboard = { dashboardReturn = null; detail = "dashboard" },
                            onOpenPost = { id -> notificationPostId = id; postReturn = null; detail = "post" })
                        else -> StagingFeedScreen(
                            auth = productionAuth, onBack = {}, onSignIn = { detail = "production-auth" },
                            asHome = true,
                            savedRequestVersion = savedRequestVersion,
                            onOpenMenu = { detail = "menu" },
                            onOpenMarketplace = { detail = "marketplace" },
                            onOpenStories = { storyReturn = null; storyDeepId = null; storyProfile = null; detail = "stories" },
                            unseenStories = storiesFeed.unreadCount(activeAccountId, storiesClock),
                            onOpenNotifications = { menuEntryDestination = null; detail = "notifications" },
                            onOpenSettings = { detail = "settings" },
                            onOpenVideos = { detail = "videos" },
                            onOpenRooms = { detail = "rooms" },
                            onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile" },
                            onOpenPost = { id -> notificationPostId = id; postReturn = null; detail = "post" }
                        )
                    }
                }
                }
            }
        }
        if (composerOpen) {
            ModalBottomSheet(onDismissRequest = {
                if (!composerInFlight) composerOpen = false else notice("Wait for upload to finish")
            }, shape = SautiShape.Sheet) {
                NativePostComposer(auth = productionAuth, draft = postDraft, onDraftChange = { postDraft = it },
                    onDismiss = { composerOpen = false },
                    onPublished = { postDraft = ""; StagingFeedClient(productionAuth).clearCache(); postsRefresh++;
                        composerOpen = false; detail = "my-posts"; root = 4; notice("Post published") },
                    onSignIn = { composerOpen = false; detail = "production-auth" },
                    onUploadActivity = { composerInFlight = it })
            }
        }
                // Keep the final branch Unit-valued, even when the composer is closed.
                Unit
                }
            }
        }
      }
    }
}
