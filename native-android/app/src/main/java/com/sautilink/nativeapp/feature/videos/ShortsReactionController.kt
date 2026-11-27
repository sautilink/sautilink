package com.sautilink.nativeapp.feature.videos

import androidx.compose.runtime.*
import kotlinx.coroutines.*

internal data class ShortsReaction(val confirmed:Boolean?,val desired:Boolean?,val count:Int,
    val pending:Boolean=false,val revision:Long=0,val uncertain:Boolean=false) {
    val visibleCount:Int get()=(count.toLong()+if(confirmed==null || desired==null || confirmed==desired) 0 else if(desired) 1 else -1)
        .coerceIn(0,Int.MAX_VALUE.toLong()).toInt()
}

/** Immediate local feedback; serial, idempotent writes converge to the last tap.
 * Never retries an uncertain mutation. The next explicit tap first re-reads it. */
internal class ShortsReactionController(private val scope:CoroutineScope, private val current:()->Boolean,
    private val read:suspend(String,String)->Boolean, private val write:suspend(String,String,Boolean)->Unit) {
    private val states=mutableStateMapOf<String,ShortsReaction>()
    private val jobs=mutableMapOf<String,Job>()
    var error by mutableStateOf<String?>(null)
    fun state(post:String,kind:String)=states["$kind:$post"]
    fun revisions():Map<String,Long> = states.mapValues {it.value.revision}
    fun reconcileCount(post:String,kind:String,count:Int,revision:Long?) {
        val key="$kind:$post";val old=states[key] ?: return
        if(current() && !old.pending && old.revision==revision && old.count!=count.coerceAtLeast(0))
            states[key]=old.copy(count=count.coerceAtLeast(0))
    }

    fun seed(post:String,kind:String,value:Boolean?,count:Int) {
        val key="$kind:$post"
        if(current() && key !in states) {
            if(states.size>=600) states.keys.firstOrNull { it !in jobs }?.let(states::remove)
            states[key]=ShortsReaction(value,value,count.coerceAtLeast(0))
        }
    }
    fun acceptRead(post:String,kind:String,value:Boolean,count:Int,revision:Long?) {
        if(!current()) return
        val key="$kind:$post";val old=states[key]
        if(old?.pending==true || old?.revision!=revision && !(revision==null && old?.revision==0L)) return
        states[key]=ShortsReaction(value,value,if ((old?.revision ?: 0)>0) old!!.count else count.coerceAtLeast(0),revision=old?.revision ?: 0)
    }
    fun toggle(post:String,kind:String,count:Int,known:Boolean?) {
        if(!current() || kind !in setOf("like","save","repost")) return
        seed(post,kind,known,count)
        request(post,kind,states.getValue("$kind:$post").desired!=true,count,known)
    }
    fun request(post:String,kind:String,target:Boolean,count:Int,known:Boolean?) {
        if(!current() || kind !in setOf("like","save","repost")) return
        seed(post,kind,known,count)
        val key="$kind:$post";val old=states.getValue(key)
        states[key]=old.copy(desired=target,pending=true,revision=old.revision+1)
        error=null
        if(jobs[key]?.isActive==true) return
        val job=scope.launch(start=CoroutineStart.LAZY) {
            try {
                var state=states.getValue(key)
                if(state.confirmed==null || state.uncertain) {
                    val actual=withTimeout(18_000) {read(post,kind)}
                    if(!current()) return@launch
                    state=states.getValue(key).copy(confirmed=actual,uncertain=false)
                    states[key]=state
                }
                while(current()) {
                    state=states.getValue(key)
                    val target=state.desired ?: break
                    if(state.confirmed==target) { states[key]=state.copy(pending=false);break }
                    val nextCount=state.copy(desired=target).visibleCount
                    withTimeout(20_000) {write(post,kind,target)}
                    if(!current()) return@launch
                    val latest=states.getValue(key)
                    states[key]=latest.copy(confirmed=target,count=nextCount)
                }
            } catch(timeout:TimeoutCancellationException) {
                if(current()) { val latest=states.getValue(key);states[key]=latest.copy(desired=latest.confirmed,pending=false,uncertain=true)
                    error="Could not confirm this action. Tap again to check its status." }
            } catch(cancelled:CancellationException) { throw cancelled
            } catch(_:Exception) {
                if(current()) { val latest=states.getValue(key);states[key]=latest.copy(desired=latest.confirmed,pending=false,uncertain=true)
                    error="Could not update this action. Please try again." }
            } finally { jobs.remove(key) }
        }
        jobs[key]=job
        job.start()
    }
}
