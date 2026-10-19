package com.sautilink.nativeapp.feature.auth

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarToday
import androidx.compose.material.icons.rounded.Cake
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val birthDateTransformation = VisualTransformation { text ->
    TransformedText(AnnotatedString(formattedBirthDate(text.text)), object : OffsetMapping {
        override fun originalToTransformed(offset: Int) = birthDateDisplayOffset(offset, text.length)
        override fun transformedToOriginal(offset: Int) = birthDateInputOffset(offset, text.length)
    })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AuthBirthDateField(value: String, onValueChange: (String) -> Unit, modifier: Modifier) {
    var calendarOpen by remember { mutableStateOf(false) }
    OutlinedTextField(value = value, onValueChange = { onValueChange(birthDateDigits(it)) },
        label = { Text("Date of birth") }, placeholder = { Text("DD/MM/YYYY") },
        leadingIcon = { Icon(Icons.Rounded.Cake, null, Modifier.size(21.dp)) },
        trailingIcon = { IconButton(onClick = { calendarOpen = true }) {
            Icon(Icons.Rounded.CalendarToday, "Choose date of birth", Modifier.size(21.dp))
        } },
        shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        visualTransformation = birthDateTransformation, modifier = modifier, singleLine = true)
    if (calendarOpen) {
        val selected = remember(value) {
            signupBirthDateIso(value)?.let { runCatching {
                LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
            }.getOrNull() }
        }
        val picker = rememberDatePickerState(initialSelectedDateMillis = selected,
            yearRange = 1900..LocalDate.now().year,
            selectableDates = remember { object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                        .isAfter(LocalDate.now())
            } })
        DatePickerDialog(onDismissRequest = { calendarOpen = false },
            shape = RoundedCornerShape(28.dp),
            confirmButton = { TextButton(enabled = picker.selectedDateMillis != null, onClick = {
                picker.selectedDateMillis?.let { millis ->
                    val date = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
                    onValueChange(date.format(DateTimeFormatter.ofPattern("ddMMyyyy", Locale.ROOT)))
                }
                calendarOpen = false
            }) { Text("Use date") } },
            dismissButton = { TextButton(onClick = { calendarOpen = false }) { Text("Cancel") } }) {
            DatePicker(state = picker, showModeToggle = true)
        }
    }
}
