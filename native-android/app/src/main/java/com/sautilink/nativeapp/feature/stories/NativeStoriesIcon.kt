package com.sautilink.nativeapp.feature.stories

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Local outline artwork follows the app's 24px icon grid and finite touch animation. */
internal val NativeStoriesIcon: ImageVector by lazy {
    ImageVector.Builder("SautiStories", 24.dp, 24.dp, 24f, 24f).apply {
        path(fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round, pathFillType = PathFillType.NonZero) {
            moveTo(14.1f, 2.5f); curveTo(18.6f, 3.5f, 21.5f, 7.7f, 21.2f, 12f)
            moveTo(20f, 16.5f); curveTo(17.7f, 20.8f, 12.6f, 22.4f, 8.3f, 20.4f)
            moveTo(4.8f, 17.7f); curveTo(1.6f, 13.9f, 2.1f, 8.1f, 5.8f, 4.8f)
            moveTo(9f, 3f); lineTo(9.1f, 3f)
            moveTo(10f, 8.3f); lineTo(15.6f, 12f); lineTo(10f, 15.7f); close()
        }
    }.build()
}
