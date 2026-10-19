package com.sautilink.nativeapp.feature.auth

import com.sautilink.nativeapp.ui.components.SautiCopyrightFooter

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.launch

private enum class SignupStep { DETAILS, EMAIL_CODE, REQUIREMENTS, PHONE_CODE, ONBOARDING, COMPLETE }

private val reservedNames = setOf(
    "admin", "administrator", "root", "support", "security", "sautilink", "cloudengine",
    "official", "api", "help", "about", "settings", "login", "signup", "account",
    "privacy", "terms", "contact", "waitlist"
)

private fun signupEmail(value: String) = android.util.Patterns.EMAIL_ADDRESS.matcher(value.trim()).matches()
private fun birthDateOk(value: String) = signupBirthDateIso(value) != null

private fun signupValidation(username: String, name: String, email: String, password: String,
                             phone: String, birthDate: String): String? {
    val handle = username.trim().lowercase().removePrefix("@")
    if (!Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(handle) || handle in reservedNames)
        return "Choose a username with 3–30 lowercase letters, numbers, dots or underscores (not reserved)."
    if (name.trim().length !in 1..80) return "Display name must be 1–80 characters."
    if (!signupEmail(email)) return "Enter a valid email address."
    if (phone.isNotBlank() && !validSignupPhone(phone)) return "Enter a valid phone with country code, or leave phone empty."
    if (!birthDateOk(birthDate)) return "Enter a valid date of birth in DD/MM/YYYY format."
    if (password.length !in 12..72 || password.none(Char::isLowerCase) || password.none(Char::isUpperCase)
        || password.none(Char::isDigit) || password.none { !it.isLetterOrDigit() })
        return "Password must contain 12–72 characters, uppercase, lowercase, a number and a symbol."
    val lower = password.lowercase()
    if (lower.contains(handle) || email.substringBefore('@').lowercase().takeIf { it.length >= 3 }?.let { lower.contains(it) } == true)
        return "Do not include your username or email name in the password."
    if (lower in setOf("123456789012", "password1234", "qwertyuiop12", "sautilink123", "iloveyou1234", "admin1234567"))
        return "Choose a less common password."
    return null
}

