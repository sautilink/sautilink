package com.sautilink.nativeapp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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
    val Blue = Color(0xFF0866FF)
    val BlueDark = Color(0xFF3188FF)
    val Red = Color(0xFFED344B)
    val Yellow = Color(0xFFFFC83D)
    // Endpoints sampled from the approved transparent sautilink_logo.png, scoped to entities/Create.
    val LogoOrange = Color(0xFFFE682C)
    val LogoPink = Color(0xFFFD3B45)
    val EntityOrangeLight = Color(0xFFB84216)
    val EntityOrangeDark = Color(0xFFFF9B70)
    val LightSurface = Color(0xFFF3F6FB)
    val DarkSurface = Color(0xFF141A24)
    val DarkCard = Color(0xFF1E2735)
    val LightInk = Color(0xFF141D2E)
}

object SautiShape {
    val Card = RoundedCornerShape(24.dp)
    val Sheet = RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp)
    val Button = RoundedCornerShape(22.dp)
    val Pill = RoundedCornerShape(50)
    val IncomingBubble = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 7.dp)
    val OutgoingBubble = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 7.dp, bottomStart = 22.dp)
}

private val LightColors = lightColorScheme(
    primary = SautiColors.Blue,
    background = Color(0xFFFFFFFF),
    surface = Color(0xFFFFFFFF),
    surfaceContainer = SautiColors.LightSurface,
    onBackground = SautiColors.LightInk,
    onSurface = SautiColors.LightInk,
    onSurfaceVariant = Color(0xFF68758A),
    outline = Color(0xFFE2E8F0)
)
private val DarkColors = darkColorScheme(
    primary = SautiColors.BlueDark,
    background = Color(0xFF0E141E),
    surface = Color(0xFF0E141E),
    surfaceContainer = SautiColors.DarkCard,
    onBackground = Color(0xFFF1F5FC),
    onSurface = Color(0xFFF1F5FC),
    onSurfaceVariant = Color(0xFF98A9C2),
    outline = Color(0xFF303B4C)
)

private val defaultType = Typography()
private fun appTypography(family: FontFamily) = Typography(
    displayLarge = defaultType.displayLarge.copy(fontFamily = family),
    displayMedium = defaultType.displayMedium.copy(fontFamily = family),
    displaySmall = defaultType.displaySmall.copy(fontFamily = family),
    headlineLarge = defaultType.headlineLarge.copy(fontFamily = family),
    headlineMedium = TextStyle(fontFamily = family, fontSize = 27.sp, fontWeight = FontWeight.Bold, lineHeight = 33.sp),
    headlineSmall = defaultType.headlineSmall.copy(fontFamily = family),
    titleLarge = TextStyle(fontFamily = family, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFamily = family, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 22.sp),
    titleSmall = defaultType.titleSmall.copy(fontFamily = family),
    bodyLarge = TextStyle(fontFamily = family, fontSize = 16.sp, fontWeight = FontWeight.Normal, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = family, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp),
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
        content = content
    )
}
