package com.sautilink.nativeapp.feature.profile

import com.sautilink.nativeapp.ui.state.SessionScreenPresentation
import com.sautilink.nativeapp.ui.state.SessionScreenPresentationStore
import com.sautilink.nativeapp.ui.state.SessionPresentationInitial
import com.sautilink.nativeapp.ui.state.readSessionPresentationInitial

internal data class ProfileReturnPresentation(val scroll: Int) : SessionScreenPresentation
internal data class ProfileActivityReturnPresentation(val tab: String) : SessionScreenPresentation
/** Public taxonomy labels only; category saves still validate the live catalog. */
internal data class ProfileCatalogPresentation(val categories: List<ProfileProfessionalCategory>) : SessionScreenPresentation

internal fun readProfileReturnPresentation(store: SessionScreenPresentationStore?, key: String): SessionPresentationInitial<ProfileReturnPresentation> =
    readSessionPresentationInitial(store, key, ProfileReturnPresentation::class.java, ProfileReturnPresentation(0))

internal fun readProfileCatalogPresentation(store: SessionScreenPresentationStore?): SessionPresentationInitial<ProfileCatalogPresentation> =
    readSessionPresentationInitial(store, "profile-category-labels", ProfileCatalogPresentation::class.java,
        ProfileCatalogPresentation(emptyList()))

internal fun readProfileActivityReturnPresentation(store: SessionScreenPresentationStore?, key: String): SessionPresentationInitial<ProfileActivityReturnPresentation> =
    readSessionPresentationInitial(store, key, ProfileActivityReturnPresentation::class.java, ProfileActivityReturnPresentation("posts"))
