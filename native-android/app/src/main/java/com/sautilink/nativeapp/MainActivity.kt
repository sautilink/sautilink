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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.chat.ChatScreen
import com.sautilink.nativeapp.feature.home.HomeScreen
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
import com.sautilink.nativeapp.feature.notifications.NativePushManager
import com.sautilink.nativeapp.feature.videos.ProductionShortVideosScreen
import com.sautilink.nativeapp.feature.explore.NativeExploreScreen
import com.sautilink.nativeapp.feature.rooms.NativeRoomsScreen
import com.sautilink.nativeapp.feature.media.MediaViewerScreen
import com.sautilink.nativeapp.feature.diagnostics.StagingConnectionScreen
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.NativeAuthScreen
import com.sautilink.nativeapp.feature.auth.NativeRegistrationScreen
import com.sautilink.nativeapp.feature.auth.NativeRecoveryScreen
import com.sautilink.nativeapp.feature.auth.StagingProfileScreen
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
    val systemDark = isSystemInDarkTheme()
    val context = LocalContext.current
    // Local-only appearance preference. No account API or analytics is involved.
    val themePrefs = remember(context) {
        context.getSharedPreferences("sautilink_native_appearance", Context.MODE_PRIVATE)
    }
    var darkOverride by remember(themePrefs) {
        mutableStateOf<Boolean?>(
            if (themePrefs.contains("dark_theme_override"))
                themePrefs.getBoolean("dark_theme_override", false) else null
        )
    }
    val isDark = darkOverride ?: systemDark
    // Retain light UI state on rotation / ordinary activity recreation.
    var root by rememberSaveable { mutableStateOf(0) }
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    var composerOpen by rememberSaveable { mutableStateOf(false) }
    var composerInFlight by remember { mutableStateOf(false) }
    var postDraft by rememberSaveable { mutableStateOf("") }
    var postsRefresh by remember { mutableIntStateOf(0) }
    var mediaStartIndex by rememberSaveable { mutableStateOf(0) }
    var previousDetail by rememberSaveable { mutableStateOf<String?>(null) }
    var profileReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var memberProfileReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var viewedProfileHandle by rememberSaveable { mutableStateOf("") }
    var notificationPostId by rememberSaveable { mutableStateOf("") }
    var postReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var notificationRoomSlug by rememberSaveable { mutableStateOf<String?>(null) }
    var roomReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var messageDeepId by rememberSaveable { mutableStateOf<String?>(null) }
    var chatContact by rememberSaveable { mutableStateOf("Aisha Mohamed") }
    var chatInitials by rememberSaveable { mutableStateOf("AM") }
    val stagingAuth = remember(context.applicationContext) {
        StagingAuthClient(BuildConfig.STAGING_SUPABASE_PUBLISHABLE_KEY, context.applicationContext)
    }
    val productionAuth = remember(context.applicationContext) {
        StagingAuthClient(BuildConfig.PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
            context.applicationContext, SautiBackend.PRODUCTION)
    }
    LaunchedEffect(stagingAuth) {
        stagingAuth.restoreSession()
        if (stagingAuth.sessionState == StagingSessionState.RETRYABLE_ERROR) {
            delay(2000); stagingAuth.restoreSession()
        }
    }
    LaunchedEffect(productionAuth) {
        productionAuth.restoreSession()
        if (productionAuth.sessionState == StagingSessionState.RETRYABLE_ERROR) {
            delay(2000); productionAuth.restoreSession()
        }
    }
    LaunchedEffect(productionAuth.account?.id, appResumeVersion) {
        if (productionAuth.account != null) NativePushManager.sync(context, productionAuth)
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
    fun toggleTheme() {
        val nextDark = !isDark
        darkOverride = nextDark
        themePrefs.edit().putBoolean("dark_theme_override", nextDark).apply()
    }

    BackHandler(detail != null || composerOpen || root != 0) {
        when {
            composerOpen -> if (!composerInFlight) composerOpen = false else notice("Wait for upload to finish")
            detail == "media" -> closeMedia()
            detail == "staging-profile" || detail == "production-profile" -> detail = profileReturn
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
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (detail == null) SautiBottomBar(root) { tab ->
                    if (tab == 2) composerOpen = true else root = tab
                }
            }
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets)) {
                Crossfade(targetState = detail to root, label = "SautiLink screen transition") { destination ->
                val (activeDetail, activeRoot) = destination
                when (activeDetail) {
                    "chat" -> ChatScreen(onBack = { detail = null }, onToggleTheme = ::toggleTheme, onNotice = ::notice, contactName = chatContact, contactInitials = chatInitials)
                    "settings" -> NativeSettingsScreen(
                        auth = productionAuth,
                        isDark = isDark,
                        onBack = { detail = null },
                        onToggleTheme = ::toggleTheme,
                        onSignIn = { detail = "production-auth" },
                        onOpenProfile = { profileReturn = "settings"; detail = "production-profile" },
                        onOpenNotifications = { detail = "notifications" },
                        onOpenConnection = { detail = "connection" },
                        onOpenAuth = { detail = "production-auth" },
                        onOpenRecovery = { detail = "production-recovery" }
                    )
                    "connection" -> StagingConnectionScreen(onBack = { detail = "settings" })
                    "staging-feed" -> StagingFeedScreen(auth = stagingAuth, onBack = { detail = null }, onSignIn = { detail = "auth" })
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
                    "production-profile" -> NativeProfileScreen(auth = productionAuth,
                        onBack = { detail = profileReturn }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = "production-profile"; detail = "member-profile" },
                        onOpenPosts = { detail = "my-posts" })
                    "member-profile" -> NativeProfileScreen(auth = productionAuth, username = viewedProfileHandle,
                        onBack = { detail = memberProfileReturn }, onSignIn = { detail = "production-auth" })
                    "my-posts" -> NativeOwnPostsScreen(auth = productionAuth, refreshKey = postsRefresh,
                        onBack = { detail = null; root = 4 }, onCreate = { composerOpen = true })
                    "auth" -> NativeAuthScreen(client = stagingAuth, onBack = { detail = "settings" },
                        onViewProfile = { profileReturn = "auth"; detail = "staging-profile" })
                    "staging-profile" -> StagingProfileScreen(
                        client = stagingAuth,
                        onBack = { detail = profileReturn },
                        onSignIn = { detail = "auth" }
                    )
                    "demo-home" -> HomeScreen(
                        onOpenChat = { detail = "chat" },
                        onToggleTheme = ::toggleTheme,
                        onOpenNotifications = { detail = "notifications" },
                        onOpenVideos = { detail = "videos" },
                        onCreatePost = { composerOpen = true },
                        onOpenProfile = { detail = null; root = 4 },
                        onOpenMedia = ::openMedia,
                        onOpenStagingFeed = { detail = "staging-feed" },
                        onOpenProductionFeed = { detail = null; root = 0 },
                        onNotice = ::notice
                    )
                    "notifications" -> NativeNotificationsScreen(auth = productionAuth,
                        onBack = { detail = null }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "notifications"; detail = "member-profile"
                        }, onOpenRoom = { slug -> notificationRoomSlug = slug; roomReturn = "notifications"; detail = "rooms" },
                        onOpenPost = { id -> notificationPostId = id; postReturn = "notifications"; detail = "post" },
                        onOpenInbox = { detail = null; root = 3 })
                    "post" -> NativePostDetailScreen(auth = productionAuth, postId = notificationPostId,
                        onBack = { detail = postReturn }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "post"; detail = "member-profile"
                        })
                    "videos" -> ProductionShortVideosScreen(auth = productionAuth,
                        onBack = { detail = null }, onSignIn = { detail = "production-auth" },
                        onOpenProfile = { handle ->
                            viewedProfileHandle = handle; memberProfileReturn = "videos"; detail = "member-profile"
                        })
                    "rooms" -> NativeRoomsScreen(auth = productionAuth,
                        onBack = {
                            detail = if (notificationRoomSlug != null) roomReturn else null
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
                            onOpenDemo = { detail = "demo-home" },
                            onOpenStaging = { detail = "staging-feed" },
                            onOpenNotifications = { detail = "notifications" },
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
                            })
                        3 -> NativeInboxScreen(auth = productionAuth,
                            onSignIn = { detail = "production-auth" },
                            onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile" },
                            initialConversationId = messageDeepId,
                            onDeepLinkConsumed = { messageDeepId = null })
                        4 -> NativeProfileScreen(auth = productionAuth,
                            onSignIn = { detail = "production-auth" },
                            onOpenProfile = { handle -> viewedProfileHandle = handle; memberProfileReturn = null; detail = "member-profile" },
                            onOpenPosts = { detail = "my-posts" })
                        else -> StagingFeedScreen(
                            auth = productionAuth, onBack = {}, onSignIn = { detail = "production-auth" },
                            asHome = true, onOpenDemo = { detail = "demo-home" },
                            onOpenStaging = { detail = "staging-feed" },
                            onOpenNotifications = { detail = "notifications" },
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
