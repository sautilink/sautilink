package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.StagingAccount
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

fun main() {
    var checks = 0
    fun verify(ok: Boolean, label: String) { check(ok) { label }; checks++; println("PASS: $label") }
    val account = "9d100000-0000-4000-8000-000000000001"
    val room = NativeRoom("9d200000-0000-4000-8000-000000000001",
        "9d100000-0000-4000-8000-000000000002", "notice-room", "Notice Room", "", "approval", null, null,
        viewerId = account)
    val auth = StagingAuthClient(account)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    val state = RoomManagementState(auth, account, scope)
    val config = NativeRoomCommunityConfig(room.id, 1, emptyList(), emptyList())
    ReadinessNetwork.reset()
    try {
        state.open(room)
        ReadinessNetwork.capability.complete(NativeRoomManagementCapabilities(true))
        ReadinessNetwork.config.complete(config)
        var acknowledgements = 0
        state.requestMembership(room, config, emptyList(), "request") { acknowledgements++ }
        verify(state.notice == null && acknowledgements == 0, "request has no success notice before client ACK")
        ReadinessNetwork.membership.complete(NativeRoomMembershipResult(room.id, account, "pending", 1, "fixture"))
        verify(state.notice == "Join request sent." && acknowledgements == 1, "validated client result publishes membership notice")
        state.membershipRequestCancelled(room.copy(id = "9d200000-0000-4000-8000-000000000099"))
        verify(state.notice == "Join request sent.", "another Room cannot clear current membership notice")
        auth.account = StagingAccount("9d100000-0000-4000-8000-000000000099")
        state.membershipRequestCancelled(room)
        verify(state.notice == "Join request sent.", "changed account cannot clear captured Room notice")
        auth.account = StagingAccount(account)
        state.membershipRequestCancelled(room)
        verify(state.notice == null, "confirmed current-context cancellation clears stale request notice")
        ReadinessNetwork.membership = CompletableDeferred()
        state.requestMembership(room, config, emptyList(), "request") { acknowledgements++ }
        ReadinessNetwork.membership.complete(NativeRoomMembershipResult(room.id, account, "member", 1, "fixture"))
        verify(state.notice == "Room membership confirmed.", "later confirmed membership replaces request notice")
        state.membershipRequestCancelled(room)
        verify(state.notice == "Room membership confirmed.", "cancel hook preserves unrelated success notice")
    } finally { state.dispose(); scope.cancel() }
    println("PASS: $checks actual RoomManagementState membership notice checks")
}
