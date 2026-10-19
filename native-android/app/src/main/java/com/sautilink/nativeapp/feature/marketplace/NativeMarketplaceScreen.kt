package com.sautilink.nativeapp.feature.marketplace

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.theme.SautiShape

@Composable
internal fun MarketplaceButton(onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Rounded.Storefront, "Marketplace", Modifier.size(25.dp))
    }
}

/** A roadmap announcement only. There is no seller registration or commerce API. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeMarketplaceScreen(onBack: () -> Unit) {
    Scaffold(contentWindowInsets = WindowInsets(0, 0, 0, 0), topBar = {
        TopAppBar(windowInsets = WindowInsets(0, 0, 0, 0), title = { Text("Marketplace") }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
        })
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
            .padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.primaryContainer) {
                Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Rounded.Storefront, null, Modifier.size(38.dp),
                        tint = MaterialTheme.colorScheme.primary)
                    Text("Coming soon", style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold)
                    Text("We're testing a new way to buy and sell on SautiLink.",
                        style = MaterialTheme.typography.bodyLarge)
                }
            }
            MarketplaceInfo(Icons.Rounded.VerifiedUser, "Shop with verified businesses",
                "Marketplace will be dedicated to buying and selling products from businesses verified by SautiLink.")
            MarketplaceInfo(Icons.Rounded.FactCheck, "Business verification",
                "To sell products or advertise a business, business accounts will need to pass our verification process and receive certification from SautiLink Corporation.")
            MarketplaceInfo(Icons.Rounded.FavoriteBorder, "Always free to register",
                "Business registration and every registration step on the SautiLink platform will always be free.")
            Text("Marketplace is currently in testing. Rollout and registration details will be announced here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun MarketplaceInfo(icon: ImageVector, title: String, body: String) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().padding(18.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(body, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
