package com.sautilink.nativeapp.ui.components

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativePlaybackBootstrapTest {
    private val origin = "https://sautilink.com"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val path = "/api/sauti-media/$id"
    private val now = 1_792_540_000_000L
    private fun url(name: String) = "$origin$path/hls/$name?c=payload.${"a".repeat(43)}"
    private val master get() = url("m_master")
    private val video get() = url("m_video")
    private val audio get() = url("m_audio")
    private fun row(uri: String, body: String) = JSONObject().put("url", uri).put("body", body)
    private fun bundle(vararg rows: JSONObject) = JSONObject().put("playlists", JSONArray(rows.toList()))
    private fun valid() = bundle(
        row(master, "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",URI=\"$audio\"\n#EXT-X-STREAM-INF:BANDWIDTH=300000,AUDIO=\"a\"\n$video\n"),
        row(video, "#EXTM3U\n#EXT-X-MAP:URI=\"${url("s_init")}\"\n#EXTINF:2.0,\n${url("s_video")}\n#EXT-X-ENDLIST\n"),
        row(audio, "#EXTM3U\n#EXTINF:2.0,\n${url("s_audio")}\n#EXT-X-ENDLIST\n"),
    )
    private fun parsed(value: JSONObject = valid()) = parseNativePlaybackBootstrap(origin, path, master, value, now)
    private fun box(type: String, payload: ByteArray) = java.nio.ByteBuffer.allocate(payload.size + 8)
        .putInt(payload.size + 8).put(type.toByteArray(Charsets.US_ASCII)).put(payload).array()
    private fun codecOnly() = box("ftyp", "isom0000".toByteArray()) + box("moov", box("mvhd", ByteArray(8)))

    @Test fun exactRewrittenMasterAndChildAreConsumedOnce_withoutLosingAdaptiveMaster() {
        val initial = requireNotNull(parsed())
        val source = NativeVideoSource(id, master, true, now + 300_000L, bootstrap = initial)
        val grants = NativeHlsGrantRegistry { now }
        grants.authorize(source)
        val bytes = requireNotNull(grants.consumeBootstrap(master)).toString(Charsets.UTF_8)
        assertTrue(bytes.contains("EXT-X-STREAM-INF")); assertTrue(bytes.contains(video)); assertTrue(bytes.contains(audio))
        assertNull(grants.consumeBootstrap(master))
        grants.authorize(source)
        assertNull("Reauthorizing the same source cannot replay its consumed manifest", grants.consumeBootstrap(master))
        assertNotNull(grants.consumeBootstrap(video)); assertNotNull(grants.consumeBootstrap(audio))
        assertNull(grants.consumeBootstrap(url("s_video")))
    }

    @Test fun exactCapabilityAndLiveGrantAreRequired_evenForInMemoryBytes() {
        var clock = now
        val grants = NativeHlsGrantRegistry { clock }
        val source = NativeVideoSource(id, master, true, now + 300_000L, bootstrap = parsed())
        assertNull(grants.consumeBootstrap(master))
        grants.authorize(source)
        assertNull(grants.consumeBootstrap(master.replace("c=payload.", "c=different.")))
        assertNull(grants.consumeBootstrap(master.replace(origin, "https://foreign.test")))
        assertNull(grants.consumeBootstrap(master.replace(id, "00000000-0000-4000-8000-000000000002")))
        clock += 5_000L
        assertNull(grants.consumeBootstrap(master))
        clock = now; grants.authorize(source)
        assertNull("An expired bundle is erased even if the wall clock moves back", grants.consumeBootstrap(master))
        grants.authorize(source.copy(bootstrap = parsed())); grants.clear()
        assertNull(grants.consumeBootstrap(master))
    }

    @Test fun realGatewayRootRelativeUrisResolveOnlyWithinTheExactFirstPartyContent() {
        val relative = bundle(row(master.removePrefix(origin), "#EXTM3U\n#EXT-X-MEDIA:URI=\"${audio.removePrefix(origin)}\"\n${video.removePrefix(origin)}\n"),
            row(video.removePrefix(origin), "#EXTM3U\n${url("s_video").removePrefix(origin)}\n"))
        val initial = requireNotNull(parsed(relative))
        assertNotNull(initial.consume(master, now + 300_000L, now))
        assertNotNull(initial.consume(video, now + 300_000L, now))
        assertNull(parsed(bundle(row(master, "#EXTM3U\n//foreign.test/video.m3u8\n"))))
        assertNull(parsed(bundle(row(master, "#EXTM3U\n/api/stories/$id/hls/m_other?c=payload.${"a".repeat(43)}\n"))))
    }

    @Test fun malformedOptionalBundleIsIgnored_withoutTurningPlaybackIntoAnError() {
        val invalid = listOf(
            bundle(row(video, "#EXTM3U\n")), // Missing the exact master.
            bundle(row(master, "#EXTM3U\nhttps://foreign.test/video.m3u8\n")),
            bundle(row(master, "#EXTM3U\n../private.m3u8\n")),
            bundle(row(master, "#EXTM3U\n${url("m_video")}&extra=foreign\n")),
            bundle(row(master, "#EXTM3U\n#EXT-X-MEDIA:URI=https://foreign.test/audio.m3u8\n")),
            bundle(row(master, "#EXTM3U\n#EXT-X-MEDIA:URI=\"https://foreign.test/audio.m3u8\"\n")),
            bundle(row(master, "#EXTM3U\n#EXT-X-MEDIA:uri=\"$audio\"\n")),
            bundle(row(master, "#EXTM3U\n"), row(master, "#EXTM3U\n")),
            bundle(row(url("s_segment"), "#EXTM3U\n"), row(master, "#EXTM3U\n")),
        )
        invalid.forEach { value ->
            assertNull(parsed(value))
            val body = JSONObject().put("ok", true).put("data", JSONObject().put("type", "hls").put("url", master)
                .put("expires_at", java.time.Instant.ofEpochMilli(now + 300_000L)).put("bootstrap", value)).toString()
            val source = parseNativeVideoSource(origin, "$path/playback", body, now)
            assertTrue(source.hls); assertNull(source.bootstrap)
        }
    }

    @Test fun countAndActualUtf8BytesAreBounded_andNeverAcceptSegmentPayloads() {
        assertNull(parsed(bundle(*(0..9).map { row(if (it == 0) master else url("m_$it"), "#EXTM3U\n") }.toTypedArray())))
        // Fewer than256Ki characters still exceeds256KiB when UTF8 encoded.
        assertNull(parsed(bundle(row(master, "#EXTM3U\n#" + "é".repeat(140_000)))))
        assertNull(parsed(bundle(row(master, "not a playlist or video bytes"))))
        val oldMonotonic = NativePlaybackBootstrap(linkedMapOf(master to "#EXTM3U\n".toByteArray()), now,
            System.nanoTime() - 20_000_000_000L)
        assertNull(oldMonotonic.consume(master, now + 300_000L, now))
    }

    @Test fun onlyMapReferencedCodecInitializationCanBeConsumedOnce_withTheSameGrantGuards() {
        val bytes = codecOnly()
        val value = valid().put("initializations", JSONArray().put(JSONObject().put("url", url("s_init").removePrefix(origin))
            .put("base64", java.util.Base64.getEncoder().encodeToString(bytes))))
        val initial = requireNotNull(parsed(value))
        val grants = NativeHlsGrantRegistry { now }
        grants.authorize(NativeVideoSource(id, master, true, now + 300_000L, bootstrap = initial))
        assertTrue(grants.isBootstrapInitialization(url("s_init")))
        assertArrayEquals(bytes, grants.consumeBootstrap(url("s_init")))
        assertNull(grants.consumeBootstrap(url("s_init")))
        assertNotNull(grants.consumeBootstrap(master))
        grants.clear(); assertFalse(grants.isBootstrapInitialization(url("s_init")))
        assertNull(grants.consumeBootstrap(url("s_init")))
    }

    @Test fun badOptionalInitDropsOnlyTheInitExtension_whileMasterAndChildRemainUsable() {
        val b64 = java.util.Base64.getEncoder().encodeToString(codecOnly())
        val invalid = listOf(
            JSONArray().put(JSONObject().put("url", url("s_video")).put("base64", b64)), // A sample URI is not MAP.
            JSONArray().put(JSONObject().put("url", url("s_init")).put("base64", "bad base64")),
            JSONArray().put(JSONObject().put("url", url("s_init")).put("base64", java.util.Base64.getEncoder()
                .encodeToString(codecOnly() + box("mdat", ByteArray(8))))),
            JSONArray().put(JSONObject().put("url", url("m_video")).put("base64", b64)),
            JSONArray().apply { repeat(9) { put(JSONObject().put("url", url("s_init")).put("base64", b64)) } },
        )
        invalid.forEach { rows ->
            val initial = requireNotNull(parsed(valid().put("initializations", rows)))
            assertNull(initial.consume(url("s_init"), now + 300_000L, now))
            assertNotNull(initial.consume(master, now + 300_000L, now))
            assertNotNull(initial.consume(video, now + 300_000L, now))
        }
    }

    @Test fun isoBoxValidationRejectsMediaFragmentsOverflowAndTrailingBytes() {
        val bytes = codecOnly()
        assertTrue(nativePlaybackInitialization(bytes))
        for (type in listOf("mdat", "moof", "free")) assertFalse(nativePlaybackInitialization(bytes + box(type, ByteArray(8))))
        assertFalse(nativePlaybackInitialization(bytes + byteArrayOf(0)))
        assertFalse(nativePlaybackInitialization(bytes.copyOf(bytes.size - 1)))
        assertFalse(nativePlaybackInitialization(bytes.copyOf().also { it.fill(255.toByte(), 0, 4) }))
        assertFalse(nativePlaybackInitialization(box("ftyp", ByteArray(8)) + box("moov", ByteArray(16_384))))
        val extended = java.nio.ByteBuffer.allocate(24).putInt(1).put("ftyp".toByteArray()).putLong(24).put(ByteArray(8)).array()
        assertTrue(nativePlaybackInitialization(extended + box("moov", box("mvhd", ByteArray(8)))))
        assertFalse(nativePlaybackInitialization(extended.copyOf().also { it[8] = 1 } + box("moov", ByteArray(8))))
    }
}
