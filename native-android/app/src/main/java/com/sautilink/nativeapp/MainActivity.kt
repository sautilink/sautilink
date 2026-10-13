package com.sautilink.nativeapp

import android.os.Bundle
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
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
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.dashboard.NativeDashboardScreen
import com.sautilink.nativeapp.feature.menu.NativeMenuScreen
import com.sautilink.nativeapp.feature.verification.NativeVerificationScreen
import com.sautilink.nativeapp.feature.home.NativePlaybackPreferences
import com.sautilink.nativeapp.feature.home.StagingFeedScreen
import com.sautilink.nativeapp.feature.home.NativePostDetailScreen
import com.sautilink.nativeapp.feature.inbox.InboxScreen
import com.sautilink.nativeapp.feature.inbox.NativeInboxScreen
import com.sautilink.nativeapp.feature.profile.PremiumProfileScreen
import com.sautilink.nativeapp.feature.profile.NativeProfileScreen
import com.sautilink.nativeapp.feature.posts.NativePostComposer
import com.sautilink.nativeapp.feature.posts.NativeOwnPostsScreen
import com.sautilink.nativeapp.feature.settings.NativeSettingsScreen
import com.sautilink.nativeapp.feature.other.NotificationsScreen
import com.sautilink.nativeapp.feature.notifications.NativeNotificationsScreen
import com.sautilink.nativeapp.feature.notifications.NativeNotificationsClient
import com.sautilink.nativeapp.feature.notifications.NativePushManager
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
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.ui.theme.SautiTheme
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
    // A local, per-user welcome choice only. Never persist credentials here.
    val welcomePreferences = remember(context.applicationContext) {
        context.applicationContext.getSharedPreferences("sautilink_native_welcome_v1", Context.MODE_PRIVATE)
    }
    val activeAccountId = productionAuth.account?.id
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
        if (section !in setOf("terms", "community-guidelines", "appeals", "help", "about", "contact", "privacy")) return
        val url = android.net.Uri.parse("https://sautilink.com/$section")
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
        }.onFailure { notice("Unable to open this page. Try again later.") }
    }
    fun openDeviceLanguage() {
        runCatching {
            context.startActivity(Intent(android.provider.Settings.ACTION_LOCALE_SETTINGS))
        }.onFailure { notice("Language settings are unavailable on this device.") }
    }

    fun toggleTheme() {
        val nextDark = !isDark
        darkOverride = nextDark
        themePrefs.edit().putBoolean("dark_theme_override", nextDark).apply()
    }

    BackHandler(detail != null || composerOpen || root != 0) {
        when {
            composerOpen -> if (!composerInFlight) composerOpen = false else notice("Wait for upload to finish")
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
            detail == "rooms" && notificationRoomSlug != null -> {
                notificationRoomSlug = null; detail = roomReturn
            }
            detail == "production-signup" || detail == "production-recovery" -> detail = "production-auth"
            detail != null -> detail = null
            else -> root = 0
        }
    }

    SautiTheme(darkTheme = isDark) {
        when {
            startupSplash || productionAuth.sessionState == StagingSessionState.CHECKING -> {
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
            else -> Scaffold(
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
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(58.dp),
                        elevation = FloatingActionButtonDefaults.elevation(
                            defaultElevation = 6.dp, pressedElevation = 10.dp
                        )
                    ) {
                        Icon(Icons.Rounded.Add, "Create a post", Modifier.size(28.dp))
                    }
                }
            },
            floatingActionButtonPosition = FabPosition.End
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets)) {
                Crossfade(targetState = detail to root, label = "SautiLink screen transition") { destination ->
                val (activeDetail, activeRoot) = destination
                when (activeDetail) {
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
                        onOpenRecovery = { detail = "production-recovery" }
                    )
                    "verification" -> NativeVerificationScreen(
                        auth = productionAuth,
                        onBack = { detail = "menu" }
                    )
                    "menu" -> NativeMenuScreen(
                        auth = productionAuth,
                        isDark = isDark,
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
                        onBack = { detail = profileReturn }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = "production-profile"; detail = "member-profile" },
                        onOpenPosts = { detail = "my-posts" },
                        onOpenDashboard = { dashboardReturn = "production-profile"; detail = "dashboard" },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "production-profile"; detail = "post" })
                    "member-profile" -> NativeProfileScreen(auth = productionAuth, username = viewedProfileHandle,
                        onBack = { detail = memberProfileReturn }, onSignIn = { detail = "production-auth" },
                        onStartMessage = { recipientId ->
                            pendingMessagePeerId = recipientId
                            detail = null
                            root = 3
                        },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "member-profile"; detail = "post" })
                    "my-posts" -> NativeOwnPostsScreen(auth = productionAuth, refreshKey = postsRefresh,
                        onBack = { detail = null; root = 4 }, onCreate = { composerOpen = true })
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
                        },
                        onOpenComments = { postId ->
                            notificationPostId = postId
                            postReturn = "videos"
                            detail = "post"
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
                    else -> when (activeRoot) {
                        0 -> StagingFeedScreen(
                            auth = productionAuth,
                            onBack = {},
                            onSignIn = { detail = "production-auth" },
                            asHome = true,
                            savedRequestVersion = savedRequestVersion,
                            onOpenMenu = { detail = "menu" },
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
                    onPublished = { postDraft = ""; postsRefresh++; composerOpen = false; detail = "my-posts"; root = 4; notice("Post published") },
                    onSignIn = { composerOpen = false; detail = "production-auth" },
                    onUploadActivity = { composerInFlight = it })
            }
        }
          }
    }
}
