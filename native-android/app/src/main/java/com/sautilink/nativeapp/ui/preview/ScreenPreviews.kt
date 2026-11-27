package com.sautilink.nativeapp.ui.preview

import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.sautilink.nativeapp.feature.chat.ChatScreen
import com.sautilink.nativeapp.feature.home.HomeScreen
import com.sautilink.nativeapp.feature.inbox.InboxScreen
import com.sautilink.nativeapp.feature.profile.PremiumProfileScreen
import com.sautilink.nativeapp.feature.videos.PremiumVideosScreen
import com.sautilink.nativeapp.ui.theme.SautiTheme

@Preview(name = "Home / Light", showBackground = true, widthDp = 390, heightDp = 790)
@Composable
private fun HomeLight() { SautiTheme(darkTheme = false) { HomeScreen(onOpenChat = {}, onToggleTheme = {}) } }

@Preview(name = "Home / Dark", showBackground = true, widthDp = 390, heightDp = 790, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun HomeDark() { SautiTheme(darkTheme = true) { HomeScreen(onOpenChat = {}, onToggleTheme = {}) } }

@Preview(name = "Chat / Light", showBackground = true, widthDp = 390, heightDp = 790)
@Composable
private fun ChatLight() { SautiTheme(darkTheme = false) { ChatScreen(onBack = {}, onToggleTheme = {}) } }

@Preview(name = "Chat / Dark", showBackground = true, widthDp = 390, heightDp = 790, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ChatDark() { SautiTheme(darkTheme = true) { ChatScreen(onBack = {}, onToggleTheme = {}) } }

@Preview(name = "Inbox / Light", showBackground = true, widthDp = 390, heightDp = 790)
@Composable
private fun InboxLight() { SautiTheme(darkTheme = false) { InboxScreen(onOpenChat = { _, _ -> }) } }

@Preview(name = "Profile / Dark", showBackground = true, widthDp = 390, heightDp = 790, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ProfileDark() { SautiTheme(darkTheme = true) { PremiumProfileScreen(onSettings = {}, onOpenVideos = {}, onOpenMedia = {}, onNotice = {}) } }

@Preview(name = "Profile / Light", showBackground = true, widthDp = 390, heightDp = 790)
@Composable
private fun ProfileLight() { SautiTheme(darkTheme = false) { PremiumProfileScreen(onSettings = {}, onOpenVideos = {}, onOpenMedia = {}, onNotice = {}) } }

@Preview(name = "Short Videos / Dark", showBackground = true, widthDp = 390, heightDp = 790, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun VideosDark() { SautiTheme(darkTheme = true) { PremiumVideosScreen(onBack = {}, onOpenMedia = {}, onNotice = {}) } }
