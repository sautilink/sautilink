package androidx.compose.ui.text
data class TextRange(val start: Int, val end: Int = start) {
    companion object { val Zero = TextRange(0) }
}
