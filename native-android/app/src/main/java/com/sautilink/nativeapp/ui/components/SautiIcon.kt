package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Icon as MaterialIcon
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import kotlin.math.sin

/** Native adapter for the same local licensed Huge geometry as Web. Finite entry,
 * selection and touch motion uses Compose's system-duration-aware animation clock.
 * Parent callbacks, semantics and touch targets are retained without consuming input. */
@Composable
fun SautiIcon(imageVector: ImageVector, contentDescription: String?, modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current, selected: Boolean = false) {
    val name = nativeHugeIconName(imageVector.name)
    val vector = remember(imageVector.name) { name?.let(SautiHugeVectors::get) ?: imageVector }
    MaterialIcon(vector, contentDescription, modifier.sautiIconMotion(name ?: imageVector.name, selected), tint)
}

/** Keep original brand and status artwork intact. */
@Composable
fun SautiIcon(painter: Painter, contentDescription: String?, modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current, selected: Boolean = false) {
    MaterialIcon(painter, contentDescription, modifier.sautiIconMotion("artwork", selected), tint)
}

@Composable
fun SautiIcon(bitmap: ImageBitmap, contentDescription: String?, modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current, selected: Boolean = false) {
    MaterialIcon(bitmap, contentDescription, modifier.sautiIconMotion("bitmap", selected), tint)
}

@Composable
internal fun SautiGlyph(name: String, label: String?, modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current, selected: Boolean = false) {
    val vector = remember(name) { requireNotNull(SautiHugeVectors.get(name)) { "Unknown SautiLink icon $name" } }
    MaterialIcon(vector, label, modifier.sautiIconMotion(name, selected), tint)
}

@Composable
private fun Modifier.sautiIconMotion(key: String, selected: Boolean): Modifier {
    var activation by remember { mutableIntStateOf(0) }
    val progress = remember { Animatable(0f) }
    LaunchedEffect(key, selected, activation) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(if (key == "repeat") 440 else 360))
    }
    return pointerInput(key) {
        awaitPointerEventScope {
            while (true) {
                if (awaitPointerEvent(PointerEventPass.Initial).type == PointerEventType.Press) activation++
            }
        }
    }.graphicsLayer {
        val wave = sin(progress.value * Math.PI).toFloat()
        scaleX = 1f + wave * if (key == "heart" || key == "thumbs-up") .12f else .055f
        scaleY = scaleX
        rotationZ = when (key) {
            "notification", "settings-0-1" -> sin(progress.value * Math.PI * 4).toFloat() * wave * 9f
            "repeat", "refresh-0-1" -> if (progress.value < 1f) progress.value * 360f else 0f
            "edit-0-2", "send" -> -wave * 6f
            else -> 0f
        }
        translationY = if (key == "home-0-1" || key == "upload-0-1") -wave * 1.5f else 0f
    }
}

internal fun nativeHugeIconName(vectorName: String): String? = when (vectorName.substringAfterLast('.')) {
    "Home" -> "home-0-1"
    "Search", "ZoomIn" -> "search"
    "Explore" -> "compass-0-1"
    "Storefront", "Store" -> "store-0-1"
    "ChatBubbleOutline", "QuestionAnswer", "MarkChatUnread" -> "message-0-1"
    "NotificationsNone", "NotificationsActive", "Notifications" -> "notification"
    "PersonOutline", "Person", "AccountCircle" -> "user"
    "People", "PeopleOutline", "Groups" -> "user-group"
    "PersonAdd" -> "user-add-0-1"
    "Favorite", "FavoriteBorder" -> "heart"
    "ThumbUp", "ThumbUpOffAlt" -> "thumbs-up"
    "ThumbDown", "ThumbDownOffAlt" -> "thumbs-down"
    "Bookmark", "BookmarkBorder" -> "bookmark"
    "SautiShare", "Send" -> "send"
    "IosShare", "Share" -> "share-0-1"
    "Reply" -> "corner-up-left"
    "Repeat" -> "repeat"
    "Refresh" -> "refresh-0-1"
    "ArrowBack", "ArrowBackIosNew" -> "arrow-left-0-2"
    "ChevronRight" -> "chevron-right"
    "ExpandMore", "ArrowDropDown" -> "chevron-down"
    "ArrowDownward", "Download" -> "download"
    "ArrowUpward", "Upload" -> "upload-0-1"
    "Close", "Cancel" -> "cancel-0-1"
    "Check", "CheckCircle", "CheckCircleOutline", "Done" -> "check"
    "Delete", "DeleteOutline" -> "delete-0-2"
    "Add", "AddCircleOutline" -> "add-0-1"
    "Edit" -> "edit-0-2"
    "Image", "PhotoLibrary", "AddPhotoAlternate" -> "image-0-1"
    "PhotoCamera", "AddAPhoto" -> "camera-0-1"
    "VideoLibrary", "Videocam" -> "video-0-1"
    "PlayArrow", "PlayCircle", "PlayCircleFilled", "PlayCircleOutline" -> "play"
    "Pause" -> "pause"
    "VolumeOff" -> "volume-off"
    "VolumeUp" -> "volume-high"
    "AttachFile" -> "attachment-0-1"
    "Mic" -> "mic-0-1"
    "Public", "Language" -> "globe-0-2"
    "LocationOn", "Place" -> "location-0-1"
    "Lock", "LockReset", "Key" -> "lock-keyhole"
    "Shield", "GppGood", "AdminPanelSettings" -> "shield-check"
    "VerifiedUser", "FactCheck" -> "id-verified"
    "Block" -> "security-block"
    "MailOutline", "MarkEmailRead" -> "mail-0-1"
    "Menu" -> "menu-0-1"
    "MoreHoriz" -> "more-horizontal"
    "Settings", "Tune" -> "settings-0-1"
    "Logout" -> "logout-0-1"
    "HelpOutline", "SupportAgent" -> "help-circle"
    "Description", "Article" -> "file-0-1"
    "CalendarToday", "Cake" -> "calendar-0-1"
    "Flag" -> "flag-0-1"
    "Dashboard", "TrendingUp" -> "analytics-0-1"
    "AttachMoney" -> "money-bag-0-1"
    "DarkMode" -> "moon-0-1"
    "LightMode" -> "sun-0-1"
    "Visibility", "RemoveRedEye" -> "eye"
    "VisibilityOff" -> "eye-off"
    "Info", "ErrorOutline" -> "information-circle"
    "Link" -> "link-0-1"
    "Login" -> "login-0-1"
    "Phone", "Call" -> "phone"
    "Palette" -> "palette"
    "History", "Schedule" -> "clock-0-1"
    "ContentCopy" -> "copy"
    "MusicNote" -> "music-note-0-1"
    "FolderOpen" -> "folder-0-1"
    "BarChart" -> "analytics-0-1"
    "Forum" -> "message-0-1"
    "Badge", "AssignmentTurnedIn" -> "id-verified"
    "KeyboardArrowDown" -> "chevron-down"
    "HealthAndSafety" -> "shield-check"
    "CloudQueue" -> "lucide:cloud"
    "Tag" -> "lucide:hash"
    "PushPin" -> "lucide:pin"
    "Gavel" -> "sautilink:justice-scale"
    else -> null // Precise native-only symbols retain their meaning and share animation.
}
