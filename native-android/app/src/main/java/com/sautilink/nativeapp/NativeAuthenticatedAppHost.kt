package com.sautilink.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.FabPosition
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.NativeVideoReplaySession
import com.sautilink.nativeapp.ui.components.SautiBottomBar
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.state.SessionScreenReturnHost
import com.sautilink.nativeapp.ui.theme.SautiColors

/** Chrome owns provider placement; the caller continues to own all navigation state. */
@Composable
internal fun NativeAuthenticatedAppHost(
    auth: StagingAuthClient,
    accountId: String?,
    destination: String,
    contentRevision: Int,
    snackbar: SnackbarHostState,
    selectedTab: Int?,
    unreadNotifications: Int,
    showComposerButton: Boolean,
    onTabSelected: (Int) -> Unit,
    onCreatePost: () -> Unit,
    destinationContent: @Composable () -> Unit,
    overlayContent: @Composable () -> Unit,
) {
    NativeVideoReplaySession(auth) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (selectedTab != null) SautiBottomBar(selectedTab, unreadNotifications, onTabSelected)
            },
            floatingActionButton = {
                if (showComposerButton) {
                    FloatingActionButton(
                        onClick = onCreatePost,
                        shape = CircleShape,
                        containerColor = Color.Transparent,
                        contentColor = Color.White,
                        modifier = Modifier.size(58.dp),
                        elevation = FloatingActionButtonDefaults.elevation(
                            defaultElevation = 6.dp, pressedElevation = 10.dp,
                        ),
                    ) {
                        Box(Modifier.fillMaxSize().background(Brush.linearGradient(
                            listOf(SautiColors.LogoOrange, SautiColors.LogoPink)), CircleShape),
                            contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.Add, "Create a post", Modifier.size(28.dp))
                        }
                    }
                }
            },
            floatingActionButtonPosition = FabPosition.End,
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets)) {
                SessionScreenReturnHost(auth, auth.backend.id, accountId, destination,
                    { auth.account?.id }, contentRevision, content = destinationContent)
            }
        }
        // Composer remains a replay-session sibling of Scaffold, outside destination retention.
        overlayContent()
    }
}
