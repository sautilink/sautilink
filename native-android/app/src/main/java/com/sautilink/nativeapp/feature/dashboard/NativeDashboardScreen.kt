package com.sautilink.nativeapp.feature.dashboard

import android.icu.text.CompactDecimalFormat
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.stories.NativeStoryPolicy
import com.sautilink.nativeapp.feature.stories.NativeStoryQuota
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import kotlinx.coroutines.CancellationException
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.roundToLong

private val dashboardRanges = listOf(28 to "28 days", 7 to "7 days", 1 to "Today")

internal enum class DashboardMetric(val title: String, val description: String, val value: (CreatorDaily) -> Long) {
    VIEWS("Views", "Recorded meaningful views of your posts.", { it.views }),
    ENGAGEMENT("Engagement", "Recorded reactions, reposts and replies.", { it.engagement }),
    FOLLOWS("Net followers", "Followers gained minus followers lost.", { it.netFollows }),
}

private data class DashboardPalette(
    val dark: Boolean, val background: Color, val card: Color, val rim: Color,
    val ink: Color, val muted: Color, val selection: Color, val accent: Color,
    val positive: Color, val negative: Color,
)

@Composable
private fun dashboardPalette(): DashboardPalette {
    val dark = MaterialTheme.colorScheme.background.luminance() < .35f
    return if (dark) DashboardPalette(true, Color(0xFF252627), Color(0xFF333334), Color(0xFF494A4C),
        Color(0xFFF5F6F7), Color(0xFFBDBEC1), Color(0xFF233A50), Color(0xFF82B8EF),
        Color(0xFF76C47D), Color(0xFFFF8A94))
    else DashboardPalette(false, Color.White, Color(0xFFF6F7F9), Color(0xFFDDDFE4),
        Color(0xFF141517), Color(0xFF51555C), Color(0xFFDDEEFF), Color(0xFF155C9D),
        Color(0xFF206E39), Color(0xFFAA2939))
}

@Composable
internal fun NativeDashboardScreen(
    auth: StagingAuthClient, onBack: () -> Unit, onOpenPost: (String) -> Unit,
    storyQuota: NativeStoryQuota? = null,
) {
    val accountId = auth.account?.id
    val client = remember(auth) { CreatorAnalyticsClient(auth) }
    var window by rememberSaveable(accountId) { mutableIntStateOf(28) }
    var data by remember(accountId) { mutableStateOf<CreatorAnalytics?>(null) }
    var loadedWindow by remember(accountId) { mutableIntStateOf(0) }
    var loading by remember(accountId) { mutableStateOf(accountId != null) }
    var error by remember(accountId) { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var analytics by rememberSaveable(accountId) { mutableStateOf<DashboardMetric?>(null) }
    var monetisation by rememberSaveable(accountId) { mutableStateOf(false) }
    LaunchedEffect(accountId, window, refresh) {
        if (accountId == null) return@LaunchedEffect
        loading = true
        error = null
        try {
            data = client.load(window)
            loadedWindow = window
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Dashboard analytics could not be loaded." }
        finally { loading = false }
    }

    val colors = dashboardPalette()
    val ready = data.takeIf { loadedWindow == window }
    val today = LocalDate.now(ZoneOffset.UTC)
    if (analytics != null && ready != null) {
        DashboardMetricDialog(requireNotNull(analytics), statsDays(ready.days, window, today), window,
            onDismiss = { analytics = null })
    }
    BackHandler(monetisation) { monetisation = false }
    Column(Modifier.fillMaxSize().background(colors.background)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = if (monetisation) ({ monetisation = false }) else onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = colors.ink)
            }
            Text(if (monetisation) "Monetisation" else "Dashboard", Modifier.weight(1f), fontFamily = SautiHeaderFont,
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = colors.ink)
            if (!monetisation) IconButton(onClick = { refresh++ }, enabled = accountId != null && !loading) {
                Icon(Icons.Rounded.Refresh, "Refresh dashboard", tint = colors.ink.copy(alpha = if (loading) .45f else 1f))
            }
        }
        if (loading && !monetisation) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 26.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (monetisation) {
                item { Text("Creator monetisation and payouts are coming soon.", color = colors.muted) }
                items(creatorProgrammes, key = { it.title }) { programme -> CreatorProgrammeCard(programme) }
            } else {
                item {
                    CreatorDashboardOverview(data, loadedWindow == window, storyQuota, window, today,
                        onWindow = { window = it; analytics = null }, onMetric = { analytics = it },
                        onEarnings = { monetisation = true })
                }
                if (error != null || accountId == null) item {
                    Column {
                        Text(error ?: "Sign in to view your analytics.", color = colors.muted)
                        if (accountId != null) TextButton(onClick = { refresh++ }) { Text("Try again") }
                    }
                }
                if (data != null) {
                    item {
                        Text("Content", style = MaterialTheme.typography.titleLarge,
                            color = colors.ink, fontWeight = FontWeight.Bold)
                    }
                    if (data?.topContent.isNullOrEmpty()) item {
                        Text("No recent posts to show.", color = colors.muted, style = MaterialTheme.typography.bodyMedium)
                    }
                    items(data?.topContent.orEmpty(), key = { it.id }) { post ->
                        CreatorContentCard(auth, post) { onOpenPost(post.id) }
                    }
                }
            }
        }
    }
}

