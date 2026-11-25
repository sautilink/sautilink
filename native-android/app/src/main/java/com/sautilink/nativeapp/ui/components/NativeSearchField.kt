package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One compact, borderless search field across discovery, chats and libraries. */
@Composable
internal fun NativeSearchField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    placeholder: String = "Search...", enabled: Boolean = true, onSearch: (() -> Unit)? = null) {
    val colors = MaterialTheme.colorScheme
    val keyboard = LocalSoftwareKeyboardController.current
    BasicTextField(value, onValueChange, modifier.fillMaxWidth().heightIn(min = 44.dp), enabled = enabled,
        singleLine = true, textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, color = colors.onSurface),
        cursorBrush = SolidColor(colors.primary), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke(); keyboard?.hide() }),
        decorationBox = { editor ->
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp)
                .background(colors.surfaceContainerHighest, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Icon(Icons.Rounded.Search, null, Modifier.size(19.dp), tint = colors.onSurface)
                Box(Modifier.weight(1f).padding(vertical = 9.dp)) {
                    if (value.isEmpty()) Text(placeholder, color = colors.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp))
                    editor()
                }
                if (value.isNotEmpty()) IconButton(onClick = { onValueChange("") }, enabled = enabled, modifier = Modifier.size(30.dp)) {
                    Icon(Icons.Rounded.Close, "Clear search", Modifier.size(17.dp), tint = colors.onSurface)
                }
            }
        })
}
