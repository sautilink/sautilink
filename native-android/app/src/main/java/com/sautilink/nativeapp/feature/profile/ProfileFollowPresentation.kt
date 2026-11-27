package com.sautilink.nativeapp.feature.profile

internal fun updatedProfileFollowerCount(count: Int, before: Boolean, confirmed: Boolean): Int =
    (count.toLong().coerceAtLeast(0) + when {
        before == confirmed -> 0
        confirmed -> 1
        else -> -1
    }).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()

/** Test observer only; no logging, credentials or retained profile data. */
internal object ProfileContentReadProbe {
    @Volatile var observer: ((String) -> Unit)? = null
    fun read(kind: String) { if (com.sautilink.nativeapp.BuildConfig.DEBUG) observer?.invoke(kind) }
}
