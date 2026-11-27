package com.sautilink.nativeapp.feature.videos

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.SautiIcon
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException

internal data class OfflineShort(val mediaId: String, val postId: String, val file: File, val savedAt: Long)
internal object NativeOfflineShorts {
    private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
    fun folder(context: Context, owner: String): File {
        require(uuid.matches(owner))
        return File(context.filesDir, "offline-shorts/$owner").apply {
            if (!isDirectory && !mkdirs()) throw IOException("Offline storage unavailable")
        }
    }
    fun list(context: Context, owner: String?): List<OfflineShort> {
        if (owner == null || !uuid.matches(owner)) return emptyList()
        val root = folder(context, owner)
        return root.listFiles().orEmpty().filter { it.extension == "json" && it.length() in 1..4096 }
            .mapNotNull { record -> runCatching {
                val data = JSONObject(record.readText());val media = data.getString("media");val post = data.getString("post")
                val name = data.getString("file")
                require(uuid.matches(media) && uuid.matches(post) &&
                    Regex("${Regex.escape(media)}-[a-fA-F0-9-]{36}\\.mp4").matches(name))
                val file = File(root, name)
                require(file.isFile && file.canonicalFile.parentFile == root.canonicalFile &&
                    file.length() == data.getLong("bytes") && file.length() in 1..SHORT_VIDEO_DOWNLOAD_MAX_BYTES)
                OfflineShort(media, post, file, data.getLong("saved_at"))
            }.getOrNull() }.sortedByDescending { it.savedAt }.take(20)
    }
    fun contains(context: Context, owner: String?, media: String) = list(context, owner).any { it.mediaId == media }
    @Synchronized fun record(context: Context, owner: String, media: String, post: String, file: File, active: () -> Boolean) {
        require(uuid.matches(media) && uuid.matches(post))
        val root = folder(context, owner)
        if (!active() || file.canonicalFile.parentFile != root.canonicalFile) throw IOException("Offline save cancelled")
        val old = list(context, owner).firstOrNull { it.mediaId == media }
        val temporary = File(root, "$media.json.part")
        temporary.writeText(JSONObject().put("media",media).put("post",post).put("file",file.name)
            .put("bytes",file.length()).put("saved_at",System.currentTimeMillis()).toString())
        if (!active() || !temporary.renameTo(File(root, "$media.json"))) {
            temporary.delete();throw IOException("Offline save cancelled")
        }
        old?.file?.takeIf { it != file }?.delete()
        val saved = list(context,owner)
        var bytes=0L
        saved.forEachIndexed { index,item ->
            bytes+=item.file.length()
            if (index>=10 || bytes>500L*1024*1024) {
                item.file.delete();File(root,"${item.mediaId}.json").delete()
            }
        }
    }
    @Synchronized fun removeRecordIfFile(context: Context, owner: String, media: String, file: String) {
        val record = File(folder(context, owner), "$media.json")
        if (runCatching { JSONObject(record.readText()).optString("file") == file }.getOrDefault(false)) record.delete()
    }
}

internal fun startOfflineShort(context: Context, auth: StagingAuthClient, media: String, post: String): Boolean {
    val owner=auth.account?.id ?: return false
    val ticket=NativeShortVideoDownloads.reserve(auth,owner,media,post,offline=true) ?: return false
    return try {
        ContextCompat.startForegroundService(context,Intent(context,NativeShortVideoDownloadService::class.java)
            .setAction(NativeShortVideoDownloadService.ACTION_START).putExtra(NativeShortVideoDownloadService.EXTRA_TICKET,ticket.id))
        true
    } catch (_: Exception) { ticket.cancel();NativeShortVideoDownloads.release(ticket);false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OfflineShortsDialog(auth: StagingAuthClient, onDismiss: () -> Unit) {
    val context=LocalContext.current;val owner=auth.account?.id
    var entries by remember(owner) { mutableStateOf<List<OfflineShort>>(emptyList()) }
    var selected by remember(owner) { mutableStateOf<OfflineShort?>(null) }
    LaunchedEffect(owner) {
        while (true) {
            entries=withContext(Dispatchers.IO) { NativeOfflineShorts.list(context,owner) }
            delay(750)
        }
    }
    Dialog(onDismissRequest=onDismiss,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Scaffold(topBar={ TopAppBar(title={ Text("Offline videos") },navigationIcon={
            IconButton(onClick={ if(selected!=null) selected=null else onDismiss() }) {
                SautiIcon(Icons.AutoMirrored.Rounded.ArrowBack,"Back")
            }
        }) }) { padding ->
            val item=selected
            if(item==null) LazyColumn(Modifier.fillMaxSize().padding(padding).padding(18.dp)) {
                item { Text("Videos saved on this device for this account. Downloads keep their original video audio.",
                    style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(bottom=18.dp)) }
                if(entries.isEmpty()) item { Text("No offline videos yet. A video being saved will appear here when ready.") }
                items(entries,key={it.mediaId}) { video ->
                    ListItem(headlineContent={ Text("Saved video") },supportingContent={ Text("${video.file.length()/1024/1024} MB · Available offline") },
                        leadingContent={ SautiIcon(Icons.Rounded.PlayCircleOutline,null) },
                        modifier=Modifier.clickable { selected=video })
                }
            } else OfflineShortPlayer(item,Modifier.fillMaxSize().padding(padding))
        }
    }
}

@Composable
private fun OfflineShortPlayer(item: OfflineShort,modifier:Modifier) {
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current
    val player=remember(item.file) { ExoPlayer.Builder(context).build().apply {
        setMediaItem(MediaItem.fromUri(android.net.Uri.fromFile(item.file)));prepare();playWhenReady=true
        repeatMode=Player.REPEAT_MODE_ONE
    } }
    DisposableEffect(player,lifecycle) {
        val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer);player.release() }
    }
    AndroidView(factory={ PlayerView(it).apply { this.player=player;useController=true } },
        update={it.player=player},onRelease={it.player=null},modifier=modifier)
}
