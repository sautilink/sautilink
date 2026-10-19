package android.content

import android.net.Uri

// JVM-only Android boundary; no Android code or I/O is exercised by the cache regression.
open class Context {
    val applicationContext get() = this
    val contentResolver = ContentResolver()
}
class ContentResolver { fun getType(uri: Uri): String? = error("Unexpected media read") }
