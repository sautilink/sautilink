package com.sautilink.nativeapp.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Shared paper-plane artwork; callers retain their existing share actions and labels. */
internal object SautiPostIcons {
    val Share: ImageVector = ImageVector.Builder(
        name = "SautiShare", defaultWidth = 24.dp, defaultHeight = 24.dp,
        viewportWidth = 24f, viewportHeight = 24f, autoMirror = true
    ).apply {
        path(fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
            moveTo(21f, 3f)
            lineTo(14.5f, 21f)
            lineTo(10f, 14f)
            lineTo(3f, 9.5f)
            close()
            moveTo(10f, 14f)
            lineTo(21f, 3f)
        }
    }.build()
}
