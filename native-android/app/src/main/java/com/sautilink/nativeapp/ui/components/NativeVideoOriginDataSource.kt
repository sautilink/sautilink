package com.sautilink.nativeapp.ui.components

import android.content.Context
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

/** A shared HTTP/2-capable connection pool. Redirects never carry the account's bearer elsewhere. */
private val nativePlaybackHttpClient by lazy {
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
            val source = (if (isHls) hls else authenticated).createDataSource()
            delegate = source
            listeners.forEach(source::addTransferListener)
            return source.open(dataSpec)
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = checkNotNull(delegate).read(buffer, offset, length)
        override fun getUri(): Uri? = requestedUri
        override fun getResponseHeaders(): Map<String, List<String>> = delegate?.responseHeaders ?: emptyMap()
        override fun close() {
            try { delegate?.close() } finally { delegate = null; requestedUri = null }
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
