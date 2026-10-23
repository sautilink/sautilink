package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.ui.state.SessionScreenPresentation
import com.sautilink.nativeapp.ui.state.SessionScreenPresentationStore
import com.sautilink.nativeapp.ui.state.SessionPresentationInitial
import com.sautilink.nativeapp.ui.state.readSessionPresentationInitial

internal data class RoomReturnAnchor(val index: Int, val offset: Int)
/** No Room rows, membership, moderator capabilities, posts, or member lists are retained. */
internal data class RoomsReturnPresentation(val tab: RoomsTab, val search: String, val category: String?,
    val anchors: Map<String, RoomReturnAnchor>) : SessionScreenPresentation

internal fun readRoomsReturnPresentation(store: SessionScreenPresentationStore?): SessionPresentationInitial<RoomsReturnPresentation> =
    readSessionPresentationInitial(store, "rooms-navigation", RoomsReturnPresentation::class.java,
        RoomsReturnPresentation(RoomsTab.DISCOVER, "", null, emptyMap()))

internal fun readRoomReturnAnchor(anchors: Map<String, RoomReturnAnchor>, key: String): RoomReturnAnchor =
    anchors[key] ?: RoomReturnAnchor(0, 0)
