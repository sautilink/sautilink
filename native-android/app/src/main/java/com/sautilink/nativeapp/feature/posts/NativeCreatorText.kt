package com.sautilink.nativeapp.feature.posts

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.core.content.res.ResourcesCompat
import com.sautilink.nativeapp.R
import kotlin.math.roundToInt

internal enum class NativeCreatorFont(val label: String, val resource: Int) {
    Montserrat("Montserrat", R.font.creator_montserrat), Poppins("Poppins", R.font.creator_poppins),
    Playfair("Playfair Display", R.font.creator_playfairdisplay), Lora("Lora", R.font.creator_lora),
    Merriweather("Merriweather", R.font.creator_merriweather), Oswald("Oswald", R.font.creator_oswald),
    Bebas("Bebas Neue", R.font.creator_bebasneue), Anton("Anton", R.font.creator_anton),
    Caveat("Caveat", R.font.creator_caveat), Dancing("Dancing Script", R.font.creator_dancingscript),
    Pacifico("Pacifico", R.font.creator_pacifico), Lobster("Lobster", R.font.creator_lobster),
    Kalam("Kalam", R.font.creator_kalam), SpaceMono("Space Mono", R.font.creator_spacemono),
    Abril("Abril Fatface", R.font.creator_abrilfatface);
}

internal data class NativeCreatorText(val text: String = "", val font: NativeCreatorFont = NativeCreatorFont.Montserrat,
    val bold: Boolean = false, val color: Int = Color.WHITE, val cardColor: Int = Color.TRANSPARENT,
    val size: Float = .07f, val x: Float = .5f, val y: Float = .5f)

/** The same proportional layout is used in the photo, video preview and exported video. */
internal fun drawCreatorText(context: Context, canvas: Canvas, width: Int, height: Int, text: NativeCreatorText) {
    if (text.text.isBlank()) return
    val unit = minOf(width, height).toFloat()
    val padding = unit * .025f
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        color = text.color
        textSize = unit * text.size.coerceIn(.025f, .16f)
        val face = ResourcesCompat.getFont(context, text.font.resource) ?: Typeface.DEFAULT
        typeface = Typeface.create(face, if (text.bold) Typeface.BOLD else Typeface.NORMAL)
        fontVariationSettings = "'wght' ${if (text.bold) 700 else 400}"
        if (text.cardColor == Color.TRANSPARENT) setShadowLayer((unit * .003f).coerceAtLeast(1f), 0f, unit * .002f, 0x99000000.toInt())
    }
    val maxWidth = (width * .88f).roundToInt().coerceAtLeast(1)
    val content = text.text.take(300)
    val desired = kotlin.math.ceil(Layout.getDesiredWidth(content, paint).toDouble()).toInt().coerceIn(1, maxWidth)
    val layout = StaticLayout.Builder.obtain(content, 0, content.length, paint, desired)
        .setAlignment(Layout.Alignment.ALIGN_CENTER).setIncludePad(false)
        .setMaxLines(8).setEllipsize(TextUtils.TruncateAt.END).build()
    val blockWidth = desired + padding * 2
    val blockHeight = layout.height + padding * 2
    val left = (width * text.x.coerceIn(0f, 1f) - blockWidth / 2).coerceIn(0f, (width - blockWidth).coerceAtLeast(0f))
    val top = (height * text.y.coerceIn(0f, 1f) - blockHeight / 2).coerceIn(0f, (height - blockHeight).coerceAtLeast(0f))
    if (text.cardColor != Color.TRANSPARENT) canvas.drawRoundRect(left, top, left + blockWidth, top + blockHeight,
        padding * .6f, padding * .6f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = text.cardColor })
    canvas.save(); canvas.translate(left + padding, top + padding); layout.draw(canvas); canvas.restore()
}

internal fun creatorTextBitmap(context: Context, width: Int, height: Int, text: NativeCreatorText): Bitmap =
    Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { drawCreatorText(context, Canvas(it), width, height, text) }
