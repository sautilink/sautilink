package com.sautilink.nativeapp.ui.text

private var checks = 0
private fun verify(value: Boolean, name: String) { check(value) { name }; checks++ }
private fun plain(nodes: List<PostFormatNode>): String = nodes.joinToString("") { it.text ?: plain(it.children) }

fun main() {
    val examples = mapOf(
        "Hello @Cloud_Engine and #Habari_Leo" to listOf("cloud_engine", "#Habari_Leo"),
        "(@foo.bar), @FOO... #Tanzania!" to listOf("foo.bar", "foo", "#Tanzania"),
        "@a_b @a.b #123 #_" to listOf("a_b", "a.b", "#123", "#_"),
        "#世界 #مرحبا #𐐀_2" to listOf("#世界", "#مرحبا", "#𐐀_2"),
        "@ab @a @_foo @.foo" to emptyList(),
        "a@example.com josé@example.com jose\u0301@example.com @foo@bar" to emptyList(),
        "https://sautilink.com/@foo#tag www.example.com/#tag/@foo" to emptyList(),
        "path/@foo path/#tag user@foo name#tag" to emptyList(),
        "@foo世界 @foo\u0301" to emptyList(),
        "#Cafe\u0301 #tag@example.com" to emptyList(),
        "@@foo ##tag" to listOf("#tag"),
        "@${"a".repeat(31)} #${"a".repeat(65)}" to emptyList(),
        "@${"a".repeat(30)} #${"a".repeat(64)}" to listOf("a".repeat(30), "#${"a".repeat(64)}")
    )
    examples.forEach { (source, expected) ->
        val entities = parseTextEntities(source)
        verify(entities.map { it.target } == expected, "entities: $source")
        verify(entities.zipWithNext().all { (a, b) -> a.end <= b.start }, "ordered disjoint ranges")
        verify(entities.all { source.substring(it.start, it.end).first() in "@#" }, "visible UTF16 ranges")
    }
    val unicode = "😀 #𐐀_2 @abc"
    val entities = parseTextEntities(unicode)
    verify(entities[0].start == 3 && unicode.substring(entities[0].start, entities[0].end) == "#𐐀_2", "surrogate-safe offsets")
    verify(entities[1].target == "abc", "mention after supplementary hashtag")
    val formatted = parsePostFormatting("**@foo** and __#Habari_Leo__ with *italic* and ~~strike~~")
    verify(plain(formatted) == "@foo and #Habari_Leo with italic and strike", "formatting text preserved")
    verify(formatted.filter { it.format != null }.map { it.format } == listOf(PostTextFormat.BOLD,
        PostTextFormat.UNDERLINE, PostTextFormat.ITALIC, PostTextFormat.STRIKETHROUGH), "all approved format nodes retained")
    verify(parseTextEntities(plain(formatted)).map { it.target } == listOf("foo", "#Habari_Leo"), "entities in formatted display text")
    verify(parseTextEntities(plain(parsePostFormatting("jos**é**@example.com"))).isEmpty(), "email across formatting boundaries")
    val entityFormatting = mapOf(
        "@cloud__engine__" to ("@cloud__engine__" to "cloud__engine__"),
        "#__topic__" to ("#__topic__" to "#__topic__"),
        "**@cloud__engine__**" to ("@cloud__engine__" to "cloud__engine__"),
        "__@foo__" to ("@foo" to "foo"),
        "__#Tag__" to ("#Tag" to "#Tag"),
        "__@cloud__engine____" to ("@cloud__engine__" to "cloud__engine__"),
        "__#__topic____" to ("#__topic__" to "#__topic__"),
        "__${"@" + "a".repeat(30)}__" to ("@${"a".repeat(30)}" to "a".repeat(30)),
        "__#${"a".repeat(64)}__" to ("#${"a".repeat(64)}" to "#${"a".repeat(64)}"),
        "__hello @cloud__engine__ world__" to ("hello @cloud__engine__ world" to "cloud__engine__")
    )
    entityFormatting.forEach { (source, expected) ->
        val nodes = parseEntityPostFormatting(source)
        val display = plain(nodes)
        verify(display == expected.first, "entity-aware formatting display: $source")
        verify(parseTextEntities(display).single().target == expected.second, "entity-aware exact target: $source")
    }
    verify(parseEntityPostFormatting("**@cloud__engine__**").single().format == PostTextFormat.BOLD, "outer bold retained")
    verify(parseEntityPostFormatting("__@foo__").single().format == PostTextFormat.UNDERLINE, "outer underline retained")
    verify(plain(parsePostFormatting("@cloud__engine__")) == "@cloudengine", "legacy formatter default unchanged")
    verify(plain(parseEntityPostFormatting("**bold** *italic* __underlined__ ~~strike~~")) == "bold italic underlined strike", "ordinary formats unchanged")
    val literal = "Bio **literal** __markers__ #Tag_Name"
    verify(literal.substring(parseTextEntities(literal).single().start) == "#Tag_Name", "literal bio markers retained by parser")
    verify(normalizeExploreQuery("  #Habari_Leo  ") == "#Habari_Leo", "exact hashtag/case/underscore")
    verify(exploreLiteralPattern(normalizeExploreQuery("#Habari_Leo")) == "*#Habari\\_Leo*", "literal underscore filter")
    verify(exploreLiteralPattern("a\\b_c") == "*a\\\\b\\_c*", "literal backslash filter")
    verify(normalizeExploreQuery("*%name_*") == "name_", "input cannot introduce wildcard syntax")
    verify(normalizeExploreQuery("#${"𐐀".repeat(64)}") == "#${"𐐀".repeat(64)}", "full Unicode hashtag query")
    verify(normalizeExploreQuery("#${"a".repeat(65)}") == "#${"a".repeat(64)}", "hashtag query bounded")
    verify(normalizeExploreQuery("a".repeat(65)).length == 64, "ordinary query prior bound")
    verify(limitExploreQueryInput("Dr ") == "Dr " && limitExploreQueryInput("Dr Charles") == "Dr Charles", "keyboard retains multiword spaces")

    // Calls below execute the actual MainActivity route closures extracted by the portable runner.
    val route = EntityRoutesFixture()
    route.detail = "post"; route.notificationPostId = "post-A"; route.postReturn = null
    route.viewedProfileHandle = "source_profile"; route.memberProfileReturn = "notifications"
    route.openEntityHashtag("#Habari_Leo")
    verify(route.detail == "entity-explore" && route.entityExploreQuery == "#Habari_Leo", "post to exact hashtag route")
    route.notificationPostId = "post-B"; route.postReturn = "entity-explore"; route.detail = "post"
    route.detail = route.postReturn // existing Post Back
    route.closeEntityExplore()
    verify(route.detail == "post" && route.notificationPostId == "post-A" && route.postReturn == null, "A tag B Back Explore Back restores A and its return")
    verify(route.viewedProfileHandle == "source_profile" && route.memberProfileReturn == "notifications", "source profile route preserved")
    verify(!route.entityExploreActive, "Explore context released")
    route.detail = "member-profile"; route.viewedProfileHandle = "first_user"; route.memberProfileReturn = "rooms"
    route.openEntityProfile("second_user")
    verify(route.detail == "member-profile" && route.viewedProfileHandle == "second_user" && route.memberProfileReturn == "rooms", "profile mention never self-return")
    route.openEntityHashtag("#First_Tag"); route.openEntityProfile("third_user")
    verify(route.memberProfileReturn == "entity-explore", "Explore profile child returns to Explore")
    route.openEntityHashtag("#Second_Tag"); route.closeEntityExplore()
    verify(route.detail == "member-profile" && route.viewedProfileHandle == "second_user" && route.memberProfileReturn == "rooms", "repeated entity routes keep original snapshot")
    route.openEntityHashtag("https://invalid.example/#no"); route.openEntityProfile("not a handle")
    verify(route.detail == "member-profile" && !route.entityExploreActive, "invalid route targets ignored")
    val mediaRoute = EntityRoutesFixture()
    mediaRoute.detail = "post"; mediaRoute.notificationPostId = "post-A"
    mediaRoute.openEntityHashtag("#First"); mediaRoute.synchronizeDetail()
    mediaRoute.notificationPostId = "post-B"; mediaRoute.postReturn = "entity-explore"; mediaRoute.detail = "post"
    mediaRoute.synchronizeDetail(); mediaRoute.detail = "media"; mediaRoute.synchronizeDetail()
    verify(mediaRoute.entityExploreActive, "existing media child retains original Explore context")
    mediaRoute.detail = "post"; mediaRoute.synchronizeDetail(); mediaRoute.openEntityHashtag("#Second")
    mediaRoute.closeEntityExplore()
    verify(mediaRoute.detail == "post" && mediaRoute.notificationPostId == "post-A" && mediaRoute.postReturn == null,
        "media child and repeated hashtag restore original A")
    mediaRoute.openEntityHashtag("#Again"); mediaRoute.detail = "menu"; mediaRoute.synchronizeDetail()
    verify(!mediaRoute.entityExploreActive, "menu abandons prior entity context")
    val canonicalRoute = EntityRoutesFixture()
    canonicalRoute.detail = "entity-explore"
    canonicalRoute.openEntityProfile("FOO.")
    verify(canonicalRoute.detail == "member-profile" && canonicalRoute.viewedProfileHandle == "foo." &&
        canonicalRoute.memberProfileReturn == "entity-explore", "canonical registered terminal-dot target preserved")
    canonicalRoute.openEntityProfile("CLOUD__ENGINE__")
    verify(canonicalRoute.viewedProfileHandle == "cloud__engine__" && canonicalRoute.memberProfileReturn == "entity-explore",
        "canonical underscore target and prior Back destination preserved")
    println("PASS $checks native text entity/format/query/actual-route checks")
}
