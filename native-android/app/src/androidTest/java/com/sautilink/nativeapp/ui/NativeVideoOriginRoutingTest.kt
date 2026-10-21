package com.sautilink.nativeapp.ui

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.ui.components.NativeVideoOriginDataSourceFactory
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NativeVideoOriginRoutingTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private class RecordingNetworkFactory : DataSource.Factory {
        val opened = mutableListOf<DataSpec>()
        override fun createDataSource(): DataSource = object : BaseDataSource(true) {
            private var spec: DataSpec? = null
            private var remaining = 0
            override fun open(dataSpec: DataSpec): Long {
                spec = dataSpec; remaining = 16_384; opened += dataSpec
                transferInitializing(dataSpec); transferStarted(dataSpec)
                return remaining.toLong()
            }
            override fun getUri(): Uri? = spec?.uri
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (remaining == 0) return C.RESULT_END_OF_INPUT
                val count = minOf(remaining, length)
                buffer.fill(7, offset, offset + count); remaining -= count; bytesTransferred(count)
                return count
            }
            override fun close() { if (spec != null) { transferEnded(); spec = null } }
        }
    }

    @Test fun authorizedMediaForwardsRealTransferEvents_andRetainsOriginalRequestUri() {
        val upstream = RecordingNetworkFactory()
        val source = NativeVideoOriginDataSourceFactory("https://sautilink.com", upstream).createDataSource()
        var starts = 0; var bytes = 0; var ends = 0
        source.addTransferListener(object : TransferListener {
            override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { assertTrue(isNetwork) }
            override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { assertTrue(isNetwork); starts++ }
            override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) { assertTrue(isNetwork); bytes += bytesTransferred }
            override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { assertTrue(isNetwork); ends++ }
        })
        val original = Uri.parse("https://sautilink.com/api/sauti-media/$id?quality=360")
        try {
            source.open(DataSpec.Builder().setUri(original).build())
            assertEquals(original, source.uri)
            assertEquals(1_024, source.read(ByteArray(1_024), 0, 1_024))
        } finally { source.close() }
        assertEquals(1, starts); assertEquals(1_024, bytes); assertEquals(1, ends)
        assertEquals(original, upstream.opened.single().uri)
    }

    @Test fun foreignHostOrUnrelatedSautiRouteNeverReachesTheAuthenticatedFactory() {
        val upstream = RecordingNetworkFactory()
        val source = NativeVideoOriginDataSourceFactory("https://sautilink.com", upstream).createDataSource()
        listOf("https://evil.test/video.mp4", "https://sautilink.com.evil.test/api/sauti-media/$id",
            "https://sautilink.com/api/account/private", "https://sautilink.com/api/sauti-media/$id?redirect=evil").forEach { url ->
            assertThrows(IOException::class.java) { source.open(DataSpec.Builder().setUri(url).build()) }
            source.close()
        }
        assertTrue(upstream.opened.isEmpty())
    }
}
