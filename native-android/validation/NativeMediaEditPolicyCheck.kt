package com.sautilink.nativeapp.feature.posts

fun main() {
    check(NativeMediaEditPolicy.trim(240_000) == NativeMediaEditPolicy.Trim(0, 180_000))
    check(NativeMediaEditPolicy.trim(180_000, 120_000) == NativeMediaEditPolicy.Trim(120_000, 180_000))
    check(NativeMediaEditPolicy.trim(500) == NativeMediaEditPolicy.Trim(0, 500))
    check(!NativeMediaEditPolicy.validTrim(240_000, 0, 180_001))
    check(!NativeMediaEditPolicy.validTrim(60_000, -1, 10_000))
    check(!NativeMediaEditPolicy.validTrim(60_000, 20_000, 10_000))
    check(!NativeMediaEditPolicy.validTrim(60_000, 10_000, 60_001))
    for (duration in listOf(1L, 999L, 1_000L, 59_999L, 60_000L, 61_000L, 3_600_000L)) {
        for (start in listOf(-1L, 0L, duration / 2, duration, Long.MAX_VALUE)) {
            for (length in listOf(-1L, 1L, 1_000L, 60_000L, Long.MAX_VALUE)) {
                val clip = NativeMediaEditPolicy.trim(duration, start, length)
                check(NativeMediaEditPolicy.validTrim(duration, clip.startMs, clip.endMs)) { "$duration $start $length -> $clip" }
            }
        }
    }
    check(NativeMediaEditPolicy.crop(1600, 900, 1f, 1f, -1f, 0f) == NativeMediaEditPolicy.Crop(0, 0, 900, 900))
    check(NativeMediaEditPolicy.crop(1600, 900, 1f, 1f, 1f, 0f) == NativeMediaEditPolicy.Crop(700, 0, 900, 900))
    check(NativeMediaEditPolicy.crop(1600, 900, null, 1f, 0f, 0f) == NativeMediaEditPolicy.Crop(0, 0, 1600, 900))
    for (width in listOf(1, 17, 900, 2048)) for (height in listOf(1, 19, 1600, 2048)) {
        for (ratio in listOf(null, .8f, 1f, 16f / 9f)) for (zoom in listOf(0f, 1f, 2f, 3f, Float.NaN)) {
            for (pan in listOf(-4f, -1f, 0f, 1f, 4f, Float.NaN)) {
                val crop = NativeMediaEditPolicy.crop(width, height, ratio, zoom, pan, -pan)
                check(crop.width in 1..width && crop.height in 1..height)
                check(crop.left >= 0 && crop.top >= 0 && crop.left + crop.width <= width && crop.top + crop.height <= height)
            }
        }
    }
    println("Native media edit policy checks passed")
}
