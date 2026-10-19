package com.sautilink.nativeapp.feature.rooms

import android.content.Context
import com.sautilink.nativeapp.feature.auth.StagingAccount
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.*
import java.io.IOException
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** Executes the production state, including null/error/identity guards and late landing callbacks. */
fun main() = runBlocking {
    System.setOut(java.io.PrintStream(System.out, true, Charsets.UTF_8))
    var checks = 0
    val failures = mutableListOf<String>()
    fun verify(value: Boolean, message: String) {
        checks++
        if (value) println("PASS $message") else { println("FAIL $message"); failures += message }
    }
    val own = "11111111-1111-4111-8111-111111111111"
    val a = NativeRoom("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "owner", "room-a", "A", "", "open", null, null, own)
    val b = a.copy(id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", slug = "room-b", name = "B")
    val ia = NativeRoomInvitation(a, "owner", "2026-10-16")
    val ib = NativeRoomInvitation(b, "owner", "2026-10-16")
    val fixtures = mutableListOf<RoomsState>()
    fun fixture(): Pair<RoomsState, StagingAuthClient> {
        CacheNetwork.reset()
        CacheNetwork.list = { listOf(a, b) }; CacheNetwork.yours = { listOf(a, b) }
        CacheNetwork.invitations = { listOf(ia, ib) }; CacheNetwork.find = { a }
        val auth = StagingAuthClient(own)
        val state = RoomsState(auth, own, Context(), CoroutineScope(Dispatchers.Unconfined + SupervisorJob()))
        fixtures += state
        state.loadLanding(); state.openRoom(a)
        return state to auth
    }
    try {
        val (state) = fixture()
        val originalDraft = state.draft(a)
        originalDraft.error = "owned draft retained"
        lateinit var oldDiscover: Continuation<List<NativeRoom>>
        lateinit var oldYours: Continuation<List<NativeRoom>>
        lateinit var oldInvites: Continuation<List<NativeRoomInvitation>>
        // These deliberately ignore cancellation to model an already-completed transport response arriving late.
        CacheNetwork.list = { suspendCoroutine { oldDiscover = it } }
        CacheNetwork.yours = { suspendCoroutine { oldYours = it } }
        CacheNetwork.invitations = { suspendCoroutine { oldInvites = it } }
        state.loadLanding()
        CacheNetwork.find = { null }
        state.refreshRoom()
        verify(state.selected == null && state.openError == "This Room is no longer available.", "canonical null closes detail and reports unavailable")
        verify(state.discover.map { it.id } == listOf(b.id), "canonical null evicts only target discovery card")
        verify(state.yours.map { it.id } == listOf(b.id), "canonical null evicts only target membership card")
        verify(state.invitations.map { it.room.id } == listOf(b.id), "canonical null evicts only target invitation")
        verify(!state.discoverLoading && !state.yoursLoading && !state.invitesLoading, "invalidated landing reads release loading flags")
        oldDiscover.resume(listOf(a, b)); oldYours.resume(listOf(a, b)); oldInvites.resume(listOf(ia, ib))
        yield()
        verify(state.discover.map { it.id } == listOf(b.id) && state.yours.map { it.id } == listOf(b.id) &&
            state.invitations.map { it.room.id } == listOf(b.id), "late canceled landing responses cannot reinsert unavailable Room")
        verify(state.draft(a) === originalDraft && state.draft(a).error == "owned draft retained", "eviction preserves account draft")
        CacheNetwork.list = { listOf(a, b) }; CacheNetwork.yours = { listOf(a, b) }; CacheNetwork.invitations = { listOf(ia, ib) }
        state.loadLanding()
        verify(state.discover.size == 2 && state.yours.size == 2 && state.invitations.size == 2,
            "new explicit landing read can return a newly available Room")

        val (failed) = fixture()
        CacheNetwork.find = { throw IOException("test boundary") }
        failed.refreshRoom()
        verify(failed.selected?.id == a.id && failed.discover.size == 2 && failed.yours.size == 2 && failed.invitations.size == 2,
            "transport error preserves selected Room and all cached cards")
        verify(failed.roomError == "test boundary", "transport error keeps existing feedback")

        val (departed, auth) = fixture()
        lateinit var accountLookup: Continuation<NativeRoom?>
        CacheNetwork.find = { suspendCoroutine { accountLookup = it } }
        departed.refreshRoom(); auth.account = StagingAccount("different-account"); accountLookup.resume(null)
        verify(departed.selected?.id == a.id && departed.discover.size == 2, "late null after account departure cannot evict or close")

        val (navigated) = fixture()
        lateinit var navigationLookup: Continuation<NativeRoom?>
        CacheNetwork.find = { suspendCoroutine { navigationLookup = it } }
        navigated.refreshRoom(); navigated.select(b, loadDetails = false); navigationLookup.resume(null)
        verify(navigated.selected?.id == b.id && navigated.discover.size == 2, "late null after navigation cannot evict another context")

        val (newer) = fixture()
        lateinit var staleLookup: Continuation<NativeRoom?>
        CacheNetwork.find = { suspendCoroutine { staleLookup = it } }
        newer.refreshRoom(); CacheNetwork.find = { a }; newer.refreshRoom(); staleLookup.resume(null)
        verify(newer.selected?.id == a.id && newer.discover.size == 2, "older null cannot override newer canonical metadata")
    } finally { fixtures.forEach { it.dispose() } }
    check(failures.isEmpty()) { "${failures.size}/$checks cache checks failed: ${failures.joinToString()}" }
    println("PASS $checks production RoomsState cache checks")
}
