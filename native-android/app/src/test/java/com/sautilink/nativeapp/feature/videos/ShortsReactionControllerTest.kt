package com.sautilink.nativeapp.feature.videos

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ShortsReactionControllerTest {
    @Test fun immediateFeedbackAndRapidTapsConvergeWithoutConcurrentWrites() = runBlocking {
        val gate=CompletableDeferred<Unit>();val writes=mutableListOf<Boolean>()
        val actions=ShortsReactionController(this,{true},{_,_->false},{_,_,active->
            writes+=active;if(writes.size==1)gate.await()
        })
        actions.seed("post","like",false,9)
        actions.toggle("post","like",9,false)
        assertEquals(true,actions.state("post","like")?.desired)
        assertEquals(10,actions.state("post","like")?.visibleCount)
        yield();assertEquals(listOf(true),writes)
        actions.toggle("post","like",9,false)
        assertEquals(9,actions.state("post","like")?.visibleCount)
        gate.complete(Unit);yield()
        assertEquals(listOf(true,false),writes)
        assertEquals(false,actions.state("post","like")?.desired)
        assertEquals(false,actions.state("post","like")?.pending)
        assertEquals(9,actions.state("post","like")?.visibleCount)
    }
    @Test fun failedWriteRollsBackAndExplicitRetryReadsBeforeWriting() = runBlocking {
        var writes=0;var reads=0
        val actions=ShortsReactionController(this,{true},{_,_->reads++;true},{_,_,_->writes++;throw IOException()})
        actions.seed("post","save",false,0)
        actions.toggle("post","save",0,false);yield()
        assertEquals(false,actions.state("post","save")?.desired)
        assertEquals(true,actions.state("post","save")?.uncertain)
        actions.toggle("post","save",0,false);yield()
        assertEquals(1,reads);assertEquals(1,writes)
        assertEquals(true,actions.state("post","save")?.desired)
        assertEquals(false,actions.state("post","save")?.pending)
    }
    @Test fun delayedStatusCannotOverwriteATapAndAccountChangesStopQueuedWrites() = runBlocking {
        var owner=true;var writes=0
        val actions=ShortsReactionController(this,{owner},{_,_->false},{_,_,_->writes++})
        actions.seed("post","repost",false,4)
        val revision=actions.state("post","repost")?.revision
        actions.toggle("post","repost",4,false)
        actions.acceptRead("post","repost",false,4,revision)
        assertEquals(true,actions.state("post","repost")?.desired)
        owner=false;yield();assertEquals(0,writes)
    }
    @Test fun unknownStatusNeverBecomesAnUnrequestedUndo() = runBlocking {
        val writes=mutableListOf<Boolean>()
        val actions=ShortsReactionController(this,{true},{_,_->true},{_,_,active->writes+=active})
        actions.toggle("post","like",9,null)
        assertEquals(true,actions.state("post","like")?.desired)
        yield();assertTrue(writes.isEmpty())
        assertEquals(true,actions.state("post","like")?.confirmed)
    }
}
