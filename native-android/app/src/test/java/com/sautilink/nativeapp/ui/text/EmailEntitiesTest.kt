package com.sautilink.nativeapp.ui.text

import org.junit.Assert.*
import org.junit.Test

class EmailEntitiesTest {
    @Test fun emailMentionAndHashtagHaveDisjointExactRanges() {
        val text="Contact team@sautilink.com, @drcharlestz #SautiLink"
        val entities=parseTextEntities(text)
        assertEquals(listOf(TextEntityKind.EMAIL,TextEntityKind.MENTION,TextEntityKind.HASHTAG),entities.map {it.kind})
        assertEquals("team@sautilink.com",text.substring(entities[0].start,entities[0].end))
        assertEquals("drcharlestz",entities[1].target)
        assertTrue(entities.zipWithNext().all { (a,b)->a.end<=b.start })
    }
    @Test fun localUnderscoresPlusAliasesAndPunctuationRemainLiteral() {
        val text="(first_last+news@www.example.co.tz)."
        val email=parseTextEntities(text).single()
        assertEquals(TextEntityKind.EMAIL,email.kind)
        assertEquals("first_last+news@www.example.co.tz",email.target)
        val nodes=parseEntityPostFormatting("__first_last+news@example.com__")
        assertEquals(PostTextFormat.UNDERLINE,nodes.first().format)
        assertEquals("first_last+news@example.com",nodes.first().children.single().text)
    }
    @Test fun emailInsideAWebUrlRemainsOneWebLink() {
        val entities=parseTextEntities("https://example.com/contact/team@sautilink.com?x=1")
        assertEquals(1,entities.size)
        assertEquals(TextEntityKind.URL,entities.single().kind)
    }
    @Test fun invalidAndHeaderLikeAddressesDoNotBecomeEmailActions() {
        listOf("a..b@example.com","a@-example.com","a@example","a@example.c","a@b@c.com",
            "https://user@example.com","a".repeat(65)+"@example.com").forEach {
            assertTrue(it,parseTextEntities(it).none {e->e.kind==TextEntityKind.EMAIL})
        }
        val email=parseTextEntities("team@example.com\nBcc: other@example.com").first()
        assertEquals("team@example.com",email.target)
    }
    @Test fun historicalNestedFormattingStillRendersWithEmailIntact() {
        val nodes=parseEntityPostFormatting("**Welcome *back* home** team_one@example.com")
        assertEquals(PostTextFormat.BOLD,nodes.first().format)
        assertTrue(nodes.first().children.any {it.format==PostTextFormat.ITALIC})
        assertEquals(" team_one@example.com",nodes.last().text)
    }
}
