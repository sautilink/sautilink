package com.sautilink.nativeapp.feature.browser

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import com.sautilink.nativeapp.ui.text.normalizeExternalUrl
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.ui.theme.SautiTheme
import java.net.URI

/** Uses the WebView cookie store without injecting native SautiLink session credentials. */
internal class NativeWebBrowserActivity : ComponentActivity() {
    private var webView: WebView? = null
    private lateinit var requestedUrl: String
    private var pageUrl by mutableStateOf("")
    private var loadProgress by mutableIntStateOf(0)
    private var canGoBack by mutableStateOf(false)
    private var canGoForward by mutableStateOf(false)
    private var encrypted by mutableStateOf(false)
    private var lastCommittedUrl by mutableStateOf<String?>(null)
    private var failure by mutableStateOf<BrowserFailure?>(null)
    private var rendererRevision by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val target = secureWebUrl(intent.getStringExtra(URL_EXTRA).orEmpty())
        if (target == null) {
            finish()
            return
        }
        requestedUrl = secureWebUrl(savedInstanceState?.getString(URL_EXTRA).orEmpty()) ?: target
        pageUrl = requestedUrl
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (canReturnToPage()) goBack() else finish()
            }
        })
        val dark = getSharedPreferences("sautilink_native_appearance", MODE_PRIVATE)
            .getBoolean("dark_theme_override", false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        setContent {
            SautiTheme(darkTheme = dark) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    BrowserLayout()
                }
            }
        }
    }

    @Composable
    private fun BrowserLayout() {
        var editingAddress by remember { mutableStateOf(false) }
        var showingProtection by remember { mutableStateOf(false) }
        val host = remember(pageUrl) { runCatching { URI(pageUrl).host }.getOrNull().orEmpty() }
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (failure == null || webView != null) {
                    key(rendererRevision) {
                        AndroidView(factory = { createBrowser() }, modifier = Modifier.fillMaxSize(),
                            onRelease = { released ->
                                if (webView === released) webView = null
                                released.destroy()
                            })
                    }
                }
                failure?.let { BrowserFailurePage(it, ::retry) }
            }
            if (loadProgress < 100 && failure == null) {
                LinearProgressIndicator(progress = { loadProgress / 100f }, modifier = Modifier.fillMaxWidth())
            } else HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 7.dp)) {
                Surface(Modifier.fillMaxWidth().heightIn(min = 49.dp), shape = SautiShape.Pill,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { showingProtection = true }) {
                            Icon(if (encrypted && failure == null) Icons.Rounded.Lock else Icons.Rounded.Shield,
                                "Connection details", modifier = Modifier.size(19.dp))
                        }
                        TextButton(onClick = { editingAddress = true }, modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
                            contentPadding = PaddingValues(horizontal = 4.dp)) {
                            Text(host, style = MaterialTheme.typography.titleMedium, maxLines = 1,
                                overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center)
                        }
                        IconButton(onClick = ::retry, enabled = failure?.retryable != false) {
                            Icon(Icons.Rounded.Refresh, "Reload page", modifier = Modifier.size(21.dp))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 50.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    val previousAvailable = canReturnToPage()
                    IconButton(onClick = ::goBack, enabled = previousAvailable) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Previous page", tint = navigationInk(previousAvailable))
                    }
                    IconButton(onClick = ::goForward, enabled = canGoForward) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, "Next page", tint = navigationInk(canGoForward))
                    }
                    IconButton(onClick = ::finish) { Icon(Icons.Rounded.Close, "Close web page") }
                }
            }
        }
        if (editingAddress) AddressDialog(pageUrl, onDismiss = { editingAddress = false }, onOpen = {
            editingAddress = false
            navigateTo(it)
        })
        if (showingProtection) AlertDialog(
            onDismissRequest = { showingProtection = false },
            title = { Text("Connection details") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text(host, style = MaterialTheme.typography.titleSmall)
                    Text(failure?.message ?: if (encrypted) "HTTPS connection verified." else "Checking the site's connection.")
                    Text("Safe Browsing checks for known threats. Third-party cookies are blocked.",
                        style = MaterialTheme.typography.bodySmall)
                }
            },
            confirmButton = { TextButton(onClick = { showingProtection = false }) { Text("Done") } }
        )
    }

    @Composable
    private fun navigationInk(enabled: Boolean) = if (enabled) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurface.copy(alpha = .28f)

    @Suppress("SetJavaScriptEnabled")
    private fun createBrowser(): WebView = WebView(this).apply {
        webView = this
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            useWideViewPort = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                if (webView === view) loadProgress = newProgress
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, false, false)
            }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase()
                if (!request.isForMainFrame) return scheme !in setOf("https", "about", "data", "blob")
                val target = secureWebUrl(request.url.toString())
                if (scheme == "https" && target != null) return false
                if (scheme == "http" && target != null) {
                    if (request.hasGesture() && !request.isRedirect) navigateTo(target)
                    else block(target, BrowserFailure.Insecure)
                } else if (request.hasGesture()) {
                    Toast.makeText(view.context, "This link cannot open here.", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                if (webView !== view) return
                val target = secureWebUrl(url) ?: return
                if (!url.startsWith("https:", ignoreCase = true)) {
                    view.stopLoading()
                    block(target, BrowserFailure.Insecure)
                    return
                }
                pageUrl = target
                requestedUrl = target
                encrypted = false
                if (failure?.retryable != false) failure = null
                loadProgress = 0
            }

            override fun onPageCommitVisible(view: WebView, url: String) {
                if (webView === view && url.startsWith("https:", ignoreCase = true) && failure == null) {
                    encrypted = view.certificate != null
                    lastCommittedUrl = secureWebUrl(url)
                }
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                if (webView !== view) return
                if (failure?.retryable != false && url.startsWith("https:", ignoreCase = true)) {
                    secureWebUrl(url)?.let {
                        pageUrl = it
                        requestedUrl = it
                    }
                }
                canGoBack = view.canGoBack()
                canGoForward = view.canGoForward()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (webView !== view || !request.isForMainFrame || failure?.retryable == false) return
                if (error.errorCode == ERROR_FAILED_SSL_HANDSHAKE) block(requestedUrl, BrowserFailure.Certificate)
                else failure = BrowserFailure.Network
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                if (webView === view && secureWebUrl(error.url.orEmpty()) == requestedUrl) {
                    block(requestedUrl, BrowserFailure.Certificate)
                }
            }

            @androidx.annotation.RequiresApi(27)
            override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threatType: Int,
                callback: SafeBrowsingResponse) {
                callback.backToSafety(false)
                if (webView === view && request.isForMainFrame) {
                    block(secureWebUrl(request.url.toString()) ?: requestedUrl, BrowserFailure.Unsafe)
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (webView === view) {
                    webView = null
                    failure = BrowserFailure.Closed
                    encrypted = false
                    canGoBack = false
                    canGoForward = false
                }
                return true
            }
        }
        setDownloadListener { _, _, _, _, _ ->
            Toast.makeText(context, "Downloads from this page are unavailable here.", Toast.LENGTH_SHORT).show()
        }
        loadUrl(requestedUrl)
    }

    private fun block(url: String, reason: BrowserFailure) {
        pageUrl = url
        requestedUrl = url
        encrypted = false
        failure = reason
    }

    private fun navigateTo(url: String) {
        requestedUrl = url
        pageUrl = url
        failure = null
        encrypted = false
        loadProgress = 0
        val view = webView
        if (view == null) rendererRevision++ else view.loadUrl(url)
    }

    private fun retry() {
        if (failure?.retryable == false) return
        val view = webView
        loadProgress = 0
        failure = null
        if (view == null) rendererRevision++
        else if (view.url == requestedUrl) view.reload()
        else view.loadUrl(requestedUrl)
    }

    private fun canReturnToPage() =
        canGoBack || failure?.retryable == false && lastCommittedUrl != null && lastCommittedUrl != pageUrl

    private fun goBack() {
        val view = webView ?: return
        val previous = lastCommittedUrl
        if (failure?.retryable == false && previous != null && previous != pageUrl) {
            if (secureWebUrl(view.url.orEmpty()) == previous) {
                pageUrl = previous
                requestedUrl = previous
                encrypted = view.certificate != null
                failure = null
            } else navigateTo(previous)
        } else {
            failure = null
            view.goBack()
        }
    }

    private fun goForward() {
        failure = null
        webView?.goForward()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::requestedUrl.isInitialized) outState.putString(URL_EXTRA, requestedUrl)
        super.onSaveInstanceState(outState)
    }

    companion object {
        private const val URL_EXTRA = "web_browser_url"

        fun open(context: Context, url: String): Boolean {
            val target = secureWebUrl(url) ?: return false
            return runCatching {
                context.startActivity(Intent(context, NativeWebBrowserActivity::class.java).putExtra(URL_EXTRA, target))
            }.isSuccess
        }
    }
}

