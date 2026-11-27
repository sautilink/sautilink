package com.sautilink.nativeapp.feature.home

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.auth.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Actual feed-gallery pixel regression, including the photo control. No live session/network. */
class HomeVideoCoverMatteTest {
    @get:Rule val compose=createComposeRule()
    private fun galleryStages(dark:Boolean) {
        val context=object:ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext():Context=this
            override fun getSharedPreferences(name:String,mode:Int):SharedPreferences=
                baseContext.getSharedPreferences("home_video_matte_fixture_$name",mode)
        }
        val auth=StagingAuthClient("sb_publishable_offline_ui_fixture",context,SautiBackend.PRODUCTION).apply {forgetSavedSession()}
        val video="00000000-0000-4000-8000-000000000001"
        val photo="00000000-0000-4000-8000-000000000002"
        val photoMatte=if(dark) Color(0xFF505050) else Color(0xFFF7F7FA)
        compose.setContent {
            MaterialTheme(colorScheme=if(dark) darkColorScheme(surfaceVariant=photoMatte) else lightColorScheme(surfaceVariant=photoMatte)) {
                Column(Modifier.width(240.dp)) {
                    PostMediaGallery(auth,listOf(FeedMedia(video,"video",0,540,960,6000)))
                    PostMediaGallery(auth,listOf(FeedMedia(photo,"image",0,540,675)))
                }
            }
        }
        fun verify(id:String,expected:Color) {
            val pixels=compose.onNodeWithTag("post-media:$id",useUnmergedTree=true).captureToImage().toPixelMap()
            for(x in listOf(.02f,.98f)) for(y in listOf(.1f,.5f,.9f)) {
                val pixel=pixels[(pixels.width*x).toInt(),(pixels.height*y).toInt()]
                assertEquals(expected.red,pixel.red,.01f);assertEquals(expected.green,pixel.green,.01f)
                assertEquals(expected.blue,pixel.blue,.01f);assertEquals(1f,pixel.alpha,.01f)
            }
        }
        verify(video,Color.Black)
        verify(photo,photoMatte)
    }
    @Test fun lightFeedKeepsItsPendingVideoBlackAndItsPhotoThemeColoured()=galleryStages(false)
    @Test fun darkFeedUsesTheSameVideoMatteWithoutChangingPhotoBackgrounds()=galleryStages(true)
}
