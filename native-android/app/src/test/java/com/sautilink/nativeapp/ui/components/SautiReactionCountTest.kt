package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class SautiReactionCountTest {
    @Test fun textSummariesAlsoOmitEmptyMetricsAndUseTheSameNotation() {
        assertEquals("", sautiPostReactionSummary(0,0,0))
        assertEquals("1 comment", sautiPostReactionSummary(0,1,0))
        assertEquals("1k likes · 1.1k comments · 10k reposts", sautiPostReactionSummary(1000,1100,10000))
    }
    @Test fun zeroIsHiddenAndTheFirstReactionShowsOne() {
        assertNull(sautiReactionCount(0)); assertNull(sautiReactionCount(-1))
        assertEquals("1", sautiReactionCount(1)); assertEquals("999", sautiReactionCount(999))
    }
    @Test fun thousandsUseOneDecimalOnlyWhenNeeded() {
        mapOf(1000 to "1k", 1100 to "1.1k", 1200 to "1.2k", 10000 to "10k", 10500 to "10.5k", 100000 to "100k")
            .forEach { (value, label) -> assertEquals(label, sautiReactionCount(value)) }
    }
    @Test fun formattingNeverOverstatesTheActualTotal() {
        assertEquals("1k", sautiReactionCount(1099)); assertEquals("1.1k", sautiReactionCount(1199))
        assertEquals("999.9k", sautiReactionCount(999999))
    }
    @Test fun millionAndBillionBoundariesRemainCompactAndDoNotOverflow() {
        assertEquals("1m", sautiReactionCount(1000000)); assertEquals("1.2m", sautiReactionCount(1200000))
        assertEquals("1b", sautiReactionCount(1000000000)); assertEquals("2.1b", sautiReactionCount(Int.MAX_VALUE))
    }
}
