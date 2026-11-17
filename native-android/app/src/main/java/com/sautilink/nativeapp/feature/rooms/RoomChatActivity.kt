package com.sautilink.nativeapp.feature.rooms

import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal data class RoomChatActivity(
    val onlineCount: Int = 0,
    val onlineMemberIds: Set<String> = emptySet(),
    val typingCount: Int = 0,
) {
    fun label(memberCount: Int): String? = when {
        typingCount == 1 -> "Someone is typing…"
        typingCount > 1 -> "${typingCount} people are typing…"
        onlineCount > 0 -> "${roomMemberCount(memberCount)}, $onlineCount online"
        else -> null
    }
}

@Composable
internal fun rememberRoomChatActivity(state: RoomsState, room: NativeRoom?): RoomChatActivity {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val transport = remember(state.auth) { NativeRoomsTransport(state.auth, timeoutSeconds = 7) }
    var activity by remember(state, room?.id, room?.canReadPosts) { mutableStateOf(RoomChatActivity()) }
    LaunchedEffect(state, room?.id, room?.canReadPosts, lifecycle) {
        if (room?.canReadPosts != true) return@LaunchedEffect
        val viewer = runCatching { transport.guard(room) }.getOrNull() ?: return@LaunchedEffect
        val draft = state.draft(room)
        var supported = true
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var visible = false
            var failures = 0
            suspend fun pulse(typing: Boolean, active: Boolean): RoomChatActivity? {
                val response = transport.rest(viewer, "rpc/room_chat_activity_v1", "POST", JSONObject()
                    .put("p_room_id", room.id).put("p_typing", typing).put("p_active", active))
                val row = response.optJSONObject(0) ?: return null
                val ids = row.optJSONArray("online_member_ids")
                val online = if (ids == null) emptySet() else (0 until ids.length())
                    .map { ids.optString(it) }.filter(NativeRoomRules.uuid::matches).toSet()
                return RoomChatActivity(row.optInt("online_count").coerceAtLeast(0), online,
                    row.optInt("typing_count").coerceAtLeast(0))
            }
            try {
                while (supported && isActive && state.selected?.id == room.id && state.auth.account?.id == viewer) {
                    try {
                        val typing = draft.typedAt > 0 && SystemClock.elapsedRealtime() - draft.typedAt < 4_500 &&
                            state.selected?.canPost == true && !state.busy("publish")
                        val fresh = pulse(typing, active = true)
                        visible = fresh != null
                        activity = fresh ?: RoomChatActivity()
                        failures = 0
                        delay(if (visible) 3_500 else 25_000)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        activity = RoomChatActivity()
                        if (failure is AuthRequestException && failure.httpStatus in setOf(401, 403, 404)) supported = false
                        else {
                            failures++
                            delay((failures * 6_000L).coerceAtMost(30_000L))
                        }
                    }
                }
            } finally {
                activity = RoomChatActivity()
                draft.stopTyping()
                if (visible && state.auth.account?.id == viewer) withContext(NonCancellable) {
                    runCatching { pulse(typing = false, active = false) }
                }
            }
        }
    }
    return activity
}
