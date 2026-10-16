package com.sautilink.nativeapp.ui.components

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.lang.reflect.Proxy
import java.net.ProtocolException

private const val URI = "https://sautilink.com/api/sauti-media/123e4567-e89b-42d3-a456-426614174000"
private const val CHUNK = 1_048_576
private val original = ByteArray(3 * CHUNK + 137) { (it % 251).toByte() }
private val rendition = ByteArray(CHUNK / 2) { 77 }

/** Actual Media3 DataSpec/API and product adapter; deterministic HTTP responses, no hosted requests. */
private class Server {
    var warming = false
    var mutate = false
    var truncate = false
    var missingEtag = false
    var wrongRange = false
    var full200 = false
    var fail = false
    var calls = 0
    var closes = 0
    val requests = mutableListOf<DataSpec>()
    var lastHeaders: Map<String, List<String>> = emptyMap()
    var status = 206
    var activeUri: Uri? = null
    private var body = byteArrayOf()
    private var cursor = 0
    fun http(): HttpDataSource = Proxy.newProxyInstance(HttpDataSource::class.java.classLoader,
        arrayOf(HttpDataSource::class.java)) { _, method, args ->
        when (method.name) {
            "open" -> {
                val spec = args!![0] as DataSpec
                calls++; requests += spec; activeUri = spec.uri
                if (fail) throw HttpDataSource.HttpDataSourceException(IOException("synthetic HTTP 500"), spec, 2004, 1)
                val useVariant = spec.uri.encodedQuery != null && warming && calls > 1
                val bytes = if (useVariant) rendition else original
                // The old unpinned quality URL can move an original offset beyond a warmed variant.
                if (spec.position >= bytes.size) throw HttpDataSource.HttpDataSourceException(
                    IOException("synthetic R2 InvalidRange -> HTTP 500"), spec, 2004, 1)
                val available = bytes.size.toLong() - spec.position
                val requested = if (spec.length < 0) available else minOf(available, spec.length)
                val count = if (full200) requested else minOf(requested, CHUNK.toLong())
                body = bytes.copyOfRange(spec.position.toInt(), (spec.position + count).toInt())
                if (truncate) body = body.copyOf(body.size - 1)
                cursor = 0; status = if (full200) 200 else 206
                lastHeaders = buildMap {
                    put("Content-Type", listOf("video/mp4"))
                    put("Content-Length", listOf(if (full200) bytes.size.toString() else count.toString()))
                    if (!full200) put("Content-Range", listOf("bytes ${spec.position + if (wrongRange) 1 else 0}-${spec.position + count - 1}/${bytes.size}"))
                    if (!missingEtag) put("ETag", listOf(if (mutate && calls > 1) "changed" else if (useVariant) "rendition" else "original"))
                    put("X-Sauti-Media-Variant", listOf(if (useVariant) "video-v2;q=360" else "original"))
                }
                if (full200) requested else count
            }
            "read" -> {
                val buffer = args!![0] as ByteArray; val offset = args[1] as Int; val wanted = args[2] as Int
                val count = minOf(wanted, body.size - cursor)
                if (wanted == 0) 0 else if (count == 0) C.RESULT_END_OF_INPUT else {
                    body.copyInto(buffer, offset, cursor, cursor + count); cursor += count; count
                }
            }
            "close" -> { closes++; null }
            "getUri" -> activeUri
            "getResponseHeaders" -> lastHeaders
            "getResponseCode" -> status
            "addTransferListener", "setRequestProperty", "clearRequestProperty", "clearAllRequestProperties" -> null
            else -> error("Unexpected HTTP operation: ${method.name}")
        }
    } as HttpDataSource
    fun factory(): NativeVideoDataSourceFactory {
        val factory = Proxy.newProxyInstance(HttpDataSource.Factory::class.java.classLoader,
            arrayOf(HttpDataSource.Factory::class.java)) { _, method, _ ->
            if (method.name == "createDataSource") http() else error("Unexpected factory call")
        } as HttpDataSource.Factory
        return NativeVideoDataSourceFactory(factory)
    }
}

private fun spec(position: Long = 0, length: Long = -1, quality: Boolean = true) = DataSpec.Builder()
    .setUri(Uri.parse(URI + if (quality) "?quality=360" else "")).setPosition(position).setLength(length)
    .setHttpRequestHeaders(mapOf("Authorization" to "Bearer local.fixture.only")).build()

