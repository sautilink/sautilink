package com.sautilink.nativeapp.ui.components

fun main() {
    val cases = listOf(
        0f to VideoDoubleTapAction.BACKWARD,
        419f to VideoDoubleTapAction.BACKWARD,
        420f to VideoDoubleTapAction.LIKE,
        500f to VideoDoubleTapAction.LIKE,
        580f to VideoDoubleTapAction.LIKE,
        581f to VideoDoubleTapAction.FORWARD,
        1000f to VideoDoubleTapAction.FORWARD
    )
    for ((x, action) in cases) check(videoDoubleTapAction(x, 1000) == action)
    check(videoDoubleTapAction(0f, 0) == VideoDoubleTapAction.LIKE)
    check(videoDoubleTapAction(200f, 1000) != videoDoubleTapAction(800f, 1000))
    check(videoDoubleTapAction(200f, 1000) != videoDoubleTapAction(500f, 1000))
    check(videoSeekTarget(12_000L, -5_000L, 60_000L) == 7_000L)
    check(videoSeekTarget(12_000L, 5_000L, 60_000L) == 17_000L)
    check(videoSeekTarget(2_000L, -5_000L, 60_000L) == 0L)
    check(videoSeekTarget(58_000L, 5_000L, 60_000L) == 60_000L)
    check(videoSeekTarget(0L, -5_000L, 60_000L) == 0L)
    check(videoSeekTarget(12_000L, 5_000L, -9223372036854775807L) == 17_000L)
    check(videoSeekTarget(12_000L, 5_000L, 0L) == 17_000L)
    println("PASS: video gesture zones, cross-zone rejection boundaries and five-second seek clamping.")
}
