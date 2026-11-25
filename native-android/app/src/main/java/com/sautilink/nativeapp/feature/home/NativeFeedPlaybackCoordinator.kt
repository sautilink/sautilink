package com.sautilink.nativeapp.feature.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/** App-session arbiter. A handoff pauses the previous players before allowing a new one. */
internal class NativeFeedPlaybackCoordinator {
    data class Candidate(val group: String, val fraction: Float, val distance: Float)
    private val candidates = linkedMapOf<String, Candidate>()
    private val players = linkedMapOf<String, Pair<String, () -> Unit>>()
    private var manual: String? = null
    private var pausedGroups by mutableStateOf(emptySet<String>())
    var activeGroup by mutableStateOf<String?>(null)
        private set

    fun update(key: String, candidate: Candidate) {
        candidates[key] = candidate
        choose()
    }

    fun remove(key: String) {
        val removed = candidates.remove(key)
        if (removed != null && candidates.values.none { it.group == removed.group }) pausedGroups -= removed.group
        if (manual == key) manual = null
        choose()
    }

    fun isPaused(group: String?) = group in pausedGroups
    fun pauseGroup(group: String) {
        pausedGroups += group
        players.values.filter { it.first == group }.forEach { it.second() }
    }
    fun resumeGroup(group: String) { pausedGroups -= group }

    fun selectManually(key: String) {
        if ((candidates[key]?.fraction ?: 0f) > .1f) { manual = key; choose() }
    }

    fun selectGroupManually(group: String) {
        candidates.entries.filter { it.value.group == group && it.value.fraction > .1f }
            .minByOrNull { it.value.distance }?.key?.let(::selectManually)
    }

    private fun choose() {
        if ((candidates[manual]?.fraction ?: 0f) <= .1f) manual = null
        val next = candidates[manual] ?: candidates.entries
            .filter { it.value.fraction >= .58f }
            .sortedWith(compareByDescending<Map.Entry<String, Candidate>> { it.value.fraction }
                .thenBy { it.value.distance }.thenBy { it.key }).firstOrNull()?.value
        val group = next?.group
        if (activeGroup != group) {
            players.values.filter { it.first != group }.forEach { it.second() }
            activeGroup = group
        }
    }

    fun play(key: String, group: String, pause: () -> Unit, start: () -> Unit): Boolean {
        if (activeGroup != group || isPaused(group)) { pause(); return false }
        players.values.filter { it.first != group }.forEach { it.second() }
        players[key] = group to pause
        start()
        return true
    }

    fun release(key: String) { players.remove(key)?.second?.invoke() }
}

internal val LocalNativeFeedPlayback = staticCompositionLocalOf<NativeFeedPlaybackCoordinator?> { null }
