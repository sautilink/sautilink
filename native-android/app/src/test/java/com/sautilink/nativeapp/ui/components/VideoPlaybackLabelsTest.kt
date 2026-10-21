package com.sautilink.nativeapp.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class VideoPlaybackLabelsTest {
    @Test fun timelineUsesMinutesAndHours_andNeverDisplaysNegativeUnsetTime() {
        assertEquals("0:00", videoTimeLabel(Long.MIN_VALUE + 1))
        assertEquals("0:08", videoTimeLabel(8_999L))
        assertEquals("1:02", videoTimeLabel(62_000L))
        assertEquals("1:01:01", videoTimeLabel(3_661_000L))
    }

    @Test fun autoLabelRequiresMeasuredDecodedQuality_manualChoiceRemainsExplicit() {
        assertEquals("Auto", videoQualityLabel("auto", null))
        assertEquals("Auto · 360p", videoQualityLabel("auto", "360"))
        assertEquals("720p", videoQualityLabel("720", "360"))
        assertEquals("Original", videoQualityLabel("original", "720"))
        assertEquals("Normal", videoSpeedLabel(1f))
        assertEquals("1.5×", videoSpeedLabel(1.5f))
    }
}
