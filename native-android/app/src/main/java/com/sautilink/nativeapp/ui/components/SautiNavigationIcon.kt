package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** One stroke system for the six primary destinations; no borrowed brand artwork. */
@Composable
internal fun SautiNavigationIcon(index: Int, label: String, selected: Boolean, tint: Color,
    modifier: Modifier = Modifier) {
    Canvas(modifier.semantics { contentDescription = label }) {
        val line = Stroke(width = if (selected) 2.15f else 1.85f,
            cap = StrokeCap.Round, join = StrokeJoin.Round)
        withTransform({ scale(size.width / 24f, size.height / 24f, pivot = Offset.Zero) }) {
            val outline = Path()
            when (index) {
                0 -> { // Home
                    outline.moveTo(3f, 10.5f); outline.lineTo(12f, 3f)
                    outline.lineTo(21f, 10.5f); outline.lineTo(21f, 20.5f)
                    outline.lineTo(15.5f, 20.5f); outline.lineTo(15.5f, 14f)
                    outline.lineTo(8.5f, 14f); outline.lineTo(8.5f, 20.5f)
                    outline.lineTo(3f, 20.5f); outline.close()
                }
                1 -> { // Explore
                    outline.addOval(androidx.compose.ui.geometry.Rect(3.5f, 3.5f, 16.5f, 16.5f))
                }
                2 -> { // Messages
                    outline.moveTo(4f, 5.5f); outline.lineTo(20f, 5.5f)
                    outline.quadraticBezierTo(21f, 5.5f, 21f, 6.5f)
                    outline.lineTo(21f, 17.5f)
                    outline.quadraticBezierTo(21f, 18.5f, 20f, 18.5f)
                    outline.lineTo(4f, 18.5f)
                    outline.quadraticBezierTo(3f, 18.5f, 3f, 17.5f)
                    outline.lineTo(3f, 6.5f)
                    outline.quadraticBezierTo(3f, 5.5f, 4f, 5.5f)
                    outline.close()
                }
                3 -> { // Notifications
                    outline.moveTo(5f, 17.5f); outline.lineTo(7f, 15.5f)
                    outline.lineTo(7f, 9.5f)
                    outline.quadraticBezierTo(7f, 4.5f, 12f, 4.5f)
                    outline.quadraticBezierTo(17f, 4.5f, 17f, 9.5f)
                    outline.lineTo(17f, 15.5f); outline.lineTo(19f, 17.5f)
                    outline.close()
                }
                4 -> { // Short Videos
                    outline.moveTo(4f, 8f); outline.lineTo(20f, 8f)
                    outline.quadraticBezierTo(21f, 8f, 21f, 9f)
                    outline.lineTo(21f, 19f)
                    outline.quadraticBezierTo(21f, 20f, 20f, 20f)
                    outline.lineTo(4f, 20f)
                    outline.quadraticBezierTo(3f, 20f, 3f, 19f)
                    outline.lineTo(3f, 9f)
                    outline.quadraticBezierTo(3f, 8f, 4f, 8f)
                    outline.close()
                }
                else -> { // Profile
                    outline.addOval(androidx.compose.ui.geometry.Rect(8f, 3f, 16f, 11f))
                    outline.moveTo(4.5f, 20f)
                    outline.quadraticBezierTo(5f, 14f, 12f, 14f)
                    outline.quadraticBezierTo(19f, 14f, 19.5f, 20f)
                    outline.close()
                }
            }
            drawPath(outline, tint, style = line)
            when (index) {
                1 -> drawLine(tint, Offset(15.2f, 15.2f), Offset(21f, 21f), line.width,
                    cap = StrokeCap.Round)
                2 -> {
                    val flap = Path().apply {
                        moveTo(3.5f, 7f); lineTo(12f, 13.5f); lineTo(20.5f, 7f)
                    }
                    drawPath(flap, tint, style = line)
                }
                3 -> drawLine(tint, Offset(10f, 20.5f), Offset(14f, 20.5f), line.width,
                    cap = StrokeCap.Round)
                4 -> {
                    drawLine(tint, Offset(3.5f, 4f), Offset(19.5f, 4f), line.width,
                        cap = StrokeCap.Round)
                    val play = Path().apply {
                        moveTo(10f, 11.5f); lineTo(15.5f, 14f); lineTo(10f, 16.5f); close()
                    }
                    drawPath(play, tint, style = line)
                }
            }
        }
    }
}
