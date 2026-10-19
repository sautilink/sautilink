package com.sautilink.nativeapp.feature.inbox

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BrokenImage
import androidx.compose.material3.CircularProgressIndicator
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Small, memory-only, account-isolated preview cache. Never writes private DM images to disk. */
private object DmPhotoMemoryCache {
    private val photos = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, image: Bitmap): Int = image.byteCount
    }
    private var currentAccount: String? = null

    @Synchronized fun get(account: String, mediaId: String): Bitmap? {
        if (currentAccount != account) {
            photos.evictAll()
            currentAccount = account
        }
        return photos.get(mediaId)
    }

    @Synchronized fun put(account: String, mediaId: String, image: Bitmap) {
        if (currentAccount != account) {
            photos.evictAll()
            currentAccount = account
        }
        photos.put(mediaId, image)
    }
}

private fun decodeDmThumbnail(bytes: ByteArray): Bitmap {
    val probe = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, probe)
    require(probe.outWidth > 0 && probe.outHeight > 0) { "Invalid photo" }
    var sample = 1
    while (probe.outWidth / sample > 960 || probe.outHeight / sample > 960) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
        BitmapFactory.Options().apply { inSampleSize = sample })
        ?: error("Unable to display photo")
}

/** Stable thumbnail even when the LazyColumn recycles cells or read receipts change. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeDmCachedPhoto(
    auth: StagingAuthClient,
    media: DmMedia,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    onError: (String) -> Unit
) {
    val account = auth.account?.id.orEmpty()
    val client = remember(auth) { NativeDmMediaClient(auth) }
    var retry by remember(media.id, account) { mutableIntStateOf(0) }
    var photo by remember(account, media.id) {
        mutableStateOf(DmPhotoMemoryCache.get(account, media.id))
    }
    var loading by remember(account, media.id) { mutableStateOf(photo == null) }
    var failed by remember(account, media.id) { mutableStateOf(false) }
    var enlarged by remember(account, media.id) { mutableStateOf(false) }

    LaunchedEffect(account, media.id, retry) {
        if (account.isBlank() || photo != null) return@LaunchedEffect
        loading = true
        failed = false
        try {
            val bytes = client.downloadMedia(media.id)
            val decoded = withContext(Dispatchers.Default) { decodeDmThumbnail(bytes) }
            DmPhotoMemoryCache.put(account, media.id, decoded)
            photo = decoded
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            failed = true
        } finally {
            loading = false
        }
    }

    Box(modifier.fillMaxWidth().height(218.dp).clip(RoundedCornerShape(12.dp))
        .background(MaterialTheme.colorScheme.surfaceVariant)
        .combinedClickable(enabled = photo != null,
            onLongClick = onLongClick,
            onLongClickLabel = if (onLongClick != null) "Select message" else null,
            onClick = { enlarged = true }),
        contentAlignment = Alignment.Center) {
        val image = photo
        when {
            image != null -> Image(image.asImageBitmap(), contentDescription = "Chat photo",
                contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            loading -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Rounded.BrokenImage, null, Modifier.size(23.dp))
                TextButton(onClick = { retry++ }) { Text("Retry photo") }
            }
        }
    }
    if (enlarged && photo != null) Dialog(onDismissRequest = { enlarged = false }) {
        Image(photo!!.asImageBitmap(), contentDescription = "Open chat photo",
            contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().heightIn(max = 600.dp)
                .clickable { enlarged = false })
    }
}
