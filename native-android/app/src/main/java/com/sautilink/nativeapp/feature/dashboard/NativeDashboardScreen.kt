package com.sautilink.nativeapp.feature.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException
import java.time.LocalDate
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

private data class DashboardMetric(
    val title: String, val id: String, val icon: ImageVector,
    val value: Long, val previous: Long, val explanation: String
)

private fun metricTotals(rows: List<CreatorDaily>, name: String): Long = when (name) {
    "views" -> rows.sumOf { it.views }
    "engagement" -> rows.sumOf { it.engagement }
    "follows" -> rows.sumOf { it.netFollows }
    else -> rows.sumOf { it.profileVisits }
}

@Composable
fun NativeDashboardScreen(
    auth: StagingAuthClient, onBack: () -> Unit,
    onOpenPost: (String) -> Unit
) {
    val client = remember(auth) { CreatorAnalyticsClient(auth) }
    var window by remember { mutableIntStateOf(28) }
    var tab by remember { mutableStateOf("insights") }
    var selectedMetric by remember { mutableStateOf("views") }
    var data by remember(auth.account?.id, window) { mutableStateOf<CreatorAnalytics?>(null) }
    var loading by remember(auth.account?.id) { mutableStateOf(auth.account != null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var analyticsInfo by remember { mutableStateOf(false) }
    LaunchedEffect(auth.account?.id, window, refresh) {
        if (auth.account == null) { data = null; return@LaunchedEffect }
        loading = true
        error = null
        try { data = client.load(window) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) {
            error = e.message ?: "Dashboard analytics could not be loaded."
        } finally { loading = false }
    }
    val lightBackground = MaterialTheme.colorScheme.background
    val today = LocalDate.now()
    val daily = remember(data, window, today) {
        val byDay = data?.days.orEmpty().associateBy { it.day }
        (window * 2 - 1 downTo 0).map { offset ->
            byDay[today.minusDays(offset.toLong())] ?: CreatorDaily(
                today.minusDays(offset.toLong()), 0, 0, 0, 0, 0)
        }
    }
    val metrics = remember(daily, window) {
        val prior = daily.take(window)
        val recent = daily.takeLast(window)
        listOf(
            DashboardMetric("Views", "views", Icons.Rounded.Visibility,
                metricTotals(recent, "views"), metricTotals(prior, "views"),
                "Unique meaningful views of your posts."),
            DashboardMetric("Engagement", "engagement", Icons.Rounded.ChatBubbleOutline,
                metricTotals(recent, "engagement"), metricTotals(prior, "engagement"),
                "Reactions, reposts and replies."),
            DashboardMetric("Net follows", "follows", Icons.Rounded.PersonAdd,
                metricTotals(recent, "follows"), metricTotals(prior, "follows"),
                "Follows gained minus follows lost."),
            DashboardMetric("Profile visits", "visits", Icons.Rounded.RemoveRedEye,
                metricTotals(recent, "visits"), metricTotals(prior, "visits"),
                "Unique signed-in visitors per day.")
        )
    }
    if (analyticsInfo) AlertDialog(onDismissRequest = { analyticsInfo = false },
        title = { Text("About these insights") },
        text = { Text("Profile visits and follow-change history start from this analytics dashboard's launch; older values are not estimated. Content statistics use recorded SautiLink views and engagement.") },
        confirmButton = { TextButton(onClick = { analyticsInfo = false }) { Text("Close") } })
    Column(Modifier.fillMaxSize().background(lightBackground)) {
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back")
            }
            Spacer(Modifier.width(8.dp))
            Text("Dashboard", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading) {
                Icon(Icons.Rounded.Refresh, "Refresh dashboard")
            }
        }
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            listOf("insights" to "Insights", "monetisation" to "Monetisation").forEach { (key, label) ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    TextButton(onClick = { tab = key }) {
                        Icon(if (key == "insights") Icons.Rounded.TrendingUp else Icons.Rounded.AttachMoney,
                            null, Modifier.size(19.dp), tint = if (tab == key) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant, selected = tab == key)
                        Spacer(Modifier.width(7.dp))
                        Text(label, color = if (tab == key) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.titleSmall)
                        if (key == "monetisation") {
                            Spacer(Modifier.width(5.dp))
                            ComingSoonBadge()
                        }
                    }
                    Spacer(Modifier.width(80.dp).height(3.dp)
                        .background(if (tab == key) MaterialTheme.colorScheme.primary else
                            MaterialTheme.colorScheme.surface))
                }
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (tab == "monetisation") {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text("Programmes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("Creator monetisation is coming soon. Programme eligibility, earnings and payouts are not available yet.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(creatorProgrammes, key = { it.title }) { programme -> CreatorProgrammeCard(programme) }
            } else {
                item {
                    DashboardSectionHeading("Analytics", Icons.Rounded.TrendingUp)
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(28 to "28 days", 7 to "7 days", 90 to "90 days").forEach { (days, title) ->
                            FilterChip(
                                selected = window == days,
                                onClick = { window = days },
                                label = { Text(title) },
                                leadingIcon = { Icon(Icons.Rounded.CalendarToday, null, Modifier.size(17.dp),
                                    selected = window == days) },
                                shape = RoundedCornerShape(25.dp)
                            )
                        }
                    }
                }
                if (loading && data == null) {
                    items(4) { SautiExploreSkeleton() }
                }
                if (error != null) {
                    item {
                        Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { refresh++ }) { Text("Try again") }
                    }
                }
                if (data != null) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                DashboardSectionHeading("Insights", Icons.Rounded.Visibility)
                                Spacer(Modifier.weight(1f))
                                IconButton(onClick = { analyticsInfo = true }) {
                                    Icon(Icons.Rounded.Info, "About dashboard insights", Modifier.size(21.dp))
                                }
                            }
                            Text("See how your profile and content are performing with live SautiLink data.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            metrics.chunked(2).forEach { group ->
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    group.forEach { metric ->
                                        DashboardMetricTile(metric, selectedMetric == metric.id,
                                            Modifier.weight(1f)) { selectedMetric = metric.id }
                                    }
                                }
                            }
                        }
                    }
                    item {
                        val color = MaterialTheme.colorScheme.primary
                        val lastDays = daily.takeLast(window)
                        val values = lastDays.map { entry ->
                            when (selectedMetric) {
                                "views" -> entry.views
                                "engagement" -> entry.engagement
                                "follows" -> entry.netFollows
                                else -> entry.profileVisits
                            }
                        }
                        Surface(
                            color = MaterialTheme.colorScheme.surface,
                            shape = RoundedCornerShape(18.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                        ) {
                            Column(Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                val currentMetric = metrics.firstOrNull { it.id == selectedMetric }
                                DashboardSectionHeading(currentMetric?.title ?: "Views",
                                    currentMetric?.icon ?: Icons.Rounded.Visibility)
                                Canvas(Modifier.fillMaxWidth().height(132.dp)) {
                                    if (values.size > 1) {
                                        val min = minOf(0L, values.minOrNull() ?: 0L)
                                        val max = maxOf(1L, values.maxOrNull() ?: 0L)
                                        val span = (max - min).toFloat().coerceAtLeast(1f)
                                        val path = Path()
                                        values.forEachIndexed { index, v ->
                                            val px = index * size.width / (values.size - 1)
                                            val py = (1f - (v - min).toFloat() / span) * size.height
                                            if (index == 0) path.moveTo(px, py)
                                            else path.lineTo(px, py)
                                        }
                                        drawPath(path, color, style = Stroke(width = 3.dp.toPx()))
                                    }
                                }
                                Text("Daily activity over the last $window days",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    item {
                        DashboardSectionHeading("Content", Icons.Rounded.Article)
                        Text("Top posts ranked by real views and engagement",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (data?.topContent.isNullOrEmpty()) {
                        item { Text("No recent content to show.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    items(data?.topContent.orEmpty(), key = { it.id }) { post ->
                        CreatorContentCard(auth, post) { onOpenPost(post.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DashboardMetricTile(
    metric: DashboardMetric, selected: Boolean,
    modifier: Modifier = Modifier, onSelect: () -> Unit
) {
    val delta = if (metric.previous == 0L) {
        if (metric.value == 0L) "0%" else "New"
    } else {
        val pct = ((metric.value - metric.previous) * 100.0 / kotlin.math.abs(metric.previous))
            .roundToInt()
        (if (pct > 0) "+" else "") + "$pct%"
    }
    Surface(
        modifier = modifier.heightIn(min = 142.dp),
        onClick = onSelect,
        shape = RoundedCornerShape(18.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = .45f)
            else MaterialTheme.colorScheme.surface,
        border = BorderStroke(if (selected) 1.5.dp else 1.dp,
            if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(metric.icon, contentDescription = null, modifier = Modifier.size(18.dp),
                    tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    selected = selected)
                Text(metric.title, style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(NumberFormat.getIntegerInstance(Locale.getDefault()).format(metric.value),
                style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(delta,
                color = if (metric.value > metric.previous) Color(0xFF169C64)
                    else if (metric.value < metric.previous) SautiColors.Red
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            Text(metric.explanation, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DashboardSectionHeading(title: String, icon: ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, null, Modifier.size(21.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}
