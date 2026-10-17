package androidx.compose.ui.text.input
import androidx.compose.ui.text.TextRange
data class TextFieldValue(val text: String, val selection: TextRange = TextRange.Zero,
    val composition: TextRange? = null)
