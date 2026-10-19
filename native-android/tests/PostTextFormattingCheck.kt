package com.sautilink.nativeapp.ui.text

import java.util.Base64

// Standalone JVM harness: test the production Kotlin implementation without
// Android/JUnit dependencies or an APK build.
private fun quoted(value: String): String = buildString {
    append('"')
    value.forEach { character ->
        when (character) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (character.code < 32) append("\\u" + character.code.toString(16).padStart(4, '0'))
                else append(character)
        }
    }
    append('"')
}

private fun nodesJson(nodes: List<PostFormatNode>): String = nodes.joinToString(prefix = "[", postfix = "]") { node ->
    if (node.format != null) "{\"tag\":" + quoted(node.format.webTag) + ",\"children\":" + nodesJson(node.children) + "}"
    else "{\"text\":" + quoted(node.text.orEmpty()) + "}"
}

fun main(args: Array<String>) {
    System.setOut(java.io.PrintStream(System.out, true, Charsets.UTF_8))
    val text = String(Base64.getDecoder().decode(args[1]), Charsets.UTF_8)
    when (args[0]) {
        "parse" -> println(nodesJson(parsePostFormatting(text, args.getOrNull(2)?.toInt() ?: 0)))
        "insert" -> {
            val insertion = insertPostFormatting(text, args[2].toInt(), args[3].toInt(), PostTextFormat.valueOf(args[4]))
            println(if (insertion == null) "null" else "{\"text\":" + quoted(insertion.text) +
                ",\"selectionStart\":" + insertion.selectionStart + ",\"selectionEnd\":" + insertion.selectionEnd + "}")
        }
        else -> error("Unknown check mode")
    }
}
