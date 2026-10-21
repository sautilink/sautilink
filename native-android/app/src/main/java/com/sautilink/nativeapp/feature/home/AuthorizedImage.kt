package com.sautilink.nativeapp.feature.home

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ImageNotSupported
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.components.SautiSkeletonBlock
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URL
import java.security.MessageDigest
import java.util.WeakHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

private val imageHttp = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .callTimeout(25, TimeUnit.SECONDS)
    .followRedirects(false)
    .followSslRedirects(false)
    .cache(null)
    .build()

/** No disk cache. The weak auth key and token fingerprint separate environments,
 * accounts, sign-ins and token refreshes without storing bearer credentials in keys.
 */
private object AuthorizedImagePreviews {
    private val sessions = WeakHashMap<StagingAuthClient, SessionImagePreviewCache<Bitmap>>()
    @Synchronized fun forAuth(auth: StagingAuthClient): SessionImagePreviewCache<Bitmap> =
        sessions.getOrPut(auth) { SessionImagePreviewCache(6 * 1024 * 1024, { it.byteCount }) }
}

/** Real authenticated 480px preview + full image are fetched concurrently. The
 * complete request always revalidates access; cached blur is never a full-image hit.
 */
@Composable
internal fun AuthorizedImage(
    auth: StagingAuthClient,
    route: String,
    description: String,
    modifier: Modifier = Modifier,
    crop: Boolean = true,
    naturalAspectRatio: Boolean = false,
    showFailureFallback: Boolean = true,
    fallback: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.ImageNotSupported, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
        }
    }
) {
    val accountId = auth.account?.id
    val sessionState = auth.sessionState
    var bitmap by remember(auth, accountId, sessionState, route) { mutableStateOf<Bitmap?>(null) }
    var preview by remember(auth, accountId, sessionState, route) { mutableStateOf<Bitmap?>(null) }
    var loading by remember(auth, accountId, sessionState, route) { mutableStateOf(true) }
    var failed by remember(auth, accountId, sessionState, route) { mutableStateOf(false) }
    var transientFailure by remember(auth, accountId, sessionState, route) { mutableStateOf(false) }
    var retryVersion by remember(auth, accountId, sessionState, route) { mutableIntStateOf(0) }
    var sawOffline by remember(auth, accountId, sessionState, route) { mutableStateOf(false) }
    // Loaded photos never subscribe to network recovery or refetch on resume.
    val recoveryOnline = if (bitmap == null) rememberNetworkAvailable() else true
    val lifecycleOwner = LocalLifecycleOwner.current
    val retry: () -> Unit = {
        if (!loading && accountId != null && auth.account?.id == accountId &&
            auth.sessionState == StagingSessionState.SIGNED_IN) {
            loading = true
            failed = false
            retryVersion++
        }
    }
    val currentRetry by rememberUpdatedState(retry)
    val currentFailure by rememberUpdatedState(failed && transientFailure)
    val currentOnline by rememberUpdatedState(recoveryOnline)
    DisposableEffect(lifecycleOwner, auth, accountId, route) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && currentFailure && currentOnline) currentRetry()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(recoveryOnline, failed, transientFailure) {
        if (!recoveryOnline) sawOffline = true
        else if (failed && transientFailure && sawOffline) { sawOffline = false; currentRetry() }
        else if (bitmap != null) sawOffline = false
    }
    val cache = remember(auth) { AuthorizedImagePreviews.forAuth(auth) }
    LaunchedEffect(auth, accountId, sessionState, route, retryVersion) {
        val attemptVersion = retryVersion
        bitmap = null
        preview = null
        loading = true
        failed = false
        transientFailure = false
        fun stillOwnsImage() = auth.account?.id == accountId &&
            auth.sessionState == StagingSessionState.SIGNED_IN
        try {
            if (accountId == null || sessionState != StagingSessionState.SIGNED_IN) {
                cache.activate(null)
                return@LaunchedEffect
            }
            val token = auth.accessTokenForStagingRead()
            currentCoroutineContext().ensureActive()
            if (!stillOwnsImage()) return@LaunchedEffect
            val fingerprint = MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
                .joinToString("") { "%02x".format(it) }
            val scope = "${auth.mediaOrigin}|$accountId|$fingerprint"
            val stamp = cache.activate(scope)
            val previewRoute = authorizedImagePreviewRoute(route)
            val cacheKey = previewRoute ?: route
            preview = cache.get(scope, stamp, cacheKey, SystemClock.elapsedRealtime())
            coroutineScope {
                val previewJob = if (previewRoute != null && preview == null) launch {
                    try {
                        val thumbnail = fetchBoundedBitmap(auth.mediaOrigin + previewRoute, token, 480, ::stillOwnsImage)
                        val blurred = withContext(Dispatchers.Default) { blurredImagePreview(thumbnail) }
                        ensureActive()
                        if (stillOwnsImage() && bitmap == null &&
                            cache.put(scope, stamp, cacheKey, blurred, SystemClock.elapsedRealtime())) preview = blurred
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* A failed optional preview never fails the full image. */ }
                } else null
                try {
                    val complete = fetchBoundedBitmap(auth.mediaOrigin + route, token, 1440, ::stillOwnsImage)
                    ensureActive()
                    if (stillOwnsImage()) {
                        bitmap = complete
                        preview = null
                        // Also permits a real blurred preview for endpoints with no thumbnail route
                        // on the next view, while their full image still revalidates the server.
                        val blurred = withContext(Dispatchers.Default) { blurredImagePreview(complete) }
                        ensureActive()
                        if (stillOwnsImage()) cache.put(scope, stamp, cacheKey, blurred, SystemClock.elapsedRealtime())
                    }
                } finally { previewJob?.cancel() }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            if (attemptVersion == retryVersion && stillOwnsImage()) {
                bitmap = null
                preview = null
                failed = true
                transientFailure = authorizedImageEnvironmentRecovery(error)
            }
        } finally { if (attemptVersion == retryVersion) loading = false }
    }
    val naturalAspect = (bitmap ?: preview)?.let { image ->
        if (image.height > 0) (image.width.toFloat() / image.height).coerceIn(.65f, 2.25f) else 1.35f
    } ?: 1.35f
    Box((if (naturalAspectRatio) modifier.aspectRatio(naturalAspect) else modifier)
        .background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        val image = bitmap
        val blurred = preview
        when {
            image != null -> Image(image.asImageBitmap(), contentDescription = description,
                contentScale = if (crop) ContentScale.Crop else ContentScale.Fit,
                modifier = Modifier.fillMaxSize())
            loading && blurred != null -> Image(blurred.asImageBitmap(), contentDescription = null,
                contentScale = if (crop) ContentScale.Crop else ContentScale.Fit,
                modifier = Modifier.fillMaxSize().blur(8.dp))
            loading -> SautiSkeletonBlock(Modifier.fillMaxSize(), 6.dp)
            showFailureFallback -> AuthorizedImageFailureContent(failed, retry, fallback = fallback)
        }
    }
}

