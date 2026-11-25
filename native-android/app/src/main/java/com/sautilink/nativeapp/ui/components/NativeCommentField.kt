package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Matches the music search field's compact surface while retaining selection, mentions and multiline editing. */
@Composable
internal fun NativeCommentField(value: TextFieldValue, onValueChange: (TextFieldValue) -> Unit,
    modifier: Modifier = Modifier, placeholder: String = "Write a comment...", enabled: Boolean = true,
    counter: String? = null) {
    val colors = MaterialTheme.colorScheme
    Column(modifier) {
        BasicTextField(value, onValueChange, enabled = enabled, maxLines = 3,
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
                .background(colors.surfaceContainerHighest, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp, color = colors.onSurface),
            cursorBrush = SolidColor(colors.primary),
            decorationBox = { editor ->
                Box {
                    if (value.text.isEmpty()) Text(placeholder, color = colors.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp))
                    editor()
                }
            })
        if (counter != null) Text(counter, Modifier.padding(start = 12.dp, top = 2.dp),
            style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
    }
}
