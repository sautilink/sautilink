package com.sautilink.nativeapp.feature.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

// No credentials, HTTP, Android Context, or backend calls in this isolated observer regression.
data class StagingAccount(val id: String)
class StagingAuthClient(initialId: String) {
    var account by mutableStateOf<StagingAccount?>(StagingAccount(initialId))
}
