package com.sautilink.nativeapp.feature.videos

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.StagingFeedPost
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors

@Composable
internal fun ShortsAuthorIdentityRow(auth: StagingAuthClient, post: StagingFeedPost,
    rank: ShortsTrendingRank?, follow: ShortsFollowUiState, enabled: Boolean,
    onOpenProfile: (String) -> Unit, onFollow: () -> Unit, onRetryRead: () -> Unit,
    modifier: Modifier = Modifier) {
    val handleValid = Regex("[a-z0-9][a-z0-9._]{2,29}").matches(post.authorHandle)
    val initial = post.authorName.split(' ').filter { it.isNotBlank() }.take(2)
        .joinToString("") { it.first().uppercaseChar().toString() }.ifBlank { "SL" }
    val verifiedRank = shortsRankForPost(post.id, rank)
    val button = shortsFollowPresentation(auth.account?.id == post.authorId, follow)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp),
        verticalAlignment = Alignment.CenterVertically) {
        val avatar = Modifier.size(37.dp).clip(CircleShape).clickable(enabled = handleValid) {
            onOpenProfile(post.authorHandle)
        }
        if (post.hasAvatar && handleValid) AuthorizedImage(auth,
            "/api/profile-media/${post.authorHandle}/avatar", "${post.authorName}'s profile photo", avatar,
            fallback = { SautiAvatar(initial, Modifier.fillMaxSize(), SautiColors.Blue) })
        else SautiAvatar(initial, avatar, SautiColors.Blue)
        Column(Modifier.weight(1f).clickable(enabled = handleValid) { onOpenProfile(post.authorHandle) },
            verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(post.authorName, color = Color.White, style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false))
                SautiVerificationBadge(post.verified, post.badgeType, post.authorName, size = 13.dp, onDarkSurface = true)
            }
            Text(buildAnnotatedString {
                append("@${post.authorHandle}")
                if (verifiedRank != null) {
                    append(" • ")
                    withStyle(SpanStyle(color = SautiColors.Yellow, fontWeight = FontWeight.SemiBold)) { append("#$verifiedRank") }
                    append(" on trending")
                }
            }, color = Color.White.copy(alpha = .85f), style = MaterialTheme.typography.labelSmall,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (button != ShortsFollowPresentation.HIDDEN) {
            OutlinedButton(onClick = if (button == ShortsFollowPresentation.RETRY_READ) onRetryRead else onFollow,
                enabled = enabled && handleValid && button in setOf(ShortsFollowPresentation.FOLLOW, ShortsFollowPresentation.RETRY_READ),
                shape = RoundedCornerShape(11.dp), border = BorderStroke(1.dp, Color.White.copy(alpha = .65f)),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                modifier = Modifier.heightIn(min = 38.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White, disabledContentColor = Color.White.copy(alpha = .8f))) {
                Text(when (button) {
                    ShortsFollowPresentation.FOLLOWING -> "Following"
                    ShortsFollowPresentation.PENDING -> "Follow…"
                    ShortsFollowPresentation.RETRY_READ -> "Retry"
                    else -> "Follow"
                }, style = MaterialTheme.typography.labelMedium, maxLines = 1)
            }
        }
    }
}
