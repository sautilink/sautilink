package com.sautilink.nativeapp.ui.components

import android.content.Context
import android.graphics.Bitmap
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Cache
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** Only first-party public artwork uses this cache; account/session requests use separate clients. */
internal object NativePublicAssets {
    @Volatile var http: OkHttpClient = client()
        private set
    private var configured = false
    private val bytes = object : LruCache<String, ByteArray>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }
    private val bitmaps = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }
    private val locks = Array(32) { Mutex() }
    private fun client(cache: Cache? = null) = OkHttpClient.Builder().cache(cache)
        .callTimeout(20, TimeUnit.SECONDS).build()

    @Synchronized fun configure(context: Context) {
        if (!configured) {
            http = client(Cache(File(context.cacheDir, "creator-public-assets"), 48L * 1024 * 1024))
            configured = true
        }
    }

    fun bitmap(key: String): Bitmap? = bitmaps.get(key)
    fun cacheBitmap(key: String, value: Bitmap) { bitmaps.put(key, value) }

    suspend fun load(url: String, maximum: Int): ByteArray = withContext(Dispatchers.IO) {
        require(url.startsWith("https://music.sautilink.com/") || url.startsWith("https://stickers.sautilink.com/"))
        bytes.get(url)?.let { return@withContext it }
        val mutex = locks[(url.hashCode() and Int.MAX_VALUE) % locks.size]
        mutex.withLock {
            bytes.get(url)?.let { return@withLock it }
            http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                check(response.isSuccessful) { "Artwork could not load." }
                val body = checkNotNull(response.body)
                check(body.contentLength() <= maximum)
                val source = body.source(); source.request(maximum.toLong() + 1)
                check(source.buffer.size <= maximum)
                source.readByteArray().also { data -> check(data.size <= maximum); bytes.put(url, data) }
            }
        }
    }
}