/** A narrow child button owns only its explicit retry tap. Avatar/profile/media
 * click targets retain their original behavior; tiny images keep their fallback.
 */
@Composable
internal fun AuthorizedImageFailureContent(
    canRetry: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier.fillMaxSize(),
    fallback: @Composable () -> Unit,
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        fallback()
        if (canRetry && maxWidth >= 120.dp && maxHeight >= 112.dp) {
            TextButton(onClick = onRetry, modifier = Modifier.align(Alignment.BottomCenter)
                .padding(bottom = 8.dp).heightIn(min = 48.dp).widthIn(min = 96.dp)) { Text("Retry image") }
        }
    }
}

/** Downscale then bilinearly expand: real soft preview pixels on API 26–30 too,
 * where Compose's RenderEffect blur is unavailable. No source bitmap is recycled.
 */
internal fun blurredImagePreview(source: Bitmap): Bitmap {
    val divisor = max(source.width, source.height).toFloat() / 18f
    val tiny = Bitmap.createScaledBitmap(source, max(1, (source.width / divisor).roundToInt()),
        max(1, (source.height / divisor).roundToInt()), true)
    val result = Bitmap.createScaledBitmap(tiny, tiny.width * 6, tiny.height * 6, true)
    if (tiny !== source && tiny !== result) tiny.recycle()
    return result
}

private suspend fun fetchBoundedBitmap(url: String, token: String, maxEdge: Int, stillEligible: () -> Boolean): Bitmap {
    val target = URL(url)
    require(target.protocol == "https" && target.host in setOf("sautilink.com", "test.sautilink.com") &&
        target.port in setOf(-1, 443) && target.userInfo == null && target.ref == null)
    val request = Request.Builder().url(url).header("Authorization", "Bearer $token")
        .header("Accept", "image/*").header("Cache-Control", "no-store").build()
    val raw = authorizedImageBytesWithRetry({ imageHttp.newCall(request) }, stillEligible)
    return withContext(Dispatchers.Default) {
        ensureActive()
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw AuthorizedImageContentFailure("Invalid image")
        var sample = 1
        while (bounds.outWidth / sample > maxEdge || bounds.outHeight / sample > maxEdge) sample *= 2
        BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw AuthorizedImageContentFailure("Image not supported")
    }
}
