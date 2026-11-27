package com.sautilink.nativeapp.feature.videos

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage

/** A pending or unavailable poster must never expose the app's light photo
 * placeholder over the black video stage while a new clip is preparing. */
@Composable
internal fun ShortVideoCover(auth: StagingAuthClient, mediaId: String, modifier: Modifier = Modifier,
    crop: Boolean = false) {
    AuthorizedImage(auth, "/api/sauti-media/$mediaId?poster=1", "Video cover", modifier,
        crop = crop, showFailureFallback = false,
        backgroundColor = Color.Black, loadingContent = {})
}
