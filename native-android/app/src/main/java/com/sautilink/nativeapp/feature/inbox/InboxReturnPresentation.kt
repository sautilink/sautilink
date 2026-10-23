package com.sautilink.nativeapp.feature.inbox

import com.sautilink.nativeapp.ui.state.SessionScreenPresentation
import com.sautilink.nativeapp.ui.state.SessionScreenPresentationStore
import com.sautilink.nativeapp.ui.state.SessionPresentationInitial
import com.sautilink.nativeapp.ui.state.readSessionPresentationInitial

internal data class ConversationReturnAnchor(val index: Int, val offset: Int)
/** Drafts and anchors only. Threads, receipts and peer/presence permissions must be read afresh. */
internal data class InboxReturnPresentation(
    val selectedId: String?, val drafts: Map<String, String>,
    val anchors: Map<String, ConversationReturnAnchor>,
) : SessionScreenPresentation

internal fun readInboxReturnPresentation(store: SessionScreenPresentationStore?): SessionPresentationInitial<InboxReturnPresentation> =
    readSessionPresentationInitial(store, "inbox-navigation", InboxReturnPresentation::class.java,
        InboxReturnPresentation(null, emptyMap(), emptyMap()))

internal data class ConversationReturnInitial(val restored: Boolean, val anchor: ConversationReturnAnchor)

internal fun readConversationReturnAnchor(anchors: Map<String, ConversationReturnAnchor>, id: String): ConversationReturnInitial {
    val anchor = anchors[id]
    return if (anchor == null) ConversationReturnInitial(false, ConversationReturnAnchor(0, 0))
        else ConversationReturnInitial(true, anchor)
}

internal data class InboxReadPlan(val list: Boolean, val forwardDestinations: Boolean)

internal fun inboxReadPlan(signedIn: Boolean, foreground: Boolean, selectedId: String?,
    forwarding: Boolean, hasConversations: Boolean): InboxReadPlan = InboxReadPlan(
    list = signedIn && foreground && selectedId == null,
    forwardDestinations = signedIn && foreground && selectedId != null && forwarding && !hasConversations,
)

internal fun shouldFollowConversationTail(firstLayout: Boolean, hasReturnAnchor: Boolean,
    nearTail: Boolean, newOwnMessage: Boolean, searching: Boolean): Boolean =
    !searching && (firstLayout && !hasReturnAnchor || !firstLayout && (nearTail || newOwnMessage))