private fun readAll(source: DataSource): ByteArray {
    val out = ByteArrayOutputStream(); val buffer = ByteArray(63_789)
    while (true) {
        val count = source.read(buffer, 0, buffer.size)
        if (count == C.RESULT_END_OF_INPUT) return out.toByteArray()
        check(count > 0); out.write(buffer, 0, count)
    }
}

fun main() {
    var checks = 0
    fun checked(ok: Boolean) { check(ok); checks++ }
    fun fails(block: () -> Unit) { try { block(); error("Expected failure") } catch (_: IOException) { checks++ } }

    val oldServer = Server().apply { warming = true }; val old = oldServer.http()
    checked(old.open(spec()) == CHUNK.toLong())
    checked(readAll(old).size == CHUNK); old.close()
    fails { old.open(spec(CHUNK.toLong())) }; old.close()

    // Reproduce the observed 1 MiB boundary; the fixed adapter presents every source byte in order.
    val server = Server(); val source = server.factory().createDataSource()
    checked(source.open(spec(48)) == original.size - 48L)
    checked(readAll(source).contentEquals(original.copyOfRange(48, original.size)))
    checked(server.calls == 4)
    checked(server.requests.all { it.httpRequestHeaders["Authorization"] == "Bearer local.fixture.only" })
    checked(server.requests.map { it.position } == listOf(48L, 48L + CHUNK, 48L + 2 * CHUNK, 48L + 3 * CHUNK))
    source.close(); checked(server.closes == server.calls)

    // Cold original -> warmed smaller rendition: pin before the next chunk and retain across seeks.
    val cold = Server().apply { warming = true }; val factory = cold.factory(); val stream = factory.createDataSource()
    checked(stream.open(spec()) == original.size.toLong())
    checked(readAll(stream).contentEquals(original)); stream.close()
    checked(cold.requests.drop(1).all { it.uri.encodedQuery == null })
    val seek = factory.createDataSource()
    checked(seek.open(spec(2L * CHUNK)) == original.size - 2L * CHUNK)
    checked(readAll(seek).contentEquals(original.copyOfRange(2 * CHUNK, original.size))); seek.close()
    checked(cold.requests.last().uri.encodedQuery == null)

    val bounded = Server(); val part = bounded.factory().createDataSource()
    checked(part.open(spec(17, CHUNK + 100L)) == CHUNK + 100L)
    checked(readAll(part).contentEquals(original.copyOfRange(17, 17 + CHUNK + 100))); part.close()
    checked(bounded.calls == 2)

    // HTTP 200 ignores Range; document length must remain correct even for a bounded request.
    val full = Server().apply { full200 = true }; val fullFactory = full.factory()
    val small = fullFactory.createDataSource(); checked(small.open(spec(0, 19)) == 19L)
    checked(readAll(small).contentEquals(original.copyOfRange(0, 19))); small.close()
    val later = fullFactory.createDataSource(); checked(later.open(spec(CHUNK.toLong())) == original.size - CHUNK.toLong())
    checked(readAll(later).contentEquals(original.copyOfRange(CHUNK, original.size))); later.close()

    // End-of-file seeks do not send a guaranteed unsatisfiable request to R2.
    val end = factory.createDataSource(); val before = cold.calls
    checked(end.open(spec(original.size.toLong())) == 0L)
    checked(end.read(ByteArray(1),0,1) == C.RESULT_END_OF_INPUT); end.close(); checked(cold.calls == before)
    val beyond = factory.createDataSource(); fails { beyond.open(spec(original.size + 1L)) }; beyond.close()
    checked(cold.calls == before)

    // A real truncated body, changed representation or upstream 500 remains a failure.
    for (bad in listOf(Server().apply { truncate = true }, Server().apply { mutate = true },
        Server().apply { missingEtag = true }, Server().apply { wrongRange = true }, Server().apply { fail = true })) {
        val ds = bad.factory().createDataSource()
        fails { ds.open(spec()); readAll(ds) }; ds.close(); checked(bad.closes >= 1)
    }
    checked(videoByteRange("bytes 0-1048575/1825568") == VideoByteRange(0,1048575,1825568))
    for (bad in listOf("bytes 1-0/2", "bytes 0-2/2", "bytes */2", "bytes 0-0/0", "bytes 0-1/99999999999999999999"))
        checked(videoByteRange(bad) == null)
    println("PASS $checks native video transport checks (real Media3 APIs; JVM URI/HTTP fixtures; no device/provider claims)")
}