/** Real production signup. The server controls consent, phone policy and verified-email onboarding. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeRegistrationScreen(client: StagingAuthClient, onBack: () -> Unit, onFinished: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(SignupStep.DETAILS) }
    var username by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var birthDate by rememberSaveable { mutableStateOf("") }
    // Passwords and OTPs deliberately do not use rememberSaveable (no saved-state persistence).
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmPasswordVisible by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var channel by rememberSaveable { mutableStateOf("whatsapp") }
    var consent by rememberSaveable { mutableStateOf(false) }
    var phoneVerified by remember { mutableStateOf(false) }
    var phoneRequired by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var progressLoadFailed by remember { mutableStateOf(false) }
    var progressRetry by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }

    fun applyRequirements(gates: SignupRequirements) {
        consent = gates.termsAccepted
        phoneVerified = gates.phoneVerified
        phoneRequired = gates.phoneRequired
        step = if (gates.needsSetup(phone.isNotBlank())) SignupStep.REQUIREMENTS else SignupStep.ONBOARDING
    }

    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        info = null
        scope.launch {
            try { block() }
            catch (e: AuthRequestException) { error = e.message ?: "The request could not complete." }
            catch (_: Exception) { error = "Request failed. Check internet and try again." }
            finally { password = ""; confirmPassword = ""; busy = false }
        }
    }

    // Resume an incomplete production signup after a phone or email verification, sign-in, or restart.
    LaunchedEffect(client.account?.id, progressRetry) {
        val account = client.account ?: return@LaunchedEffect
        if (step != SignupStep.DETAILS) return@LaunchedEffect
        checking = true
        progressLoadFailed = false
        try {
            email = account.email.ifBlank { email }
            username = account.suggestedUsername.ifBlank { username }
            displayName = account.suggestedName.ifBlank { displayName }
            phone = account.signupPhone.ifBlank { account.phone.ifBlank { phone } }
            val existing = client.loadOwnProfile()
            if (existing != null) {
                username = existing.username
                displayName = existing.displayName
                val savedBirthDate = client.loadOwnBirthDate()
                if (savedBirthDate != null) {
                    birthDate = birthDateDigitsFromIso(savedBirthDate)
                    step = SignupStep.COMPLETE
                } else {
                    step = SignupStep.ONBOARDING
                    info = "Your profile exists. Add your date of birth to finish registration."
                }
            } else {
                applyRequirements(client.signupRequirements())
            }
        } catch (e: Exception) {
            error = "Could not load signup progress. Check internet and reopen this page."
            progressLoadFailed = true
        } finally { checking = false }
    }

    fun openPolicy(route: String) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://sautilink.com/$route")))
    }

    SautiAuthPage {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBackIosNew, "Back") }
            Text("Create account", style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold)
        }
        if (step == SignupStep.DETAILS) {
            SautiAuthBrand()
            Text("A place for your voice.",
                style = MaterialTheme.typography.headlineLarge.copy(fontSize = 32.sp,
                    lineHeight = 38.sp, letterSpacing = (-1).sp), fontWeight = FontWeight.Bold)
            Text("Enter your details to get started.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val progressStep = when (step) {
            SignupStep.DETAILS -> 1
            SignupStep.EMAIL_CODE -> 2
            SignupStep.REQUIREMENTS, SignupStep.PHONE_CODE -> 3
            SignupStep.ONBOARDING, SignupStep.COMPLETE -> 4
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(4) { index ->
                Surface(Modifier.weight(1f).height(4.dp), shape = RoundedCornerShape(4.dp),
                    color = if (index < progressStep) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.surfaceContainerHigh) { }
            }
        }
        if (checking || client.sessionState == StagingSessionState.CHECKING) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text("Checking your existing session before registration…",
                style = MaterialTheme.typography.bodySmall)
        }
        if (client.backend != SautiBackend.PRODUCTION) {
            Text("Registration is available on production only.")
        } else if (progressLoadFailed) {
            Text("Your account is signed in, but signup progress could not be checked.")
            Button(onClick = { progressRetry++ }, enabled = !checking) { Text("Retry checking progress") }
        } else when (step) {
            SignupStep.DETAILS -> {
                AuthSectionTitle("Your details", Icons.Rounded.PersonOutline)
                OutlinedTextField(username, { username = it.lowercase().removePrefix("@") },
                    label = { Text("Username") },
                    leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(), singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(displayName, { displayName = it },
                    label = { Text("Display name") },
                    leadingIcon = { Icon(Icons.Rounded.PersonOutline, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(), singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(email, { email = it }, label = { Text("Email address (required)") },
                    leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(phone, { phone = it }, label = { Text("Phone number (optional)") },
                    leadingIcon = { Icon(Icons.Rounded.PhoneAndroid, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    placeholder = { Text("Include country code, e.g. +255…") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                AuthBirthDateField(birthDate, { birthDate = it }, Modifier.fillMaxWidth())
                OutlinedTextField(password, { password = it }, label = { Text("Password") },
                    leadingIcon = { Icon(Icons.Rounded.Lock, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = { IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(if (passwordVisible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                            if (passwordVisible) "Hide password" else "Show password", Modifier.size(21.dp))
                    } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(confirmPassword, { confirmPassword = it }, label = { Text("Confirm password") },
                    leadingIcon = { Icon(Icons.Rounded.Lock, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    visualTransformation = if (confirmPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = { IconButton(onClick = { confirmPasswordVisible = !confirmPasswordVisible }) {
                        Icon(if (confirmPasswordVisible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                            if (confirmPasswordVisible) "Hide confirm password" else "Show confirm password", Modifier.size(21.dp))
                    } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                if (phone.isNotBlank()) {
                    Text("Send phone verification by", style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        FilterChip(channel == "whatsapp", onClick = { channel = "whatsapp" }, label = { Text("WhatsApp") })
                        FilterChip(channel == "sms", onClick = { channel = "sms" }, label = { Text("SMS") })
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = consent, onCheckedChange = { consent = it })
                    Text("I agree to the Terms of Service and acknowledge the Privacy Policy.",
                        style = MaterialTheme.typography.bodySmall)
                }
                Row {
                    TextButton(onClick = { openPolicy("terms") }) { Text("Read Terms") }
                    TextButton(onClick = { openPolicy("privacy") }) { Text("Read Privacy") }
                }
                Button(onClick = {
                    val issue = signupValidation(username, displayName, email, password, phone, birthDate)
                    when {
                        issue != null -> error = issue
                        password != confirmPassword -> error = "Passwords do not match."
                        !consent -> error = "You must agree to the Terms and acknowledge the Privacy Policy."
                        else -> action {
                            phone = normalizedSignupPhone(phone)
                            client.createAccount(email, password, username, displayName, phone)
                            if (client.account != null) applyRequirements(client.signupRequirements())
                            else step = SignupStep.EMAIL_CODE
                            info = if (step == SignupStep.EMAIL_CODE) "Check your email for the 8-digit code." else null
                        }
                    }
                }, enabled = !busy && !checking && client.account == null &&
                    client.sessionState != StagingSessionState.CHECKING && client.configured,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = SautiShape.Pill) { Text("Create account") }
                TextButton(onClick = { step = SignupStep.EMAIL_CODE; error = null },
                    modifier = Modifier.fillMaxWidth()) { Text("Already have a signup email code?") }
            }
            SignupStep.EMAIL_CODE -> {
                AuthSectionTitle("2 of 4 · Verify email", Icons.Rounded.MarkEmailRead)
                Text("Enter the 8-digit code sent to your email. Do not share it.")
                OutlinedTextField(email, { email = it }, label = { Text("Signup email address") },
                    leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                OutlinedTextField(code, { code = it.filter(Char::isDigit).take(8) },
                    label = { Text("8-digit email code") },
                    leadingIcon = { Icon(Icons.Rounded.Key, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                Button(onClick = { action {
                    client.verifyEmailCode(email, code); code = ""
                    val account = client.account
                    if (account != null) {
                        username = account.suggestedUsername.ifBlank { username }
                        displayName = account.suggestedName.ifBlank { displayName }
                        phone = account.signupPhone.ifBlank { phone }
                    }
                    applyRequirements(client.signupRequirements())
                } }, enabled = !busy && signupEmail(email) && code.length == 8,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = SautiShape.Pill) { Text("Verify email") }
                TextButton(onClick = { action {
                    client.resendSignupEmailCode(email)
                    info = "If this email has a pending signup, a new 8-digit code will arrive."
                } }, enabled = !busy && signupEmail(email)) { Text("Resend email code") }
            }
            SignupStep.REQUIREMENTS -> {
                AuthSectionTitle("3 of 4 · Account agreement", Icons.Rounded.Shield)
                Text(if (phoneVerified) "Your phone is verified. Accept the documents to continue."
                    else if (phoneRequired) "Accept the documents. The current account policy also requires phone verification."
                    else "Accept the documents to continue. You can verify a phone now or leave it empty.")
                if (!phoneVerified) {
                    OutlinedTextField(phone, { phone = it },
                        label = { Text(if (phoneRequired) "Phone with country code" else "Phone number (optional)") },
                        leadingIcon = { Icon(Icons.Rounded.PhoneAndroid, null, Modifier.size(21.dp)) },
                        shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (phone.isNotBlank()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            FilterChip(channel == "whatsapp", onClick = { channel = "whatsapp" }, label = { Text("WhatsApp") })
                            FilterChip(channel == "sms", onClick = { channel = "sms" }, label = { Text("SMS") })
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = consent, onCheckedChange = { consent = it })
                    Text("I agree to Terms of Service and acknowledge Privacy Policy.",
                        style = MaterialTheme.typography.bodySmall)
                }
                Row {
                    TextButton(onClick = { openPolicy("terms") }) { Text("Terms") }
                    TextButton(onClick = { openPolicy("privacy") }) { Text("Privacy") }
                }
                Button(onClick = {
                    if (!consent) { error = "Review and accept the account documents first."; return@Button }
                    if (!phoneVerified && phone.isNotBlank() && !validSignupPhone(phone)) {
                        error = "Enter a valid phone number including country code, or leave phone empty."; return@Button
                    }
                    action {
                        client.acceptSignupDocuments()
                        val gates = client.signupRequirements()
                        phoneVerified = gates.phoneVerified
                        phoneRequired = gates.phoneRequired
                        if (gates.required && !gates.termsAccepted) {
                            throw AuthRequestException("The agreement could not be confirmed. Try again.")
                        }
                        if (!gates.needsSetup(phone.isNotBlank())) {
                            step = SignupStep.ONBOARDING
                        } else {
                            if (phone.isBlank()) {
                                throw AuthRequestException("The current account policy requires a verified phone. Enter a phone with country code to continue.")
                            }
                            phone = normalizedSignupPhone(phone)
                            client.sendSignupPhoneCode(phone, channel)
                            code = ""; step = SignupStep.PHONE_CODE
                            info = "A verification code was requested by ${if (channel == "sms") "SMS" else "WhatsApp"}."
                        }
                    }
                }, enabled = !busy && !checking, modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = SautiShape.Pill) { Text(if (phoneVerified || (!phoneRequired && phone.isBlank())) "Continue" else "Send phone code") }
                TextButton(onClick = { action {
                    val gates = client.signupRequirements()
                    phoneVerified = gates.phoneVerified
                    phoneRequired = gates.phoneRequired
                    if (!gates.needsSetup(phone.isNotBlank())) step = SignupStep.ONBOARDING
                    else info = if (gates.phoneReady(phone.isNotBlank())) "Accept the documents to continue."
                        else "Phone verification is still pending. Enter the code when it arrives."
                } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text("Refresh verification status")
                }
            }
            SignupStep.PHONE_CODE -> {
                AuthSectionTitle("3 of 4 · Confirm phone", Icons.Rounded.PhoneAndroid)
                Text("Enter the verification code sent to $phone.")
                OutlinedTextField(code, { code = it.filter(Char::isDigit).take(10) },
                    label = { Text("Phone verification code") },
                    leadingIcon = { Icon(Icons.Rounded.Key, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { action {
                    client.confirmSignupPhoneCode(phone, code)
                    code = ""; phoneVerified = true; step = SignupStep.ONBOARDING
                } }, enabled = !busy && code.length in 6..10,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = SautiShape.Pill) { Text("Verify phone") }
                TextButton(onClick = { step = SignupStep.REQUIREMENTS; code = "" }) { Text("Request a new code") }
            }
            SignupStep.ONBOARDING -> {
                AuthSectionTitle("4 of 4 · Finish your account", Icons.Rounded.PersonOutline)
                Text("Choose the public details for your verified SautiLink profile.")
                OutlinedTextField(username, { username = it.lowercase().removePrefix("@") },
                    label = { Text("Username") },
                    leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(displayName, { displayName = it },
                    label = { Text("Display name") },
                    leadingIcon = { Icon(Icons.Rounded.PersonOutline, null, Modifier.size(21.dp)) },
                    shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
                    modifier = Modifier.fillMaxWidth(), singleLine = true)
                AuthBirthDateField(birthDate, { birthDate = it }, Modifier.fillMaxWidth())
                Button(onClick = {
                    val handle = username.trim().lowercase()
                    if (!Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(handle) || handle in reservedNames) {
                        error = "Choose a valid, non-reserved username."; return@Button
                    }
                    if (displayName.trim().length !in 1..80 || !birthDateOk(birthDate)) {
                        error = "Enter a display name (1–80 characters) and valid date of birth."; return@Button
                    }
                    val isoBirthDate = signupBirthDateIso(birthDate) ?: return@Button
                    action { client.finishSignup(username, displayName, isoBirthDate, phone); step = SignupStep.COMPLETE }
                }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = SautiShape.Pill) { Text("Finish registration") }
            }
            SignupStep.COMPLETE -> {
                AuthSectionTitle("Your SautiLink account is ready", Icons.Rounded.CheckCircle)
                Text("Email, signup requirements and your profile have been checked. Welcome to SautiLink.")
                Button(onClick = onFinished, modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = SautiShape.Pill) { Text("Continue") }
            }
        }
        if (step in setOf(SignupStep.REQUIREMENTS, SignupStep.PHONE_CODE, SignupStep.ONBOARDING) && client.account != null) {
            TextButton(onClick = {
                action {
                    client.signOut()
                    step = SignupStep.DETAILS; consent = false; phoneVerified = false; phoneRequired = true; code = ""
                    info = "Signed out. You can sign in later to resume signup."
                }
            }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Decline agreement or sign out") }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error != null) {
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(14.dp)) {
                Text(error.orEmpty(), Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        if (info != null) {
            Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(14.dp)) {
                Text(info.orEmpty(), Modifier.padding(14.dp))
            }
        }
        if (step != SignupStep.COMPLETE) {
            Text("SautiLink never asks you to share your password or verification code with support.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        SautiCopyrightFooter()
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
fun NativeRecoveryScreen(client: StagingAuthClient, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    SautiAuthPage {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBackIosNew, "Back") }
            Text("Recover your account", style = MaterialTheme.typography.titleLarge)
        }
        SautiAuthBrand()
        AuthSectionTitle("Let’s get you back in", Icons.Rounded.LockReset)
        Text("Password recovery uses an official secure email link, not an OTP. The link opens SautiLink's verified recovery page in your browser.")
        OutlinedTextField(email, { email = it; sent = false }, label = { Text("Email address") },
            leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null, Modifier.size(21.dp)) },
            shape = RoundedCornerShape(16.dp), colors = authFieldColors(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(), singleLine = true)
        if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
        if (sent) Text("If an account uses this email, a secure recovery link is on its way. Open it from your email and set a new password on SautiLink.")
        Button(onClick = {
            busy = true; error = null
            scope.launch {
                try { client.requestPasswordRecovery(email); sent = true }
                catch (e: AuthRequestException) { error = e.message ?: "Recovery request failed." }
                catch (_: Exception) { error = "Network error. Try again." }
                finally { busy = false }
            }
        }, enabled = signupEmail(email) && !busy && client.configured,
            modifier = Modifier.fillMaxWidth().height(52.dp), shape = SautiShape.Pill) {
            Text(if (busy) "Sending…" else "Send recovery link")
        }
        Text("For account security, never forward recovery links or share authentication codes.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}
