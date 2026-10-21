package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class NativeStartupServerTimingTest {
    @Test fun onlyFourFixedNumericServerMetricsAreExposedToTheOperator() {
        assertEquals(mapOf(NativeVideoServerTiming.RLS to 123.4, NativeVideoServerTiming.READY to 210.0,
            NativeVideoServerTiming.HLS to 52.8, NativeVideoServerTiming.EDGE to 600.5),
            nativeVideoServerTimings(mapOf("sErVeR-tImInG" to listOf("rls;dur=123.4,ready;dur=210.0,hls;dur=52.8,edge;dur=600.5"))))
        assertTrue(nativeVideoServerTimings(mapOf("Server-Timing" to listOf(
            "token;dur=1,rls;dur=NaN,ready;dur=-1,hls;dur=9999999,edge;dur=3;desc=\"https://secret.test/token\""))).isEmpty())
        assertTrue(nativeVideoServerTimings(mapOf("Server-Timing" to listOf("x".repeat(5_000)))).isEmpty())
    }
}