internal fun statsDays(rows: List<CreatorDaily>, window: Int, today: LocalDate): List<CreatorDaily> {
    val byDay = rows.associateBy { it.day }
    return (window * 2 - 1 downTo 0).map { offset ->
        val date = today.minusDays(offset.toLong())
        byDay[date] ?: CreatorDaily(date, 0, 0, 0, 0, 0)
    }
}

@Composable
internal fun CreatorDashboardOverview(data: CreatorAnalytics?, periodReady: Boolean, storyQuota: NativeStoryQuota?,
    window: Int, today: LocalDate, onWindow: (Int) -> Unit, onMetric: (DashboardMetric) -> Unit, onEarnings: () -> Unit) {
    val colors = dashboardPalette()
    val daily = data?.takeIf { periodReady }?.let { statsDays(it.days, window, today) }
    val weeklyReception = data?.days?.filter { it.day in today.minusDays(6)..today }?.sumOf { it.engagement }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 3.dp, bottom = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ActivityRing("Posts", "Posts in the last 7 days", Icons.Rounded.Article,
                data?.weeklyPosts, 7, Color(0xFF438FDE), Color(0xFFE5F1FF), Modifier.weight(1f))
            ActivityRing("Stories", "Stories used from the current daily allowance", Icons.Rounded.AutoStories,
                storyQuota?.takeIf { it.resetsAt.isNotBlank() }?.let { it.imagesUsed.toLong() + it.videosUsed },
                NativeStoryPolicy.MAX_IMAGES_PER_DAY + NativeStoryPolicy.MAX_VIDEOS_PER_DAY,
                Color(0xFFF18A29), Color(0xFFFFF0E0), Modifier.weight(1f))
            ActivityRing("Reception", "Engagements in the last 7 days", Icons.Rounded.SentimentSatisfiedAlt,
                weeklyReception, 10, Color(0xFFDB60D3), Color(0xFFFCEBFB), Modifier.weight(1f))
        }
        Row(Modifier.heightIn(min = 44.dp).clickable(enabled = daily != null, role = Role.Button) { onMetric(DashboardMetric.VIEWS) },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("Analytics", fontFamily = SautiHeaderFont, style = MaterialTheme.typography.titleLarge, color = colors.ink, fontWeight = FontWeight.Bold)
            Icon(Icons.Rounded.ChevronRight, null, Modifier.size(20.dp), tint = colors.muted)
        }
        Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            dashboardRanges.forEach { (days, label) ->
                val selected = days == window
                Surface(shape = CircleShape, color = if (selected) colors.selection else Color.Transparent,
                    modifier = Modifier.weight(1f, fill = false).heightIn(min = 44.dp)
                        .selectable(selected, role = Role.Tab) { onWindow(days) }) {
                    Box(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), contentAlignment = Alignment.Center) {
                        Text(label, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleSmall,
                            color = if (selected) colors.accent else colors.ink,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
                    }
                }
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 1.dp)) {
            val twoColumns = maxWidth / LocalDensity.current.fontScale >= 282.dp
            val tiles = listOf(DashboardMetric.VIEWS, null, DashboardMetric.ENGAGEMENT, DashboardMetric.FOLLOWS)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                tiles.chunked(if (twoColumns) 2 else 1).forEach { group ->
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        group.forEach { metric ->
                            val value = metric?.let { key -> daily?.takeLast(window)?.sumOf(key.value) }
                            val previous = metric?.let { key -> daily?.take(window)?.sumOf(key.value) }
                            DashboardTile(metric?.title ?: "Approximate earnings", value, previous,
                                earnings = metric == null, modifier = Modifier.weight(1f).fillMaxHeight(),
                                onClick = if (metric == null) onEarnings else ({ if (daily != null) onMetric(metric) }))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityRing(label: String, description: String, icon: ImageVector, count: Long?,
    target: Int, fill: Color, track: Color, modifier: Modifier = Modifier) {
    val colors = dashboardPalette()
    val display = count?.let { "${formatDashboardNumber(it)}/$target" } ?: "—"
    val progress = count?.let { (it.toFloat() / target).coerceIn(0f, 1f) } ?: 0f
    Column(modifier.semantics(mergeDescendants = true) { contentDescription = "$description, $display" },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Box(Modifier.size(69.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 5.5.dp.toPx()
                val inset = Offset(stroke / 2, stroke / 2)
                val extent = Size(size.width - stroke, size.height - stroke)
                drawArc(if (colors.dark) track else fill.copy(alpha = .18f), -90f, 360f, false,
                    topLeft = inset, size = extent, style = Stroke(stroke))
                if (progress > 0f) drawArc(fill, -90f, progress * 360f, false,
                    topLeft = inset, size = extent, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(icon, null, Modifier.size(17.dp), tint = colors.ink)
                Text(display, style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold, color = colors.ink, maxLines = 1)
            }
        }
        Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
            color = colors.muted, textAlign = TextAlign.Center)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DashboardTile(title: String, value: Long?, previous: Long?, earnings: Boolean,
    modifier: Modifier, onClick: () -> Unit) {
    val colors = dashboardPalette()
    val change = if (value != null && previous != null) value.compareTo(previous) else 0
    val trend = when {
        earnings -> "Coming soon"
        value == null || previous == null -> null
        change == 0 -> "0%"
        previous == 0L -> "New"
        else -> {
            val percent = ((value.toDouble() - previous) * 100 / kotlin.math.abs(previous.toDouble())).roundToLong()
            (if (change > 0) "↑ " else "↓ ") + if (percent == 0L) "<1%" else "${kotlin.math.abs(percent)}%"
        }
    }
    Surface(onClick = onClick, enabled = earnings || value != null,
        modifier = modifier.heightIn(min = 66.dp), color = colors.card,
        shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, colors.rim)) {
        Column(Modifier.padding(horizontal = 11.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.bodySmall, color = colors.muted)
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(value?.let(::formatDashboardNumber) ?: "—", style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold, color = colors.ink, modifier = Modifier.padding(end = 4.dp))
                if (trend != null) Text(trend, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                    color = when {
                        change > 0 -> colors.positive
                        change < 0 -> colors.negative
                        else -> colors.muted
                    })
            }
        }
    }
}

private fun formatDashboardNumber(value: Long): String {
    val locale = Locale.getDefault()
    return if (value <= -1_000_000L || value >= 1_000_000L)
        CompactDecimalFormat.getInstance(locale, CompactDecimalFormat.CompactStyle.SHORT).format(value)
    else NumberFormat.getIntegerInstance(locale).format(value)
}

@Composable
private fun DashboardMetricDialog(metric: DashboardMetric, days: List<CreatorDaily>, window: Int, onDismiss: () -> Unit) {
    val colors = dashboardPalette()
    val recent = days.takeLast(window)
    val values = recent.map(metric.value)
    AlertDialog(onDismissRequest = onDismiss, title = { Text(metric.title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                Text(metric.description)
                Canvas(Modifier.fillMaxWidth().height(105.dp)) {
                    if (values.isEmpty()) return@Canvas
                    val min = minOf(0L, values.min())
                    val max = maxOf(1L, values.max())
                    val span = (max.toDouble() - min).coerceAtLeast(1.0)
                    fun ordinate(value: Long) = (size.height * (1 - (value.toDouble() - min) / span)).toFloat()
                    if (values.size == 1) drawCircle(colors.accent, 3.dp.toPx(), Offset(size.width / 2, ordinate(values.single())))
                    else {
                        val path = Path().apply {
                            values.forEachIndexed { index, value ->
                                val x = index * size.width / (values.size - 1)
                                if (index == 0) moveTo(x, ordinate(value)) else lineTo(x, ordinate(value))
                            }
                        }
                        drawPath(path, colors.accent, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round))
                    }
                }
                Text("Profile visits · ${formatDashboardNumber(recent.sumOf { it.profileVisits })}")
                Text("Posts and reception measure the last seven days against goals of seven posts and ten engagements. Stories uses your current daily allowance. Analytics dates use UTC.",
                    style = MaterialTheme.typography.bodySmall, color = colors.muted)
            }
        }, confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } })
}
