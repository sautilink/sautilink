package com.sautilink.nativeapp.feature.stickers

import com.sautilink.nativeapp.ui.components.NativeSearchField
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.sautilink.nativeapp.ui.components.NativePublicAssets
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.widget.ImageView
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.SentimentSatisfiedAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.airbnb.lottie.compose.*
import com.caverock.androidsvg.SVG
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val STICKER_ORIGIN = "https://stickers.sautilink.com"
private val tokenPattern = Regex("\\[\\[sl-sticker:([a-z0-9-]{1,90})]]|:slv-([a-z0-9-]{1,86}):")
private val stickerHttp get() = NativePublicAssets.http
private val stickerCache = android.util.LruCache<String, NativeSticker>(120)

data class NativeSticker(val id: String, val title: String, val emoji: String,
    val format: String, val assetUrl: String, val inline: Boolean) {
    fun token(motion: Boolean) = if (motion && inline) ":slv-${id.removePrefix("slv-")}:" else "[[sl-sticker:$id]]"
}

fun hasStickerTokens(text: String) = tokenPattern.containsMatchIn(text)

fun insertNativeSticker(value: TextFieldValue, token: String, limit: Int): TextFieldValue {
    val caption = stickerCaption(value)
    val attachments = draftStickerPattern.findAll(value.text).map { it.value }.toList() + token
    val updated = caption.text + "\n" + attachments.joinToString(" ")
    if (updated.length > limit) return value
    return TextFieldValue(updated, caption.selection)
}

private fun decodeSticker(row: JSONObject): NativeSticker? {
    val id = row.optString("id")
    if (!Regex("[a-z0-9-]{1,90}").matches(id)) return null
    val format = row.optString("format")
    val asset = row.optString("preview_url").takeIf { it.startsWith("https://stickers.sautilink.com/assets/") }
        .orEmpty().ifBlank { row.optString("asset_url") }.toHttpUrl()
    val path = asset.encodedPath
    val validPath = when (format) {
        "lottie" -> path == "/assets/vector/$id.json"
        "svg" -> path == "/assets/original/$id.svg"
        "webp" -> Regex("/assets/[a-z0-9/_-]+\\.webp").matches(path)
        else -> false
    }
    if (asset.scheme != "https" || asset.host != "stickers.sautilink.com" || asset.port != 443 ||
        asset.query != null || asset.fragment != null || !validPath) return null
    return NativeSticker(id, row.optString("title"), row.optString("emoji", "✨"), format,
        asset.toString(), row.optBoolean("inline_emoji"))
}

private suspend fun stickerRows(query: String = "", motion: Boolean = false, ids: String? = null,
    offset: Int = 0, pack: String = ""): Pair<List<NativeSticker>, Boolean> = withContext(Dispatchers.IO) {
    val url = "$STICKER_ORIGIN/api/v1/stickers".toHttpUrl().newBuilder()
        .addQueryParameter("limit", "60").addQueryParameter("cursor", offset.toString())
    if (query.isNotBlank()) url.addQueryParameter("q", query.take(80))
    if (motion) url.addQueryParameter("pack", "sautilink-motion-originals")
    else if (pack.isNotBlank()) url.addQueryParameter("pack", pack)
    if (ids != null) url.addQueryParameter("ids", ids)
    stickerHttp.newCall(Request.Builder().url(url.build()).build()).execute().use { response ->
        check(response.isSuccessful) { "Stickers could not load. Try again." }
        val raw = response.body?.string().orEmpty()
        check(raw.length <= 250_000)
        val result = JSONObject(raw)
        val data = result.optJSONArray("data") ?: JSONArray()
        val stickers = (0 until data.length()).mapNotNull { index ->
            runCatching { decodeSticker(data.getJSONObject(index)) }.getOrNull()
        }
        stickers.forEach { stickerCache.put(it.id, it) }
        stickers to (result.optJSONObject("pagination")?.isNull("next_cursor") == false)
    }
}

