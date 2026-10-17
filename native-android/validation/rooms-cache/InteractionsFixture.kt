package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.StagingAuthClient

class PostInteractionsClient(auth: StagingAuthClient) {
    suspend fun getLikeStates(ids: List<String>): Map<String, Boolean> = error("Unexpected actions read")
    suspend fun getSavedStates(ids: List<String>): Map<String, Boolean> = error("Unexpected actions read")
    suspend fun getRepostStates(ids: List<String>): Map<String, Boolean> = error("Unexpected actions read")
    suspend fun setLike(id: String, value: Boolean): Unit = error("Unexpected action")
    suspend fun setSaved(id: String, value: Boolean): Unit = error("Unexpected action")
    suspend fun setRepost(id: String, value: Boolean): Unit = error("Unexpected action")
}
