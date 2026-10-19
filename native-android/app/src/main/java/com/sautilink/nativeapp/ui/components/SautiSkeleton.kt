package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Lightweight reusable loading shimmer, driven by native Compose animations. */
@Composable
fun SautiSkeletonBlock(modifier: Modifier = Modifier, rounded: Dp = 12.dp) {
    val transition = rememberInfiniteTransition(label = "SautiLink skeleton")
    val opacity by transition.animateFloat(
        initialValue = .38f, targetValue = .78f,
        animationSpec = infiniteRepeatable(tween(980), RepeatMode.Reverse),
        label = "Skeleton pulse"
    )
    Spacer(modifier.clip(RoundedCornerShape(rounded))
        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = .10f * opacity)))
}

@Composable
fun SautiPostSkeleton() {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SautiSkeletonBlock(Modifier.size(43.dp), 24.dp)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SautiSkeletonBlock(Modifier.width(140.dp).height(14.dp))
                SautiSkeletonBlock(Modifier.width(105.dp).height(11.dp))
            }
        }
        SautiSkeletonBlock(Modifier.fillMaxWidth(.83f).height(14.dp))
        SautiSkeletonBlock(Modifier.fillMaxWidth().height(238.dp), 12.dp)
        SautiSkeletonBlock(Modifier.fillMaxWidth(.78f).height(20.dp))
    }
}

@Composable
fun SautiNotificationSkeleton() {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 15.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        SautiSkeletonBlock(Modifier.size(56.dp), 32.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            SautiSkeletonBlock(Modifier.fillMaxWidth(.88f).height(15.dp))
            SautiSkeletonBlock(Modifier.fillMaxWidth(.58f).height(15.dp))
            SautiSkeletonBlock(Modifier.width(45.dp).height(11.dp))
        }
    }
}

@Composable
fun SautiExploreSkeleton() {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SautiSkeletonBlock(Modifier.size(49.dp), 30.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            SautiSkeletonBlock(Modifier.fillMaxWidth(.66f).height(15.dp))
            SautiSkeletonBlock(Modifier.fillMaxWidth(.92f).height(12.dp))
            SautiSkeletonBlock(Modifier.fillMaxWidth(.42f).height(12.dp))
        }
    }
}