@Composable
fun NativeStickerArt(sticker: NativeSticker, modifier: Modifier = Modifier) {
    var bitmap by remember(sticker.id) { mutableStateOf(NativePublicAssets.bitmap(sticker.assetUrl)) }
    var animation by remember(sticker.id) { mutableStateOf<String?>(null) }
    var drawable by remember(sticker.id) { mutableStateOf<Drawable?>(null) }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    LaunchedEffect(sticker.assetUrl) {
        if (sticker.format == "svg" && bitmap != null) return@LaunchedEffect
        try {
            withContext(Dispatchers.IO) {
                run {
                    val bytes = NativePublicAssets.load(sticker.assetUrl, 3_000_000)
                    when (sticker.format) {
                        "lottie" -> {
                            val json = bytes.toString(Charsets.UTF_8)
                            val parsed = JSONObject(json)
                            check(parsed.optJSONArray("assets")?.length() == 0)
                            check(parsed.optJSONArray("layers")?.length() in 1..16)
                            animation = json
                        }
                        "svg" -> {
                            if (bitmap != null) return@run
                            val svg = SVG.getFromString(bytes.toString(Charsets.UTF_8))
                            bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888).also {
                                svg.setDocumentWidth(256f); svg.setDocumentHeight(256f)
                                svg.renderToCanvas(Canvas(it)); NativePublicAssets.cacheBitmap(sticker.assetUrl, it)
                            }
                        }
                        else -> if (Build.VERSION.SDK_INT >= 28) {
                            drawable = ImageDecoder.decodeDrawable(ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                                val scale = minOf(1f, 256f / maxOf(info.size.width, info.size.height))
                                decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1), (info.size.height * scale).toInt().coerceAtLeast(1))
                            }
                        } else bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    }
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* The descriptive emoji remains visible while offline. */ }
    }
    DisposableEffect(drawable) {
        onDispose { if (Build.VERSION.SDK_INT >= 28) (drawable as? AnimatedImageDrawable)?.stop() }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        val json = animation
        val image = bitmap
        when {
            json != null -> {
                val composition by rememberLottieComposition(LottieCompositionSpec.JsonString(json))
                LottieAnimation(composition, iterations = LottieConstants.IterateForever,
                    isPlaying = lifecycleState.isAtLeast(Lifecycle.State.STARTED), modifier = Modifier.fillMaxSize())
            }
            drawable != null -> AndroidView(factory = { context -> ImageView(context).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                contentDescription = sticker.title
            } }, modifier = Modifier.fillMaxSize(), update = { view ->
                if (view.drawable !== drawable) view.setImageDrawable(drawable)
                if (Build.VERSION.SDK_INT >= 28) (drawable as? AnimatedImageDrawable)?.let {
                    if (lifecycleState.isAtLeast(Lifecycle.State.STARTED)) it.start() else it.stop()
                }
            })
            image != null -> Image(image.asImageBitmap(), sticker.title, Modifier.fillMaxSize())
            else -> Text(sticker.emoji, style = MaterialTheme.typography.headlineMedium)
        }
    }
}

@Composable
fun NativeStickerText(text: String, modifier: Modifier = Modifier,
    plainText: @Composable (String) -> Unit) {
    val matches = remember(text) { tokenPattern.findAll(text).toList() }
    var resolved by remember(text) { mutableStateOf<Map<String, NativeSticker>>(emptyMap()) }
    LaunchedEffect(text) {
        val ids = matches.map { it.groups[1]?.value ?: "slv-${it.groups[2]!!.value}" }.distinct().take(60)
        val known = ids.mapNotNull { id -> stickerCache.get(id)?.let { id to it } }.toMap()
        resolved = known
        val missing = ids.filterNot(known::containsKey)
        try {
            if (missing.isNotEmpty()) resolved = known + stickerRows(ids = missing.joinToString(",")).first.associateBy { it.id }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        var cursor = 0
        matches.forEach { match ->
            if (match.range.first > cursor) plainText(text.substring(cursor, match.range.first))
            val id = match.groups[1]?.value ?: "slv-${match.groups[2]!!.value}"
            val sticker = resolved[id]
            if (sticker == null) plainText("Sticker unavailable")
            else NativeStickerArt(sticker, Modifier.size(if (match.groups[2] != null) 32.dp else 116.dp))
            cursor = match.range.last + 1
        }
        if (cursor < text.length) plainText(text.substring(cursor))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeStickerButton(enabled: Boolean = true, onInsert: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }, enabled = enabled) {
        Icon(Icons.Rounded.SentimentSatisfiedAlt, "Stickers and motion emoji")
    }
    if (!open) return
    var query by remember { mutableStateOf("") }
    var motion by remember { mutableStateOf(false) }
    var rows by remember { mutableStateOf<List<NativeSticker>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    var page by remember { mutableIntStateOf(0) }
    var pack by remember { mutableStateOf("") }
    var more by remember { mutableStateOf(false) }
    LaunchedEffect(query, motion, pack) { page = 0; rows = emptyList() }
    LaunchedEffect(query, motion, pack, retry, page) {
        loading = true; error = null
        try {
            delay(220)
            val result = stickerRows(query, motion, offset = page * 60, pack = pack)
            rows = if (page == 0) result.first else (rows + result.first).distinctBy { it.id }
            more = result.second
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Stickers are unavailable." }
        finally { loading = false }
    }
    ModalBottomSheet(onDismissRequest = { open = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().height(560.dp).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("SautiLink Stickers", style = MaterialTheme.typography.titleLarge)
            NativeSearchField(query, { query = it.take(80) }, Modifier.fillMaxWidth(), placeholder = "Search stickers")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilterChip(!motion, { motion = false }, label = { Text("Stickers") })
                FilterChip(motion, { motion = true }, label = { Text("Motion emoji") })
            }
            if (!motion) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("" to "All packs", "sautilink-originals" to "SautiLink", "google-noto-animated" to "Noto",
                    "minicons-animated" to "Minicons").forEach { (id, name) ->
                    FilterChip(pack == id, { pack = id }, label = { Text(name) })
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { retry++ }) { Text("Retry") }
            } else if (!loading && rows.isEmpty()) Text("No stickers found. Try another search.")
            LazyVerticalGrid(GridCells.Adaptive(76.dp), Modifier.weight(1f),
                contentPadding = PaddingValues(bottom = 24.dp)) {
                items(rows, key = { it.id }) { sticker ->
                    NativeStickerArt(sticker, Modifier.size(82.dp).padding(5.dp).clickable {
                        onInsert(sticker.token(motion)); open = false
                    })
                }
            }
            if (more) TextButton(onClick = { page++ }, enabled = !loading) { Text("More stickers") }
            Spacer(Modifier.navigationBarsPadding())
        }
    }
}
