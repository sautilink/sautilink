package com.sautilink.nativeapp.feature.auth

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.sautilink.nativeapp.R
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

@OptIn(ExperimentalTextApi::class)
private val introItalic = FontFamily(
    Font(R.font.google_sans_italic, weight = FontWeight.Bold, style = FontStyle.Italic,
        variationSettings = FontVariation.Settings(FontVariation.weight(700))),
    Font(R.font.google_sans_italic, weight = FontWeight.Medium, style = FontStyle.Italic,
        variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.google_sans_italic, weight = FontWeight.Normal, style = FontStyle.Italic,
        variationSettings = FontVariation.Settings(FontVariation.weight(400))),
)

@Composable
internal fun NativeSignInIntro(onCreateAccount: () -> Unit, onLogin: () -> Unit) {
    var revealSlogan by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { revealSlogan = true }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color(0xFF173C5C))) {
        val minReadableHeight = (590 * LocalDensity.current.fontScale.coerceAtLeast(1f)).dp
        val sceneHeight = maxOf(maxHeight, minReadableHeight)
        val scroll = rememberScrollState()
        Box(Modifier.fillMaxWidth().verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().height(sceneHeight).clipToBounds()) {
                Image(painterResource(R.drawable.sautilink_intro_kilimanjaro), contentDescription = null,
                    modifier = Modifier.matchParentSize(), contentScale = ContentScale.Crop)
                IntroWeather(Modifier.matchParentSize())
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(
                    0f to Color(0x500B2543), .23f to Color.Transparent,
                    .73f to Color.Transparent, 1f to Color(0xBE071407)
                )))

                Column(Modifier.align(Alignment.TopCenter).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                    .padding(top = 28.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Image(painterResource(R.drawable.sautilink_logo), contentDescription = null,
                        modifier = Modifier.size(width = 57.dp, height = 25.dp), contentScale = ContentScale.Fit)
                    Image(painterResource(R.drawable.sautilink_wordmark_white), contentDescription = "SautiLink",
                        modifier = Modifier.size(width = 92.dp, height = 20.dp), contentScale = ContentScale.Fit)
                }

                val sloganStyle = TextStyle(
                    fontFamily = introItalic, fontStyle = FontStyle.Italic, fontSize = 36.sp,
                    lineHeight = 40.sp, letterSpacing = (-.85).sp, color = Color.White,
                    shadow = Shadow(Color(0xBD102B42), Offset(0f, 2f), 9f),
                )
                Column(Modifier.align(Alignment.TopStart).padding(top = sceneHeight * .365f)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
                    .padding(start = 27.dp, end = 24.dp)) {
                    IntroSloganLine("Link it.", FontWeight.Bold, Color.White, sloganStyle, revealSlogan, 0)
                    IntroSloganLine("Share.", FontWeight.Medium, Color(0xFFE6E9ED), sloganStyle, revealSlogan, 120)
                    IntroSloganLine("Connect", FontWeight.Normal, Color(0xFFD1D6DD), sloganStyle, revealSlogan, 240)
                }

                Column(Modifier.align(Alignment.BottomCenter).windowInsetsPadding(
                    WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                    .widthIn(max = 430.dp).fillMaxWidth().padding(start = 26.dp, end = 26.dp, bottom = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    AuthPrimaryButton(onClick = onCreateAccount,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SautiColors.LogoOrange,
                            contentColor = Color(0xFF281209))) {
                        Text("Create account", fontFamily = SautiHeaderFont,
                            fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    }
                    TextButton(onClick = onLogin, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
                        Text("Login", fontFamily = SautiHeaderFont, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun IntroSloganLine(
    text: String, weight: FontWeight, ink: Color, style: TextStyle, visible: Boolean, delay: Int
) {
    val reveal by animateFloatAsState(if (visible) 1f else 0f,
        tween(durationMillis = 580, delayMillis = delay, easing = FastOutSlowInEasing),
        label = "Intro line reveal")
    Text(text, fontWeight = weight, color = ink, style = style,
        modifier = Modifier.graphicsLayer {
            alpha = reveal
            translationY = (1f - reveal) * 7.dp.toPx()
        })
}

@Composable
private fun IntroWeather(modifier: Modifier) {
    val cloud = ImageBitmap.imageResource(R.drawable.sautilink_intro_cirrus)
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    if (!lifecycle.value.isAtLeast(Lifecycle.State.STARTED)) return
    val animation = rememberInfiniteTransition(label = "Kilimanjaro weather")
    val drift = animation.animateFloat(0f, 1f, animationSpec = infiniteRepeatable(tween(58_000, easing = LinearEasing)),
        label = "Cloud drift")
    val flight = animation.animateFloat(0f, 1f, animationSpec = infiniteRepeatable(tween(22_000, easing = LinearEasing)),
        label = "Bird flight")
    val wing = remember { Path() }
    Canvas(modifier) {
        drawCloud(cloud, (drift.value + .38f) % 1f, .13f, .67f, .38f)
        drawCloud(cloud, (drift.value + .73f) % 1f, .39f, .84f, .30f)
        val progress = (flight.value + .24f) % 1f
        repeat(4) { bird ->
            val scale = size.width * (.012f - bird * .00135f)
            val x = size.width * (-.16f + progress * 1.43f - bird * .051f)
            val y = size.height * (.245f + bird * .007f - progress * .031f) +
                scale * sin((progress * 15f + bird) * PI).toFloat()
            val flap = sin((progress * 23f + bird * .21f) * 2 * PI).toFloat()
            val wingTip = y - scale * (.37f + flap * .66f)
            wing.reset()
            wing.moveTo(x - scale * 1.18f, wingTip)
            wing.quadraticTo(x - scale * .52f, y - scale * .65f, x, y)
            wing.quadraticTo(x + scale * .48f, y - scale * .52f, x + scale * 1.04f, wingTip + scale * .12f)
            wing.quadraticTo(x + scale * .64f, y + scale * .12f, x, y + scale * .25f)
            wing.quadraticTo(x - scale * .52f, y + scale * .12f, x - scale * 1.18f, wingTip)
            wing.close()
            drawPath(wing, color = Color(0xD8193447))
        }
    }
}

private fun DrawScope.drawCloud(cloud: ImageBitmap, phase: Float, center: Float, width: Float, alpha: Float) {
    val cloudWidth = size.width * width
    val cloudHeight = cloudWidth * cloud.height / cloud.width
    val x = -cloudWidth + (size.width + cloudWidth) * phase
    drawImage(cloud, dstSize = IntSize(cloudWidth.roundToInt().coerceAtLeast(1),
        cloudHeight.roundToInt().coerceAtLeast(1)),
        dstOffset = IntOffset(x.roundToInt(), (size.height * center - cloudHeight / 2).roundToInt()), alpha = alpha)
}
