package com.sautilink.nativeapp.feature.explore

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

@Composable
fun NativeExploreScreen(auth: StagingAuthClient, onSignIn: () -> Unit, onOpenProfile: (String) -> Unit) {
    val client = remember(auth) { NativeExploreClient(auth) }
    var query by rememberSaveable { mutableStateOf("") }
    var refresh by remember { mutableIntStateOf(0) }
    var results by remember { mutableStateOf(ExploreResults(emptyList(), emptyList())) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(auth.account?.id, query, refresh) {
        if (auth.account == null) { results = ExploreResults(emptyList(), emptyList()); return@LaunchedEffect }
        delay(350)
        loading = true; error = null
        try { results = client.search(query) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Search failed." }
        finally { loading = false }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Explore", style = MaterialTheme.typography.headlineMedium)
                Text("Find people and public posts on SautiLink",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(query, { query = it.take(64) }, singleLine = true,
                    placeholder = { Text("Search people and posts") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = { IconButton(onClick = { refresh++ }) { Icon(Icons.Rounded.Refresh, "Refresh search") } },
                    shape = SautiShape.Pill, modifier = Modifier.fillMaxWidth())
            }
        }
        if (auth.account == null) item {
            Column(Modifier.fillMaxWidth().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Sign in to explore SautiLink.")
                Spacer(Modifier.height(12.dp))
                Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else {
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (error != null) item {
                Column(Modifier.padding(20.dp)) {
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { refresh++ }) { Text("Try again") }
                }
            }
            item { Text("People", Modifier.padding(start = 20.dp, top = 8.dp),
                style = MaterialTheme.typography.titleLarge) }
            if (!loading && results.people.isEmpty()) item {
                Text("No matching people", Modifier.padding(horizontal = 20.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(results.people, key = { "person:${it.id}" }) { person ->
                Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                    Column(Modifier.fillMaxWidth().clickable { onOpenProfile(person.username) }.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(person.name, fontWeight = FontWeight.SemiBold)
                            SautiVerificationBadge(person.verified, person.badgeType,
                                person.name, size = 16.dp)
                        }
                        Text("@${person.username} · ${person.followers} followers",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall)
                        if (person.bio.isNotBlank()) Text(person.bio, maxLines = 2,
                            overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            item { Text("Public posts", Modifier.padding(start = 20.dp, top = 18.dp),
                style = MaterialTheme.typography.titleLarge) }
            if (!loading && results.posts.isEmpty()) item {
                Text("No matching public posts", Modifier.padding(horizontal = 20.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(results.posts, key = { "post:${it.id}" }) { post ->
                var expanded by remember(post.id) { mutableStateOf(false) }
                Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                    Column(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(post.authorName, fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.clickable(enabled = post.authorHandle.isNotBlank()) {
                                    onOpenProfile(post.authorHandle)
                                })
                            SautiVerificationBadge(post.verified, post.badgeType,
                                post.authorName, size = 15.dp)
                        }
                        Text(post.body.ifBlank { "Media post" }, maxLines = if (expanded) Int.MAX_VALUE else 4,
                            overflow = TextOverflow.Ellipsis)
                        Text("${post.likes} likes · ${post.comments} comments" +
                            if (post.mediaCount > 0) " · ${post.mediaCount} media" else "",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
