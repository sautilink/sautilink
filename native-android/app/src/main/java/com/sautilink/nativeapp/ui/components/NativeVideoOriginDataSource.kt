package com.sautilink.nativeapp.ui.components

import android.content.Context
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

/** A shared HTTP/2-capable connection pool. Redirects never carry the account's bearer elsewhere. */
internal val nativePlaybackHttpClient by lazy {
    OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
}

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal fun nativeVideoPlaybackResources(context: Context, mediaOrigin: String, token: String,
    authorizationToken: () -> String? = { token },
    sessionActive: () -> Boolean): NativeVideoPlaybackResources {
    val credentialed = nativePlaybackHttpClient.newBuilder().addInterceptor { chain ->
        val request = chain.request()
        if (!authenticatedVideoUrl(mediaOrigin, request.url.toString()) && !authenticatedHlsUrl(mediaOrigin, request.url.toString()))
            throw IOException("Unsupported video request")
        if (!sessionActive()) throw IOException("Video playback session ended")
        val current = authorizationToken()?.takeIf { it.isNotBlank() } ?: throw IOException("Video playback session ended")
        chain.proceed(request.newBuilder().header("Authorization", "Bearer $current").build())
    }.build()
    val authorized = OkHttpDataSource.Factory(credentialed)
    val pins = NativeVideoRepresentationPins()
    val grants = NativeHlsGrantRegistry()
    val routed = NativeVideoOriginDataSourceFactory(mediaOrigin, NativeVideoDataSourceFactory(authorized, pins::retains), authorized, grants)
    return NativeVideoPlaybackResources(context, routed, sessionActive, representationPins = pins, hlsGrants = grants)
}

/** Only already-validated SautiLink media routes can reach the authenticated HTTP client. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativeVideoOriginDataSourceFactory(
    private val mediaOrigin: String,
    private val authenticated: DataSource.Factory,
    private val hls: DataSource.Factory = authenticated,
    private val hlsGrants: NativeHlsGrantRegistry = NativeHlsGrantRegistry(),
) : DataSource.Factory {
    override fun createDataSource(): DataSource = object : DataSource {
        private var delegate: DataSource? = null
        private var requestedUri: Uri? = null
        private val listeners = mutableListOf<TransferListener>()
        private var probeMediaId: String? = null
        private var probeKind = NativeVideoStartupRequest.NONE
        private var probeId = 0L
        private var probeStart = 0L
        private var probeBytes = 0L
        private fun probe(stage: NativeVideoStartupStage, status: Int = 0,
            serverTiming: Map<NativeVideoServerTiming, Double> = emptyMap()) {
            probeMediaId?.let { NativeVideoStartupProbe.mark(it, stage, probeKind, probeId,
                (System.nanoTime() - probeStart) / 1_000_000L, probeBytes, status, serverTiming) }
        }
        override fun addTransferListener(transferListener: TransferListener) {
            listeners += transferListener
            delegate?.addTransferListener(transferListener)
        }
        override fun open(dataSpec: DataSpec): Long {
            check(delegate == null)
            val isHls = authenticatedHlsUrl(mediaOrigin, dataSpec.uri.toString()) && hlsGrants.allows(dataSpec.uri.toString())
            if (dataSpec.httpMethod != DataSpec.HTTP_METHOD_GET || dataSpec.httpBody != null ||
                (!isHls && !authenticatedVideoUrl(mediaOrigin, dataSpec.uri.toString()))) throw IOException("Unsupported video request")
            requestedUri = dataSpec.uri
            // The outer SessionSource already checked the live account and grant.
            // Consume only a complete GET of this exact authorized bootstrap URI.
            val initialCodec = isHls && hlsGrants.isBootstrapInitialization(dataSpec.uri.toString())
            val initialPlaylist = if (isHls && dataSpec.position == 0L && dataSpec.length == androidx.media3.common.C.LENGTH_UNSET.toLong())
                hlsGrants.consumeBootstrap(dataSpec.uri.toString()) else null
            if (initialPlaylist != null) NativeVideoStartupProbe.mark(dataSpec.uri.pathSegments.getOrNull(2).orEmpty(),
                NativeVideoStartupStage.BOOTSTRAP_HIT,
                if (initialCodec) NativeVideoStartupRequest.INITIALIZATION else NativeVideoStartupRequest.MANIFEST,
                bytes = initialPlaylist.size.toLong())
            if (initialPlaylist == null && NativeVideoStartupProbe.observer != null) {
                val path = dataSpec.uri.path.orEmpty()
                probeMediaId = path.split('/').getOrNull(3)
                probeKind = when {
                    path.substringAfterLast('/').startsWith("m_") -> NativeVideoStartupRequest.MANIFEST
                    isHls -> NativeVideoStartupRequest.SEGMENT
                    else -> NativeVideoStartupRequest.MP4
                }
                probeId = NativeVideoStartupProbe.nextRequestId(); probeStart = System.nanoTime(); probeBytes = 0L
                probe(NativeVideoStartupStage.HTTP_BEGIN)
            }
            val source = if (initialPlaylist != null) ByteArrayDataSource(initialPlaylist)
                else (if (isHls) hls else authenticated).createDataSource()
            delegate = source
            listeners.forEach(source::addTransferListener)
            return try { source.open(dataSpec).also { probe(NativeVideoStartupStage.HTTP_HEADERS,
                serverTiming = if (probeMediaId != null) nativeVideoServerTimings(source.responseHeaders) else emptyMap()) } }
            catch (error: Exception) {
                probe(NativeVideoStartupStage.FAILURE,
                    (error as? androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)?.responseCode ?: 0)
                throw error
            }
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = checkNotNull(delegate).read(buffer, offset, length).also {
            if (probeMediaId != null && it > 0) {
                val first = probeBytes == 0L; probeBytes += it
                if (first) probe(NativeVideoStartupStage.HTTP_FIRST_BYTE)
            }
        }
        override fun getUri(): Uri? = requestedUri
        override fun getResponseHeaders(): Map<String, List<String>> = delegate?.responseHeaders ?: emptyMap()
        override fun close() {
            try { delegate?.close() } finally {
                probe(NativeVideoStartupStage.HTTP_COMPLETE)
                delegate = null; requestedUri = null; probeMediaId = null
            }
        }
    }
}

internal fun authenticatedVideoUrl(origin: String, url: String): Boolean {
    if (origin !in setOf("https://sautilink.com", "https://test.sautilink.com")) return false
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    val expected = URI(origin)
    if (uri.scheme != "https" || uri.host != expected.host || uri.port != -1 || uri.userInfo != null || uri.fragment != null) return false
    val uuid = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
    return (Regex("/api/sauti-media/$uuid").matches(uri.rawPath.orEmpty()) &&
        (uri.rawQuery == null || Regex("quality=(240|360|480|720|1080)").matches(uri.rawQuery))) ||
        (Regex("/api/rooms/$uuid/post-submissions/$uuid/media/$uuid").matches(uri.rawPath.orEmpty()) && uri.rawQuery == null)
}
