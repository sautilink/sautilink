package com.sautilink.nativeapp.feature.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.R

/** Native branding shared by login and signup; Inter follows the app typography. */
@Composable
internal fun SautiAuthBrand() {
    Row(Modifier.fillMaxWidth().padding(vertical = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center) {
        Image(painterResource(R.mipmap.ic_launcher), "SautiLink logo",
            Modifier.size(54.dp))
        Spacer(Modifier.width(10.dp))
        Text("SautiLink",
            style = MaterialTheme.typography.headlineMedium.copy(fontSize = 27.sp),
            fontWeight = FontWeight.ExtraBold,
            color = MaterialTheme.colorScheme.onSurface)
    }
}
