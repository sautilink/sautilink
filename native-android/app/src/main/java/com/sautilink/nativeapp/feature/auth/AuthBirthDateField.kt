package com.sautilink.nativeapp.feature.auth

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

private val birthDateTransformation = VisualTransformation { text ->
    TransformedText(AnnotatedString(formattedBirthDate(text.text)), object : OffsetMapping {
        override fun originalToTransformed(offset: Int) = birthDateDisplayOffset(offset, text.length)
        override fun transformedToOriginal(offset: Int) = birthDateInputOffset(offset, text.length)
    })
}

@Composable
internal fun AuthBirthDateField(value: String, onValueChange: (String) -> Unit, modifier: Modifier) {
    OutlinedTextField(value = value, onValueChange = { onValueChange(birthDateDigits(it)) },
        label = { Text("Date of birth (DD/MM/YYYY)") }, placeholder = { Text("DD/MM/YYYY") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        visualTransformation = birthDateTransformation, modifier = modifier, singleLine = true)
}
