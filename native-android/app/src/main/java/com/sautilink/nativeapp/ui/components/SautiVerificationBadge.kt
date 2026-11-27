package com.sautilink.nativeapp.ui.components

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.R
import kotlin.math.roundToInt

/** The original SautiLink PNG artwork, with status and type always supplied by the server. */
@Composable
fun SautiVerificationBadge(
    verified: Boolean,
    badgeType: String,
    displayName: String,
    modifier: Modifier = Modifier,
    size: Dp = 16.dp,
    profileOwner: Boolean = false,
    interactive: Boolean = true,
    onDarkSurface: Boolean? = null,
) {
    if (!verified) return
    val team = badgeType == "team"
    val dark = onDarkSurface ?: (MaterialTheme.colorScheme.background.luminance() < 0.5f)
    val art = if (team) R.raw.sauti_verified_team else if (dark)
        R.raw.sauti_verified_standard_dark else R.raw.sauti_verified_standard_light
    val context = LocalContext.current
    val image = remember(art) { BadgeArtwork.load(context.resources, art) }
    val label = if (!interactive) "Illustrative SautiLink verification artwork" else
        if (team) "Verified SautiLink Team account" else "Verified account"
    var showInfo by rememberSaveable { mutableStateOf(false) }
    Image(bitmap = image, contentDescription = label,
        modifier = modifier.size(size).then(if (interactive)
            Modifier.clickable(onClickLabel = "About this verified profile") { showInfo = true }
            else Modifier))
    if (showInfo) AlertDialog(
        onDismissRequest = { showInfo = false },
        title = { Text(if (team) "Official team profile" else "Verified profile") },
        text = { Text(when {
            profileOwner && team -> "This is a verified SautiLink Team profile. Verification may be removed if you no longer meet Team requirements or violate SautiLink rules or policies."
            profileOwner -> "This profile is verified. Verification may be removed if you violate SautiLink rules or policies."
            team -> "This profile was verified as belonging to $displayName, a member of the SautiLink Team."
            else -> "This profile was verified as belonging to $displayName."
        }) },
        confirmButton = { TextButton(onClick = { showInfo = false }) { Text("Close") } },
    )
}

/** Decode a small, tightly cropped copy once; the source PNGs are 3264 px square. */
private object BadgeArtwork {
    private val cache = mutableMapOf<Int, ImageBitmap>()

    @Synchronized fun load(resources: android.content.res.Resources, resourceId: Int): ImageBitmap =
        cache.getOrPut(resourceId) {
            val options = BitmapFactory.Options().apply { inSampleSize = 8 }
            val source = requireNotNull(BitmapFactory.decodeResource(resources, resourceId, options)) {
                "SautiLink verification artwork is missing"
            }
            var left = source.width
            var top = source.height
            var right = 0
            var bottom = 0
            for (y in 0 until source.height) for (x in 0 until source.width) {
                if ((source.getPixel(x, y) ushr 24) >= 12) {
                    if (x < left) left = x
                    if (x > right) right = x
                    if (y < top) top = y
                    if (y > bottom) bottom = y
                }
            }
            if (right < left || bottom < top) {
                source.recycle()
                error("SautiLink verification artwork is transparent")
            }
            val pad = ((right - left + 1) * 0.025f).roundToInt().coerceAtLeast(1)
            left = (left - pad).coerceAtLeast(0)
            top = (top - pad).coerceAtLeast(0)
            right = (right + pad).coerceAtMost(source.width - 1)
            bottom = (bottom + pad).coerceAtMost(source.height - 1)
            val crop = Bitmap.createBitmap(source, left, top, right - left + 1, bottom - top + 1)
            val display = Bitmap.createScaledBitmap(crop, 128, 128, true)
            if (display !== crop) crop.recycle()
            source.recycle()
            display.asImageBitmap()
        }
}