private enum class BrowserFailure(val message: String, val retryable: Boolean) {
    Network("Could not load this page. Check the link and your connection.", true),
    Closed("The page closed unexpectedly. Try opening it again.", true),
    Certificate("This site's certificate could not be verified. The page was blocked.", false),
    Insecure("This site tried to switch to an unencrypted connection. The page was blocked.", false),
    Unsafe("Safe Browsing flagged this page as a threat. The page was blocked.", false)
}

@Composable
private fun BrowserFailurePage(failure: BrowserFailure, onRetry: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Box(contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 420.dp).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!failure.retryable) {
                    Icon(Icons.Rounded.Shield, null, Modifier.size(34.dp), tint = MaterialTheme.colorScheme.error)
                }
                Text(failure.message, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                if (failure.retryable) Button(onClick = onRetry) { Text("Try again") }
            }
        }
    }
}

@Composable
private fun AddressDialog(url: String, onDismiss: () -> Unit, onOpen: (String) -> Unit) {
    var address by remember(url) { mutableStateOf(TextFieldValue(url, selection = TextRange(0, url.length))) }
    var invalid by remember(url) { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    fun open() {
        val typed = address.text.trim()
        val candidate = if (":" !in typed.substringBefore('/') && !typed.startsWith("www.", ignoreCase = true)) {
            "https://" + typed
        } else typed
        val target = secureWebUrl(candidate)
        if (target == null) invalid = true else onOpen(target)
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Website address") },
        text = {
            OutlinedTextField(value = address, onValueChange = {
                if (it.text.length <= 8192) {
                    address = it
                    invalid = false
                }
            },
                label = { Text("Address") }, isError = invalid, singleLine = true,
                supportingText = if (invalid) ({ Text("Enter a valid web address.") }) else null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { open() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus))
        },
        confirmButton = { TextButton(onClick = ::open) { Text("Open") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

internal fun secureWebUrl(value: String): String? {
    val normalized = value.takeIf { it.length <= 8192 }?.let(::normalizeExternalUrl) ?: return null
    if (normalized.startsWith("https:")) return normalized
    val uri = URI(normalized)
    val authority = if (uri.port == 80) uri.rawAuthority.substringBeforeLast(':') else uri.rawAuthority
    return "https://" + authority + normalized.substring("http://".length + uri.rawAuthority.length)
}
