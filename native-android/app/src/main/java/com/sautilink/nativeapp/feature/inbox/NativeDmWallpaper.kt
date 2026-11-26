package com.sautilink.nativeapp.feature.inbox

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

/** Original lightweight line art, drawn locally without loading a chat background image. */
internal fun Modifier.dmWallpaperDoodles(background: Color) = drawWithCache {
    val tile=84.dp.toPx()
    val ink=if(background.luminance()<.5f) Color.White.copy(alpha=.055f) else Color(0xFF6C706B).copy(alpha=.085f)
    val stroke=Stroke(1.dp.toPx(),cap=StrokeCap.Round)
    onDrawBehind {
        for(row in 0..(size.height/tile).toInt()) for(column in -1..(size.width/tile).toInt()) {
            val x=column*tile+if(row%2==0) 0f else tile*.5f
            val y=row*tile
            withTransform({translate(x+tile*.22f,y+tile*.20f);rotate(if((row+column)%2==0) -18f else 16f,pivot=Offset.Zero)}) {
                when(Math.floorMod(row+column,4)) {
                    0 -> {
                        drawRoundRect(ink,Offset.Zero,Size(tile*.35f,tile*.26f),CornerRadius(tile*.07f),style=stroke)
                        drawLine(ink,Offset(tile*.08f,tile*.26f),Offset(tile*.04f,tile*.33f),stroke.width,StrokeCap.Round)
                        drawLine(ink,Offset(tile*.04f,tile*.33f),Offset(tile*.17f,tile*.26f),stroke.width,StrokeCap.Round)
                    }
                    1 -> {
                        drawRoundRect(ink,Offset.Zero,Size(tile*.27f,tile*.14f),CornerRadius(tile*.07f),style=stroke)
                        drawRoundRect(ink,Offset(tile*.14f,tile*.09f),Size(tile*.27f,tile*.14f),CornerRadius(tile*.07f),style=stroke)
                    }
                    2 -> {
                        val p=Path().apply {moveTo(tile*.16f,0f);lineTo(tile*.20f,tile*.11f);lineTo(tile*.32f,tile*.16f)
                            lineTo(tile*.20f,tile*.20f);lineTo(tile*.16f,tile*.32f);lineTo(tile*.11f,tile*.20f)
                            lineTo(0f,tile*.16f);lineTo(tile*.11f,tile*.11f);close()}
                        drawPath(p,ink,style=stroke)
                    }
                    else -> {
                        drawCircle(ink,tile*.055f,Offset(tile*.09f,tile*.25f),style=stroke)
                        drawLine(ink,Offset(tile*.14f,tile*.25f),Offset(tile*.14f,0f),stroke.width,StrokeCap.Round)
                        drawLine(ink,Offset(tile*.14f,0f),Offset(tile*.31f,tile*.06f),stroke.width,StrokeCap.Round)
                        drawLine(ink,Offset(tile*.31f,tile*.06f),Offset(tile*.31f,tile*.30f),stroke.width,StrokeCap.Round)
                        drawCircle(ink,tile*.055f,Offset(tile*.26f,tile*.30f),style=stroke)
                    }
                }
            }
        }
    }
}
