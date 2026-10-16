package com.sautilink.nativeapp.feature.rooms

import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.runtime.snapshots.SnapshotStateObserver
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

private var checks = 0
private fun verify(condition: Boolean, message: String) {
    check(condition) { message }
    checks++
    println("PASS: $message")
}

// Observes the actual production membershipReady expression, as Compose observes
// a skipped child's state reads. No reimplementation of that expression exists here.
private class ViewRead(val state: RoomManagementState, val room: NativeRoom) {
    private val token = Any()
    private val observer = SnapshotStateObserver { callback -> callback() }
    var changes = 0; private set
    var ready = false; private set
    init { observer.start() }
    fun render() { observer.observeReads(token, { _: Any -> changes++ }) { ready = state.membershipReady(room) } }
    fun flush() { Snapshot.sendApplyNotifications() }
    fun stop() { observer.stop(); observer.clear() }
}

fun main() {
    val accountId = "9d100000-0000-4000-8000-000000000001"
    val room = NativeRoom("9d200000-0000-4000-8000-000000000001",
        "9d100000-0000-4000-8000-000000000002", "observer-room", "Observer Room", "", "open", null, null,
        viewerId = accountId)
    ReadinessNetwork.reset()
    val auth = StagingAuthClient(accountId)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    val state = RoomManagementState(auth, accountId, scope)
    val view = ViewRead(state, room)
    try {
        view.render()
        verify(!view.ready, "nonmember initial render before open stays disabled")
        state.open(room)
        view.flush()
        verify(view.changes > 0, "opening the Room invalidates initial readiness read before capability response")
        view.render()
        verify(!view.ready && state.capabilityLoading, "activation cannot enable Join while capability is pending")
        val beforeCapability = view.changes
        ReadinessNetwork.capability.complete(NativeRoomManagementCapabilities(true))
        view.flush()
        verify(view.changes > beforeCapability, "capability ACK invalidates the subscribed child")
        view.render()
        verify(!view.ready && state.configurationLoading, "Join remains disabled until matching configuration ACK")
        val beforeConfig = view.changes
        ReadinessNetwork.config.complete(NativeRoomCommunityConfig(room.id, 1, emptyList(), emptyList()))
        view.flush()
        verify(view.changes > beforeConfig, "matching configuration ACK invalidates readiness")
        view.render()
        verify(view.ready, "real readiness becomes enabled after capability and configuration ACKs")
        val beforeClose = view.changes
        state.open(null)
        view.flush()
        verify(view.changes > beforeClose, "closing Room invalidates observed readiness")
        view.render()
        verify(!view.ready, "closed Room cannot retain enabled membership action")
        ReadinessNetwork.reset()
        state.open(room)
        view.flush(); view.render()
        ReadinessNetwork.capability.complete(NativeRoomManagementCapabilities(false))
        view.flush(); view.render()
        verify(view.ready, "explicit unsupported capability permits existing legacy membership path")
        auth.account = null
        view.flush(); view.render()
        verify(!view.ready, "account departure immediately fails readiness closed")
    } finally { view.stop(); state.dispose(); scope.cancel() }
    println("PASS: $checks actual RoomManagementState observer checks")
}
