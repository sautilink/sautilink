package com.sautilink.nativeapp.feature.posts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.Alignment
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction

@Composable
@OptIn(ExperimentalTextApi::class)
internal fun NativeCreatorTextControls(text: NativeCreatorText, enabled: Boolean, onChange: (NativeCreatorText) -> Unit) {
    val focus = LocalFocusManager.current
    OutlinedTextField(text.text, { onChange(text.copy(text = it.take(300))) }, Modifier.fillMaxWidth(),
        label = { Text("Text on media") }, placeholder = { Text("Tell your story") }, enabled = enabled,
        maxLines = 4, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
        supportingText = { Text("${text.text.length}/300") })
    var fontsOpen by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { focus.clearFocus(); fontsOpen = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
            Text("Font · ${text.font.label}", fontFamily = FontFamily(Font(text.font.resource, variationSettings = FontVariation.Settings(FontVariation.weight(400)))))
        }
        DropdownMenu(fontsOpen, { fontsOpen = false }, modifier = Modifier.heightIn(max = 340.dp)) {
            NativeCreatorFont.entries.forEach { font ->
                DropdownMenuItem(text = { Text(font.label, fontFamily = FontFamily(Font(font.resource, variationSettings = FontVariation.Settings(FontVariation.weight(400))))) },
                    onClick = { onChange(text.copy(font = font)); fontsOpen = false })
            }
        }
    }
    Row(Modifier.fillMaxWidth().toggleable(text.bold, enabled = enabled, role = Role.Switch,
        onValueChange = { focus.clearFocus(); onChange(text.copy(bold = it)) }), verticalAlignment = Alignment.CenterVertically) {
        Text("Bold", Modifier.weight(1f))
        Switch(text.bold, onCheckedChange = null, enabled = enabled)
    }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("No card" to android.graphics.Color.TRANSPARENT, "Dark card" to 0xD9000000.toInt(),
            "Light card" to 0xEBFFFFFF.toInt(), "Pink card" to 0xE6E83170.toInt(), "Orange card" to 0xE6F26B38.toInt()).forEach { (name, color) ->
            FilterChip(text.cardColor == color, { focus.clearFocus(); onChange(text.copy(cardColor = color)) }, enabled = enabled, label = { Text(name) })
        }
    }
    Text("Text color", style = MaterialTheme.typography.labelLarge)
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf("White" to 0xFFFFFFFF, "Black" to 0xFF111111, "Orange" to 0xFFF26B38,
            "Pink" to 0xFFE83170, "Yellow" to 0xFFFFD54F, "Mint" to 0xFF7CE6BA,
            "Blue" to 0xFF56B4FF, "Purple" to 0xFFB39DFF).forEach { (name, value) ->
            val color = value.toInt()
            androidx.compose.foundation.layout.Box(Modifier.size(36.dp).clip(CircleShape).background(Color(color), CircleShape)
                .border(if (text.color == color) 3.dp else 1.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
                .semantics { selected = text.color == color }
                .clickable(enabled = enabled, onClickLabel = "$name text") { focus.clearFocus(); onChange(text.copy(color = color)) }
                .then(Modifier.semanticsColor(name)))
        }
    }
    CreatorSlider("Text size", text.size, .025f.. .16f, enabled) { onChange(text.copy(size = it)) }
    CreatorSlider("Text horizontal position", text.x, 0f..1f, enabled) { onChange(text.copy(x = it)) }
    CreatorSlider("Text vertical position", text.y, 0f..1f, enabled) { onChange(text.copy(y = it)) }
    TextButton(onClick = { onChange(NativeCreatorText()) }, enabled = enabled) { Text("Remove text") }
}

private fun Modifier.semanticsColor(name: String): Modifier = this.then(
    Modifier.semantics { contentDescription = "$name text color" })

@Composable
internal fun CreatorSlider(label: String, value: Float, range: ClosedFloatingPointRange<Float>, enabled: Boolean,
    onChange: (Float) -> Unit) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Slider(value.coerceIn(range.start, range.endInclusive), onChange, enabled = enabled, valueRange = range,
            modifier = Modifier.semantics { contentDescription = label })
    }
}
