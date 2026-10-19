package com.sautilink.nativeapp.feature.safety

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeAppealsScreen(auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit) {
    val accountId = auth.account?.id
    val client = remember(auth) { NativeAppealsClient(auth) }
    val scope = rememberCoroutineScope()
    var decisions by remember(accountId) { mutableStateOf<List<NativeAppealableDecision>>(emptyList()) }
    var loading by remember(accountId) { mutableStateOf(accountId != null) }
    var refresh by remember(accountId) { mutableIntStateOf(0) }
    var error by remember(accountId) { mutableStateOf<String?>(null) }
    var notice by remember(accountId) { mutableStateOf<String?>(null) }
    var selected by remember(accountId) { mutableStateOf<NativeAppealableDecision?>(null) }
    var reason by remember(accountId) { mutableStateOf("") }
    var submitError by remember(accountId) { mutableStateOf<String?>(null) }
    var submitting by remember(accountId) { mutableStateOf(false) }

    LaunchedEffect(accountId, refresh) {
        if (accountId == null) { decisions = emptyList(); loading = false; return@LaunchedEffect }
        loading = true; error = null
        try {
            val loaded = client.load()
            if (auth.account?.id == accountId) decisions = loaded
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (auth.account?.id == accountId) error = failure.message ?: "Could not load your appeals."
        } finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Appeals", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = accountId != null && !loading && !submitting) {
                Icon(Icons.Rounded.Refresh, "Refresh appeals")
            }
        }
        when {
            accountId == null -> Column(Modifier.fillMaxWidth().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.Gavel, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
                Text(if (auth.sessionState == StagingSessionState.CHECKING) "Restoring session…"
                    else "Sign in to see and manage your appeals.")
                if (auth.sessionState != StagingSessionState.CHECKING)
                    Button(onClick = onSignIn) { Text("Sign in") }
            }
            loading && decisions.isEmpty() -> repeat(3) { SautiExploreSkeleton() }
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Gavel, null, Modifier.size(23.dp), tint = MaterialTheme.colorScheme.primary)
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text("Your moderation decisions", style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold)
                            Text("Review a decision, submit an appeal and follow its status here.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (notice != null) item {
                    Text(notice.orEmpty(), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium)
                }
                if (error != null) item {
                    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.errorContainer) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(error.orEmpty(), color = MaterialTheme.colorScheme.onErrorContainer)
                            TextButton(onClick = { refresh++ }, enabled = !loading) { Text("Try again") }
                        }
                    }
                }
                if (!loading && error == null && decisions.isEmpty()) item {
                    Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface) {
                        Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Rounded.VerifiedUser, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
                            Text("No decisions to appeal", style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold)
                            Text("Any moderation decisions you can appeal will appear here.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                items(decisions, key = { it.id }) { decision ->
                    AppealDecisionCard(decision, enabled = !submitting) {
                        selected = decision; reason = ""; submitError = null
                    }
                }
            }
        }
    }

    selected?.let { decision ->
        ModalBottomSheet(onDismissRequest = { if (!submitting) selected = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().imePadding().padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Rounded.Gavel, null, tint = MaterialTheme.colorScheme.primary)
                    Text("Appeal decision", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                Text(NativeAppealRules.decisionLabel(decision.actionType), style = MaterialTheme.typography.titleSmall)
                Text("Explain why this decision should be reviewed again. Your appeal is sent for review.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(reason, { if (it.length <= 2000) { reason = it; submitError = null } },
                    enabled = !submitting, label = { Text("Reason for appeal") }, minLines = 3, maxLines = 6,
                    modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                    supportingText = { Text(submitError ?: "${reason.length}/2,000 characters") },
                    isError = submitError != null)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { selected = null }, enabled = !submitting,
                        modifier = Modifier.weight(1f)) { Text("Cancel") }
                    Button(onClick = {
                        submitError = NativeAppealRules.reasonError(reason)
                        if (submitError != null || submitting) return@Button
                        submitting = true
                        scope.launch {
                            try {
                                if (auth.account?.id != accountId) return@launch
                                client.submit(decision.id, reason)
                                if (auth.account?.id == accountId) {
                                    selected = null; notice = "Appeal submitted for review."; refresh++
                                }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) {
                                if (auth.account?.id == accountId) submitError = failure.message ?: "Could not submit your appeal."
                            } finally { submitting = false }
                        }
                    }, enabled = !submitting && reason.isNotBlank(), modifier = Modifier.weight(1f)) {
                        if (submitting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Rounded.Send, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(7.dp))
                        Text(if (submitting) "Submitting…" else "Submit appeal")
                    }
                }
            }
        }
    }
}

@Composable
private fun AppealDecisionCard(decision: NativeAppealableDecision, enabled: Boolean, onAppeal: () -> Unit) {
    val appeal = decision.appeal
    Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(if (appeal?.status == "reversed") Icons.Rounded.CheckCircle else Icons.Rounded.Gavel,
                    null, Modifier.size(23.dp), tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(NativeAppealRules.decisionLabel(decision.actionType),
                        style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(listOf(decision.targetType, relativePostTime(decision.createdAt)).filter(String::isNotBlank).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Surface(shape = RoundedCornerShape(9.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Text(appeal?.let { NativeAppealRules.statusLabel(it.status) } ?: "Appealable",
                    Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Text(decision.reason.ifBlank { "SautiLink moderation decision." }, style = MaterialTheme.typography.bodyMedium)
            Text("Policy: ${decision.policyVersion}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (appeal == null) OutlinedButton(onClick = onAppeal, enabled = enabled) {
                Icon(Icons.Rounded.RateReview, null, Modifier.size(18.dp)); Spacer(Modifier.width(7.dp)); Text("Appeal decision")
            } else {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text("Your appeal", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                Text(appeal.reason, style = MaterialTheme.typography.bodyMedium)
                if (appeal.decisionReason.isNotBlank()) {
                    Text("Review decision", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    Text(appeal.decisionReason, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
