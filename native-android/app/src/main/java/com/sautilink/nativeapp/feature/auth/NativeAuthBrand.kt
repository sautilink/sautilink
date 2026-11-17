package com.sautilink.nativeapp.feature.auth

import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.R
import com.sautilink.nativeapp.ui.components.SautiIcon
import com.sautilink.nativeapp.ui.components.SautiWordmark
import com.sautilink.nativeapp.ui.theme.SautiSettingsTypography
import com.sautilink.nativeapp.ui.theme.SautiShape

/** Width-bounded, scrollable auth shell with the same reception on Login and Signup. */
@Composable
internal fun SautiAuthPage(
    hero: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val safeHeaderInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
    if (hero == null) {
        Box(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                .windowInsetsPadding(safeHeaderInsets),
            contentAlignment = Alignment.TopCenter
        ) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().fillMaxHeight()
                .imePadding().verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
        }
        return
    }

    SautiReceptionTheme {
        Column(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)
                .windowInsetsPadding(safeHeaderInsets).imePadding()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            hero()
            Column(
                Modifier.widthIn(max = 480.dp).fillMaxWidth()
                    .padding(horizontal = 22.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = content
            )
        }
    }
}

@Composable
internal fun SautiReceptionTheme(content: @Composable () -> Unit) {
    val base = MaterialTheme.colorScheme
    val dark = base.background.luminance() < .35f
    val paper = if (dark) Color(0xFF24302A) else Color(0xFFF7F1E2)
    val ink = if (dark) Color(0xFFF3EEDF) else Color(0xFF152C25)
    val primary = if (dark) Color(0xFFA9D7BB) else Color(0xFF113D34)
    val muted = if (dark) Color(0xFFBCC9BE) else Color(0xFF53635A)
    val line = if (dark) Color(0xFF54675B) else Color(0xFFA39E8F)

    MaterialTheme(colorScheme = base.copy(
        background = paper, surface = paper, surfaceContainer = paper, surfaceVariant = paper,
        onBackground = ink, onSurface = ink, onSurfaceVariant = muted,
        primary = primary, onPrimary = if (dark) Color(0xFF142C22) else Color.White,
        secondaryContainer = if (dark) Color(0xFF394D41) else Color(0xFFE3E8DC),
        onSecondaryContainer = ink, outline = line, outlineVariant = line.copy(alpha = .52f)
    )) {
        SautiSettingsTypography(content)
    }
}

@Composable
internal fun SautiReceptionPhoto(
    modifier: Modifier,
    @DrawableRes photo: Int,
    alignment: Alignment,
    fadeStart: Float,
    fadeEnd: Float
) {
    val surface = MaterialTheme.colorScheme.surface
    Box(modifier) {
        Image(painterResource(photo), null, Modifier.matchParentSize(),
            alignment = alignment, contentScale = ContentScale.Crop)
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(
            0f to Color.Transparent, fadeStart to Color.Transparent,
            fadeEnd to surface.copy(alpha = .96f), 1f to surface
        )))
    }
}

@Composable
internal fun SautiAuthHero(
    signup: Boolean, onBack: (() -> Unit)?, onSwitch: (() -> Unit)?, canSwitch: Boolean
) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val photoHeight = (maxWidth * .74f).coerceIn(220.dp, 308.dp)
        Box(Modifier.fillMaxWidth().height(photoHeight)) {
            SautiReceptionPhoto(
                modifier = Modifier.matchParentSize(),
                photo = if (signup) R.drawable.sautilink_signup_photo else R.drawable.sautilink_login_photo,
                alignment = if (signup) Alignment.TopCenter else Alignment.BottomCenter,
                fadeStart = if (signup) .54f else .64f,
                fadeEnd = .94f
            )
            if (onBack != null) {
                val interaction = remember { MutableInteractionSource() }
                IconButton(onClick = onBack, interactionSource = interaction,
                    modifier = Modifier.align(Alignment.TopStart).padding(10.dp)
                        .authPress(interaction).background(colors.surface, SautiShape.Pill)) {
                    SautiIcon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", Modifier.size(21.dp),
                        tint = colors.onSurface)
                }
            }
            Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 5.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Image(painterResource(R.drawable.sautilink_logo), null,
                    Modifier.size(width = 58.dp, height = 27.dp), contentScale = ContentScale.Fit)
                SautiWordmark(Modifier.size(width = 102.dp, height = 22.dp))
            }
        }
    }
    if (onSwitch != null) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp).selectableGroup()) {
            AuthTab("Login", !signup, canSwitch, onSwitch, Modifier.weight(1f))
            AuthTab("Signup", signup, canSwitch, onSwitch, Modifier.weight(1f))
        }
        HorizontalDivider(color = colors.outlineVariant)
    }
}

