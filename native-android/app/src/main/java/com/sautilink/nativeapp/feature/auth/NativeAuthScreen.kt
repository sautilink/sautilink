package com.sautilink.nativeapp.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBackIosNew
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MarkEmailRead
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch

private enum class LoginMethod(val label: String) {
    PASSWORD("Password"), EMAIL_CODE("Email code"), PHONE_CODE("Phone code")
}

/** Environment-specific native login; staging and production sessions never share storage. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeAuthScreen(client: StagingAuthClient, onBack: () -> Unit, onViewProfile: () -> Unit,
                     onRegister: (() -> Unit)? = null, onRecovery: (() -> Unit)? = null,
                     onBeforeSignOut: suspend () -> Unit = {}) {
    var method by remember { mutableStateOf(LoginMethod.PASSWORD) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var codeRequested by remember { mutableStateOf(false) }
    var linkingPhone by remember { mutableStateOf(false) }
    var linkPhone by remember { mutableStateOf("") }
    var linkChannel by remember { mutableStateOf("whatsapp") }
    var linkCode by remember { mutableStateOf("") }
    var linkCodeRequested by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val account = client.account
    val sessionState = client.sessionState
    val scope = rememberCoroutineScope()

    fun runAction(action: suspend () -> Unit) {
        if (loading) return
        loading = true
        message = null
        scope.launch {
            try { action() }
            catch (e: AuthRequestException) { message = e.message ?: "Authentication failed." }
            catch (_: Exception) { message = "Authentication failed. Please try again." }
            finally { password = ""; loading = false }
        }
    }

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .imePadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Rounded.ArrowBackIosNew, contentDescription = "Back")
            }
            Spacer(Modifier.width(6.dp))
            Text("Login", style = MaterialTheme.typography.headlineMedium)
        }

        SautiAuthBrand()
        if (account == null) {
            Text("Log in to your account", style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface)
        }

        if (!client.configured) {
            Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.errorContainer) {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Sign-in temporarily unavailable", style = MaterialTheme.typography.titleMedium)
                    Text("Please try again later or contact SautiLink support.",
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else if (sessionState == StagingSessionState.CHECKING) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Text("Restoring your session…", style = MaterialTheme.typography.bodyMedium)
        } else if (sessionState == StagingSessionState.RETRYABLE_ERROR) {
            Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Could not restore session", style = MaterialTheme.typography.titleLarge)
                    Text("We kept your encrypted login. Check your internet and try again. " +
                        "You can also sign out locally to use another account.",
                        style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { runAction { client.restoreSession() } }, enabled = !loading,
                        modifier = Modifier.fillMaxWidth(), shape = SautiShape.Pill) { Text("Retry session") }
                    OutlinedButton(onClick = { runAction {
                        runCatching { onBeforeSignOut() }
                        client.forgetSavedSession(); message = null
                    } },
                        modifier = Modifier.fillMaxWidth(), shape = SautiShape.Pill) { Text("Sign out on this device") }
                }
            }
        } else if (account != null) {
            Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Rounded.MarkEmailRead, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
                    Text("You're signed in", style = MaterialTheme.typography.titleLarge)
                    Text(account!!.displayName, style = MaterialTheme.typography.bodyLarge)
                    Text("Your session is securely stored on this device.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                    if (client.backend == SautiBackend.PRODUCTION) {
                        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = SautiShape.Pill) { Text("Back to Home") }
                    }
                    FilledTonalButton(onClick = onViewProfile,
                        modifier = Modifier.fillMaxWidth().height(50.dp), shape = SautiShape.Pill) {
                        Text("View my profile")
                    }
                    if (onRegister != null) {
                        TextButton(onClick = onRegister, modifier = Modifier.fillMaxWidth()) {
                            Text("Finish an incomplete account setup")
                        }
                    }
                    if (client.backend == SautiBackend.PRODUCTION && account.phone.isBlank()) {
                        if (!linkingPhone) {
                            OutlinedButton(onClick = { linkingPhone = true; message = null },
                                modifier = Modifier.fillMaxWidth(), shape = SautiShape.Pill) {
                                Text("Verify a phone for this account")
                            }
                        } else {
                            Text("Verify your phone", style = MaterialTheme.typography.titleMedium)
                            Text("Choose where SautiLink should send the code. Your account stays signed in.",
                                style = MaterialTheme.typography.bodySmall)
                            OutlinedTextField(value = linkPhone,
                                onValueChange = {
                                    if (!linkCodeRequested) linkPhone = it
                                }, label = { Text("Phone (+255...)") },
                                modifier = Modifier.fillMaxWidth(), singleLine = true,
                                enabled = !loading && !linkCodeRequested,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                            if (!linkCodeRequested) {
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    FilterChip(selected = linkChannel == "whatsapp",
                                        onClick = { linkChannel = "whatsapp" }, label = { Text("WhatsApp") })
                                    FilterChip(selected = linkChannel == "sms",
                                        onClick = { linkChannel = "sms" }, label = { Text("SMS") })
                                }
                            } else {
                                OutlinedTextField(value = linkCode,
                                    onValueChange = { linkCode = it.filter(Char::isDigit).take(10) },
                                    label = { Text("Phone verification code") },
                                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                            }
                            Button(onClick = { runAction {
                                if (!linkCodeRequested) {
                                    client.sendSignupPhoneCode(linkPhone, linkChannel)
                                    linkCodeRequested = true
                                    message = "A code was requested by ${if (linkChannel == "sms") "SMS" else "WhatsApp"}."
                                } else {
                                    client.confirmSignupPhoneCode(linkPhone, linkCode)
                                    linkCode = ""; linkCodeRequested = false; linkingPhone = false
                                    message = "Phone verified for this account."
                                }
                            } }, enabled = !loading &&
                                (if (linkCodeRequested) linkCode.length in 6..10
                                 else Regex("^\\+[1-9][0-9]{7,14}$").matches(
                                     linkPhone.trim().replace(Regex("[\\s()\\-]"), ""))),
                                modifier = Modifier.fillMaxWidth(), shape = SautiShape.Pill) {
                                Text(if (linkCodeRequested) "Verify phone" else "Send phone code")
                            }
                            TextButton(onClick = {
                                if (linkCodeRequested) { linkCodeRequested = false; linkCode = "" }
                                else linkingPhone = false
                                message = null
                            }, enabled = !loading) { Text(if (linkCodeRequested) "Request a new code" else "Cancel") }
                        }
                    }
                    if (message != null) {
                        Text(message.orEmpty(), style = MaterialTheme.typography.bodyMedium)
                    }
                    Button(onClick = { runAction {
                        runCatching { onBeforeSignOut() }
                        client.signOut(); codeRequested = false; code = ""
                    } },
                        enabled = !loading, modifier = Modifier.fillMaxWidth().height(50.dp),
                        shape = SautiShape.Pill) { Text("Sign out") }
                }
            }
        } else {
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                LoginMethod.entries.forEachIndexed { index, option ->
                    SegmentedButton(
                        selected = method == option,
                        onClick = { method = option; message = null; code = ""; codeRequested = false },
                        enabled = !loading,
                        shape = SegmentedButtonDefaults.itemShape(index, LoginMethod.entries.size)
                    ) { Text(option.label, style = MaterialTheme.typography.labelSmall) }
                }
            }

            when (method) {
                LoginMethod.PASSWORD, LoginMethod.EMAIL_CODE -> {
                    OutlinedTextField(
                        value = email, onValueChange = { email = it }, label = { Text("Email address") },
                        modifier = Modifier.fillMaxWidth(), enabled = !loading,
                        singleLine = true, shape = RoundedCornerShape(18.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                    )
                }
                LoginMethod.PHONE_CODE -> {
                    OutlinedTextField(
                        value = phone, onValueChange = { phone = it },
                        label = { Text("Phone (+255...)") }, modifier = Modifier.fillMaxWidth(),
                        enabled = !loading, singleLine = true,
                        shape = RoundedCornerShape(18.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone)
                    )
                    Text("Delivery uses the WhatsApp/SMS channel already configured on your SautiLink account.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            if (method == LoginMethod.PASSWORD) {
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    label = { Text("Password") }, modifier = Modifier.fillMaxWidth(),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true, enabled = !loading, shape = RoundedCornerShape(18.dp)
                )
            } else if (codeRequested) {
                OutlinedTextField(
                    value = code, onValueChange = { if (it.length <= 10) code = it.filter(Char::isDigit) },
                    label = { Text(if (method == LoginMethod.EMAIL_CODE) "8-digit email code" else "Verification code") },
                    modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !loading,
                    shape = RoundedCornerShape(18.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
                )
            }
            val emailValid = android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()
            val phoneValid = Regex("^\\+[1-9][0-9]{7,14}$").matches(phone.trim())
            val canSubmit = when (method) {
                LoginMethod.PASSWORD -> emailValid && password.isNotEmpty()
                LoginMethod.EMAIL_CODE -> emailValid && (!codeRequested || code.length == 8)
                LoginMethod.PHONE_CODE -> phoneValid && (!codeRequested || code.length in 6..10)
            }
            Button(
                modifier = Modifier.fillMaxWidth().height(54.dp),
                enabled = !loading && canSubmit && client.configured,
                shape = RoundedCornerShape(18.dp),
                onClick = {
                    runAction {
                        when (method) {
                            LoginMethod.PASSWORD -> client.signInWithPassword(email, password)
                            LoginMethod.EMAIL_CODE -> if (!codeRequested) {
                                client.requestEmailCode(email); codeRequested = true
                                message = "If this account exists, check its email for a code."
                            } else { client.verifyEmailCode(email, code); code = "" }
                            LoginMethod.PHONE_CODE -> if (!codeRequested) {
                                client.requestPhoneCode(phone); codeRequested = true
                                message = "If this phone is linked, check its configured delivery channel."
                            } else { client.verifyPhoneCode(phone, code); code = "" }
                        }
                    }
                }
            ) {
                if (loading) CircularProgressIndicator(
                    modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                ) else Text(if (method == LoginMethod.PASSWORD) "Sign in" else if (codeRequested) "Verify code" else "Send code")
            }
            if (method == LoginMethod.PASSWORD && onRecovery != null) {
                TextButton(onClick = onRecovery, modifier = Modifier.fillMaxWidth()) {
                    Text("Forgot password?")
                }
            }
            if (onRegister != null) {
                OutlinedButton(onClick = onRegister, modifier = Modifier.fillMaxWidth(),
                    shape = SautiShape.Pill) { Text("Create a SautiLink account") }
            }
            if (codeRequested && !loading) {
                TextButton(onClick = { codeRequested = false; code = ""; message = null }) {
                    Text("Use another code or address")
                }
            }
            if (message != null) {
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                    Text(message.orEmpty(), Modifier.fillMaxWidth().padding(14.dp),
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}
