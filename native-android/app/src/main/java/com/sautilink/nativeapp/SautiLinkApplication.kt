package com.sautilink.nativeapp

import android.app.Application
import com.sautilink.nativeapp.feature.notifications.createNativePushChannels

class SautiLinkApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createNativePushChannels(this)
    }
}
