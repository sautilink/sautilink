package com.sautilink.nativeapp.feature.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AlternateEmail
import androidx.compose.material.icons.rounded.LockReset
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.R
import com.sautilink.nativeapp.feature.browser.NativeWebBrowserActivity
import com.sautilink.nativeapp.ui.components.SautiIcon
import com.sautilink.nativeapp.ui.components.SautiWordmark
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private const val SUPPORT_URL = "https://sautilink.com/contact"

@Composable
fun NativeRecoveryScreen(
    client: StagingAuthClient, recoveryNotice: String? = null, onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var email by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }

    fun requestRecovery() {
        if (!validAuthEmail(email) || busy || !client.configured) return
        focus.clearFocus()
        busy = true
        error = null
        sent = false
        scope.launch {
            try {
                client.requestPasswordRecovery(email)
                sent = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: AuthRequestException) {
                error = failure.message ?: "Recovery request failed."
            } catch (_: Exception) {
                error = "Network error. Try again."
            } finally {
                busy = false
            }
        }
    }

    SautiAuthPage(hero = { RecoveryNavigation(onBack) }) {
        val colors = MaterialTheme.colorScheme
        Column(Modifier.padding(top = 12.dp, bottom = 12.dp)) {
            Box(Modifier.size(60.dp).background(colors.secondaryContainer, SautiShape.Button),
                contentAlignment = Alignment.Center) {
                SautiIcon(Icons.Rounded.LockReset, null, Modifier.size(30.dp), tint = colors.primary)
            }
            Spacer(Modifier.height(16.dp))
            Text("Recover your account", style = MaterialTheme.typography.headlineLarge,
                color = colors.onSurface, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("Enter the email address on your account. We’ll send a link to reset your password.",
                style = MaterialTheme.typography.bodyLarge, color = colors.onSurfaceVariant)
        }

        if (recoveryNotice != null && !sent) {
            Text(recoveryNotice,
                style = MaterialTheme.typography.bodyMedium, color = colors.error)
        }
        TextField(
            value = email,
            onValueChange = { email = it; sent = false; error = null },
            label = { Text("Email address") },
            leadingIcon = { SautiIcon(Icons.Rounded.AlternateEmail, null, Modifier.size(21.dp)) },
            colors = authUnderlineColors(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { requestRecovery() }),
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
            singleLine = true
        )
        AuthPrimaryButton(onClick = ::requestRecovery,
            enabled = validAuthEmail(email) && !busy && client.configured,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            Text(if (busy) "Sending…" else "Send recovery link")
        }
        if (error != null) {
            Text(error.orEmpty(), color = colors.error, style = MaterialTheme.typography.bodyMedium)
        }
        if (sent) {
            Text("If an account uses this email, a recovery link is on its way. Open it from your email to reset your password on SautiLink.",
                style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
        }

        Spacer(Modifier.height(4.dp))
        RecoverySupportCard()
        Surface(Modifier.fillMaxWidth().padding(bottom = 14.dp), shape = SautiShape.Button,
            border = BorderStroke(1.dp, colors.outlineVariant), color = colors.surface) {
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SautiIcon(Icons.Rounded.VerifiedUser, null, Modifier.size(21.dp), tint = colors.primary)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Protect your account", style = MaterialTheme.typography.titleSmall,
                        color = colors.onSurface, fontWeight = FontWeight.SemiBold)
                    Text("SautiLink support agents will never ask for your password, verification code, recovery link, or other sign-in details.",
                        style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun RecoveryNavigation(onBack: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val interaction = remember { MutableInteractionSource() }
    Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 12.dp)) {
        IconButton(onClick = onBack, interactionSource = interaction,
            modifier = Modifier.align(Alignment.CenterStart).authPress(interaction)
                .background(colors.secondaryContainer, SautiShape.Pill)) {
            SautiIcon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", Modifier.size(21.dp),
                tint = colors.onSurface)
        }
        Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Image(painterResource(R.drawable.sautilink_logo), null,
                Modifier.size(width = 38.dp, height = 20.dp))
            SautiWordmark(Modifier.size(width = 88.dp, height = 20.dp))
        }
    }
}

@Composable
private fun RecoverySupportCard() {
    val context = LocalContext.current
    val colors = MaterialTheme.colorScheme
    val interaction = remember { MutableInteractionSource() }
    var linkFailed by remember { mutableStateOf(false) }
    Surface(Modifier.fillMaxWidth(), shape = SautiShape.Card, color = colors.secondaryContainer) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)) {
            Text("Forgot email?", style = MaterialTheme.typography.titleMedium,
                color = colors.onSecondaryContainer, fontWeight = FontWeight.SemiBold)
            Text("Get help finding the email on your account.", style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            TextButton(
                onClick = { linkFailed = !NativeWebBrowserActivity.open(context, SUPPORT_URL) },
                contentPadding = PaddingValues(end = 12.dp),
                interactionSource = interaction,
                modifier = Modifier.authPress(interaction)
            ) {
                Text("Contact Support", fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(6.dp))
                SautiIcon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(16.dp))
            }
            if (linkFailed) {
                Text("Could not open the support page. Please try again.", color = colors.error,
                    style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
