package com.sautilink.nativeapp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.text.googlefonts.GoogleFont.Provider
import androidx.compose.ui.text.googlefonts.isAvailableOnDevice
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.R

/** Official SautiLink brand face: Inter. The provider caches fonts; Android sans-serif is fallback. */
private val fontProvider = Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)
private val inter = GoogleFont("Inter")
private val interFamily = FontFamily(
    Font(googleFont = inter, fontProvider = fontProvider, weight = FontWeight.Normal),
    Font(googleFont = inter, fontProvider = fontProvider, weight = FontWeight.Medium),
    Font(googleFont = inter, fontProvider = fontProvider, weight = FontWeight.SemiBold),
    Font(googleFont = inter, fontProvider = fontProvider, weight = FontWeight.Bold)
)

object SautiColors {
    val Blue = Color(0xFF0068DF)
    val BlueDark = Color(0xFF64A7FF)
    val Red = Color(0xFFED344B)
    val Yellow = Color(0xFFFFC83D)
    // Endpoints sampled from the approved transparent sautilink_logo.png, scoped to entities/Create.
    val LogoOrange = Color(0xFFFE682C)
    val LogoPink = Color(0xFFFD3B45)
    val EntityOrangeLight = Color(0xFFB84216)
    val EntityOrangeDark = Color(0xFFFF9B70)
    val LightSurface = Color(0xFFF0F2F6)
    val DarkSurface = Color(0xFF111214)
    val DarkCard = Color(0xFF1C1D21)
    val LightInk = Color(0xFF1C1C1E)
}

object SautiShape {
    val Card = RoundedCornerShape(24.dp)
    val Sheet = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)
    val Button = RoundedCornerShape(16.dp)
    val Pill = RoundedCornerShape(50)
    val IncomingBubble = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 7.dp)
    val OutgoingBubble = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 7.dp, bottomStart = 22.dp)
}

private val LightColors = lightColorScheme(
    primary = SautiColors.Blue,
    secondary = Color(0xFF686873),
    secondaryContainer = SautiColors.LightSurface,
    onSecondaryContainer = SautiColors.LightInk,
    background = Color(0xFFF5F6F8),
    surface = Color(0xFFFFFFFF),
    surfaceContainer = SautiColors.LightSurface,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color.White,
    surfaceContainerHigh = SautiColors.LightSurface,
    surfaceContainerHighest = Color(0xFFE8EAF0),
    onBackground = SautiColors.LightInk,
    onSurface = SautiColors.LightInk,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEAF3FF),
    onPrimaryContainer = Color(0xFF0068DF),
    surfaceVariant = SautiColors.LightSurface,
    onSurfaceVariant = Color(0xFF686873),
    outline = Color(0xFFDADBE0),
    outlineVariant = Color(0xFFE8E9ED)
)
private val DarkColors = darkColorScheme(
    primary = SautiColors.BlueDark,
    secondary = Color(0xFFA6A6B1),
    secondaryContainer = Color(0xFF27282E),
    onSecondaryContainer = Color(0xFFF5F5F7),
    background = SautiColors.DarkSurface,
    surface = SautiColors.DarkCard,
    surfaceContainer = SautiColors.DarkCard,
    surfaceContainerLowest = SautiColors.DarkSurface,
    surfaceContainerLow = SautiColors.DarkCard,
    surfaceContainerHigh = Color(0xFF27282E),
    surfaceContainerHighest = Color(0xFF303138),
    onPrimary = Color(0xFF082343),
    primaryContainer = Color(0xFF20334D),
    onPrimaryContainer = SautiColors.BlueDark,
    surfaceVariant = Color(0xFF27282E),
    onBackground = Color(0xFFF5F5F7),
    onSurface = Color(0xFFF5F5F7),
    onSurfaceVariant = Color(0xFFA6A6B1),
    outline = Color(0xFF3B3C43),
    outlineVariant = Color(0xFF303138)
)

private val defaultType = Typography()
private fun appTypography(family: FontFamily) = Typography(
    displayLarge = defaultType.displayLarge.copy(fontFamily = family),
    displayMedium = defaultType.displayMedium.copy(fontFamily = family),
    displaySmall = defaultType.displaySmall.copy(fontFamily = family),
    headlineLarge = defaultType.headlineLarge.copy(fontFamily = family),
    headlineMedium = TextStyle(fontFamily = family, fontSize = 27.sp, fontWeight = FontWeight.Bold, lineHeight = 33.sp),
    headlineSmall = defaultType.headlineSmall.copy(fontFamily = family),
    titleLarge = TextStyle(fontFamily = family, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFamily = family, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 22.sp),
    titleSmall = defaultType.titleSmall.copy(fontFamily = family),
    bodyLarge = TextStyle(fontFamily = family, fontSize = 15.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp),
    bodyMedium = TextStyle(fontFamily = family, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = family, fontSize = 12.sp, fontWeight = FontWeight.Normal, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = family, fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = defaultType.labelMedium.copy(fontFamily = family),
    labelSmall = defaultType.labelSmall.copy(fontFamily = family)
)

@Composable
fun SautiTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val context = LocalContext.current
    val fontsProviderAvailable = remember(context) { fontProvider.isAvailableOnDevice(context) }
    val typography = remember(fontsProviderAvailable) {
        appTypography(if (fontsProviderAvailable) interFamily else FontFamily.SansSerif)
    }
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = typography,
        shapes = androidx.compose.material3.Shapes(
            small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(18.dp),
            large = SautiShape.Card
        ),
        content = {
            // Auth and onboarding can be mounted directly without a Scaffold/Surface.
            // Supply the matching foreground as well as the background tokens.
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onBackground,
                content = content)
        }
    )
}
