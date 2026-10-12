package com.sautilink.nativeapp.feature.explore

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException

/** Web-inspired discovery with native keyboard search and existing RLS-secured people/post queries. */
@Composable
fun NativeExploreScreen(
    auth: StagingAuthClient,
    onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit,
    onOpenPost: (String) -> Unit = {}
) {
    val client = remember(auth) { NativeExploreClient(auth) }
    var query by rememberSaveable { mutableStateOf("") }
    var committedQuery by rememberSaveable { mutableStateOf("") }
    var searchRevision by remember { mutableIntStateOf(0) }
    var results by remember(auth.account?.id) {
        mutableStateOf(ExploreResults(emptyList(), emptyList()))
    }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(auth.account?.id, committedQuery, searchRevision) {
        if (auth.account == null) { results = ExploreResults(emptyList(), emptyList()); return@LaunchedEffect }
        loading = true; error = null
        try { results = client.search(committedQuery) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Search failed." }
        finally { loading = false }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface),
        contentPadding = PaddingValues(bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        item {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Rounded.Search, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(25.dp))
                    OutlinedTextField(
                        query, { query = it.take(64) },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Search people or posts") },
                        singleLine = true,
                        shape = RoundedCornerShape(16.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = {
                            committedQuery = query.trim()
                            searchRevision++
                        })
                    )
                }
                Button(
                    onClick = { committedQuery = query.trim(); searchRevision++ },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    shape = RoundedCornerShape(13.dp)
                ) {
                    Text("Search", style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold)
                }
            }
        }
        if (auth.account == null) {
            item {
                Column(
                    Modifier.fillMaxWidth().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Sign in to explore SautiLink.")
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onSignIn) { Text("Sign in") }
                }
            }
        } else {
            item {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f)) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 18.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Text("PEOPLE", color = SautiColors.Red,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold)
                        Text("Voices to discover",
                            style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (loading && results.people.isEmpty()) {
                items(4) { SautiExploreSkeleton() }
            }
            if (error != null) {
                item {
                    Column(Modifier.padding(18.dp)) {
                        Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { searchRevision++ }) { Text("Try again") }
                    }
                }
            }
            if (!loading && error == null && results.people.isEmpty()) {
                item { Text("No matching people", Modifier.padding(20.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            items(results.people, key = { "person:${it.id}" }) { person ->
                val initials = person.name.split(" ").filter { it.isNotBlank() }.take(2)
                    .map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }
                val validHandle = Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(person.username)
                Row(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = validHandle) { onOpenProfile(person.username) }
                        .padding(horizontal = 18.dp, vertical = 17.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    if (person.hasAvatar && validHandle) {
                        AuthorizedImage(auth, route = "/api/profile-media/${person.username}/avatar",
                            description = "${person.name}'s avatar",
                            modifier = Modifier.size(58.dp).clip(CircleShape),
                            fallback = { SautiAvatar(initials, Modifier.size(58.dp), SautiColors.Blue) })
                    } else SautiAvatar(initials, Modifier.size(58.dp), SautiColors.Blue)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(person.name, fontWeight = FontWeight.SemiBold,
                                style = MaterialTheme.typography.titleSmall, maxLines = 1,
                                overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.width(4.dp))
                            SautiVerificationBadge(person.verified, person.badgeType,
                                person.name, size = 15.dp)
                        }
                        Text("@${person.username}", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (person.bio.isNotBlank()) Text(person.bio, maxLines = 2,
                            style = MaterialTheme.typography.bodySmall,
                            overflow = TextOverflow.Ellipsis)
                        Text("${person.followers} followers",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.labelSmall)
                        OutlinedButton(
                            onClick = { onOpenProfile(person.username) },
                            enabled = validHandle,
                            modifier = Modifier.heightIn(min = 44.dp),
                            shape = RoundedCornerShape(13.dp),
                            contentPadding = PaddingValues(horizontal = 19.dp, vertical = 0.dp)
                        ) { Text("View profile") }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .60f))
            }
            item {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f)) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("POSTS", color = SautiColors.Red,
                            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                        Text("Discover public posts", fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleLarge)
                    }
                }
            }
            if (loading && results.posts.isEmpty()) {
                items(2) { SautiExploreSkeleton() }
            }
            if (!loading && error == null && results.posts.isEmpty()) {
                item { Text("No matching public posts", Modifier.padding(20.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            items(results.posts, key = { "post:${it.id}" }) { post ->
                Surface(color = MaterialTheme.colorScheme.surface,
                    modifier = Modifier.fillMaxWidth(),
                    border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column(
                        Modifier.fillMaxWidth().clickable { onOpenPost(post.id) }
                            .padding(horizontal = 18.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(post.authorName, fontWeight = FontWeight.SemiBold)
                            SautiVerificationBadge(post.verified, post.badgeType,
                                post.authorName, size = 15.dp)
                            Spacer(Modifier.weight(1f))
                            Text(relativePostTime(post.createdAt),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall)
                        }
                        Text(post.body.ifBlank { "Media post" },
                            maxLines = 5, overflow = TextOverflow.Ellipsis)
                        Text("${post.likes} likes · ${post.comments} comments" +
                            if (post.mediaCount > 0) " · ${post.mediaCount} media" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
