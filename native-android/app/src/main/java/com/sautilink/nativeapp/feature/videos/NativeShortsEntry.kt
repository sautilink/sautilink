package com.sautilink.nativeapp.feature.videos

import android.graphics.Bitmap
import androidx.compose.runtime.*
import com.sautilink.nativeapp.feature.home.StagingFeedPost

internal data class ShortsFeedContext(val posts: List<StagingFeedPost>, val likes: Map<String,Boolean>,
    val saves: Map<String,Boolean>, val reposts: Map<String,Boolean>, val follows: Map<String,Boolean>)
internal val LocalShortsFeedContext=staticCompositionLocalOf<ShortsFeedContext?> { null }
internal val LocalNativeShortsSession=staticCompositionLocalOf<NativeShortsSession?> { null }
internal data class NativeShortsEntry(val id:String, val owner:String, val posts:List<StagingFeedPost>,
    val mediaId:String, val position:Long, val poster:Bitmap?, val follows:Map<String,Boolean>)

/** In-memory presentation only. Media authorization still goes through the normal client. */
internal class NativeShortsSession(val owner:String?, val actions:ShortsReactionController, private val navigate:()->Unit) {
    companion object { @Volatile var testObserver:((NativeShortsSession)->Unit)?=null }
    var entry by mutableStateOf<NativeShortsEntry?>(null);private set
    val positions=mutableMapOf<String,Long>()
    fun open(post:StagingFeedPost, mediaId:String, position:Long, poster:Bitmap?, feed:ShortsFeedContext) {
        val account=owner ?: return
        if(post.media.none { it.id==mediaId && it.kind=="video" } || feed.posts.none {it.id==post.id}) return
        val posts=(listOf(post)+feed.posts).distinctBy {it.id}.take(60)
        posts.take(6).forEach { row ->
            actions.seed(row.id,"like",feed.likes[row.id],row.likes)
            actions.seed(row.id,"save",feed.saves[row.id],0)
            actions.seed(row.id,"repost",feed.reposts[row.id],row.reposts)
        }
        entry=NativeShortsEntry(java.util.UUID.randomUUID().toString(),account,posts,mediaId,
            position.coerceAtLeast(0),poster,feed.follows)
        positions[mediaId]=position.coerceAtLeast(0)
        navigate()
    }
}