@Composable
private fun AuthTab(label: String, selected: Boolean, canSwitch: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    val ink by animateColorAsState(if (selected) colors.primary else colors.onSurfaceVariant,
        tween(180), label = "Auth tab ink")
    var showUnderline by remember { mutableStateOf(false) }
    LaunchedEffect(selected) { showUnderline = selected }
    val underline by animateFloatAsState(if (showUnderline) 1f else 0f, tween(220), label = "Auth tab underline")
    Box(modifier.heightIn(min = 48.dp).selectable(selected, enabled = selected || canSwitch,
        role = Role.Tab, onClick = { if (!selected) onClick() }),
        contentAlignment = Alignment.Center) {
        Text(label, color = ink, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp))
        Box(Modifier.align(Alignment.BottomCenter).width(68.dp).height(3.dp)
            .graphicsLayer { scaleX = underline; alpha = underline }
            .background(colors.primary, SautiShape.Pill))
    }
}

@Composable
internal fun AuthPrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: ButtonColors = ButtonDefaults.buttonColors(
        disabledContainerColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .46f),
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant
    ),
    content: @Composable RowScope.() -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    Button(onClick = onClick, enabled = enabled, modifier = modifier.authPress(interaction),
        colors = colors, shape = SautiShape.Pill, interactionSource = interaction, content = content)
}

@Composable
internal fun AuthGoogleButton(onClick: () -> Unit, enabled: Boolean = true) {
    val interaction = remember { MutableInteractionSource() }
    OutlinedButton(onClick = onClick, enabled = enabled, interactionSource = interaction,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).authPress(interaction),
        shape = SautiShape.Pill,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFDADCE0)),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Color.White,
            contentColor = Color(0xFF1F1F1F),
            disabledContainerColor = Color(0xFFF1F3F4),
            disabledContentColor = Color(0xFF5F6368)
        )
    ) {
        Image(painterResource(R.drawable.ic_auth_google), null, Modifier.size(18.dp))
        Spacer(Modifier.width(12.dp))
        Text("Continue with Google", fontWeight = FontWeight.Medium)
    }
}

@Composable
internal fun Modifier.authPress(interaction: MutableInteractionSource): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .975f else 1f, tween(150), label = "Auth press")
    return graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable
internal fun AuthSectionTitle(title: String, icon: ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        SautiIcon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
internal fun authUnderlineColors(): TextFieldColors = TextFieldDefaults.colors(
    focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
    disabledContainerColor = Color.Transparent, errorContainerColor = Color.Transparent,
    unfocusedIndicatorColor = MaterialTheme.colorScheme.outlineVariant
)

@Composable
internal fun authFieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = MaterialTheme.colorScheme.surface,
    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
    disabledContainerColor = MaterialTheme.colorScheme.surface,
    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .65f)
)

/** Compact branding also used when managing an existing session. */
@Composable
internal fun SautiAuthBrand() {
    Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 24.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Image(painterResource(R.drawable.sautilink_logo), null,
            Modifier.size(width = 56.dp, height = 34.dp), contentScale = ContentScale.Fit)
        Spacer(Modifier.width(4.dp))
        SautiWordmark(Modifier.size(width = 105.dp, height = 22.dp))
    }
}
