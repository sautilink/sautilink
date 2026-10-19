import java.util.Properties

val nativeLocalProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val stagingPublishableKey = nativeLocalProps.getProperty("sautilinkStagingPublishableKey", "").trim()
// This is a public publishable key already embedded in the SautiLink website. Not a secret.
// Override locally if it is rotated. Never put service_role/sb_secret keys in an APK.
val productionPublishableKey = nativeLocalProps.getProperty(
    "sautilinkProductionPublishableKey", "sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca"
).trim()
val releaseStorePath = providers.environmentVariable("SAUTILINK_KEYSTORE_PATH").orNull?.trim().orEmpty()
val releaseStorePassword = providers.environmentVariable("SAUTILINK_KEYSTORE_PASSWORD").orNull.orEmpty()
val releaseKeyAlias = providers.environmentVariable("SAUTILINK_KEY_ALIAS").orNull.orEmpty()
val releaseKeyPassword = providers.environmentVariable("SAUTILINK_KEY_PASSWORD").orNull.orEmpty()
val releaseSigningConfigured = listOf(releaseStorePath, releaseStorePassword, releaseKeyAlias,
    releaseKeyPassword).all { it.isNotEmpty() }
if (listOf(releaseStorePath, releaseStorePassword, releaseKeyAlias,
        releaseKeyPassword).any { it.isNotEmpty() }) {
    require(releaseSigningConfigured) { "Release signing needs a keystore path, store password, key alias and key password." }
    require(file(releaseStorePath).isFile) { "Release keystore file was not found." }
}
require(productionPublishableKey.startsWith("sb_publishable_")) {
    "Production requires an sb_publishable_ key, never a secret or service_role key."
}
if (stagingPublishableKey.isNotEmpty()) {
    require(stagingPublishableKey.startsWith("sb_publishable_")) {
        "Use only the staging project's sb_publishable_ key (never a secret/service_role key)."
    }
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services") apply false
}
// Firebase config is supplied per registered Android package. The native client
// can still be built without it; FCM remains disabled until the file is present.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")
android {
    namespace = "com.sautilink.nativeapp"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "STAGING_SUPABASE_PUBLISHABLE_KEY", "\"${stagingPublishableKey}\"")
        buildConfigField("String", "PRODUCTION_SUPABASE_PUBLISHABLE_KEY", "\"${productionPublishableKey}\"")
        versionCode = 46
        versionName = "1.1.1"
    }
    flavorDimensions += "distribution"
    productFlavors {
        create("preview") {
            dimension = "distribution"
            applicationId = "com.sautilink.preview.nativeapp"
        }
        create("production") {
            dimension = "distribution"
            applicationId = "com.sautilink.app"
        }
    }
    signingConfigs {
        if (releaseSigningConfigured) create("productionRelease") {
            storeFile = file(releaseStorePath)
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("productionRelease")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true; buildConfig = true }
    // Licensed icon sources are test fixtures only; no test assets enter release builds.
    sourceSets.getByName("androidTest").assets.srcDir("../icons")
}
androidComponents {
    beforeVariants(selector().all()) { variant ->
        val distribution = variant.productFlavors.firstOrNull { it.first == "distribution" }?.second
        if ((distribution == "production" && variant.buildType == "debug") ||
            (distribution == "preview" && variant.buildType == "release")) variant.enable = false
    }
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.12.00")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // Bundled, cached vector buffering overlay for Home and Short Videos.
    implementation("com.airbnb.android:lottie-compose:6.7.1")
    // Downloads Inter from the Google Play services fonts provider when available.
    implementation("androidx.compose.ui:ui-text-google-fonts:1.10.0")
    // Tested on-device after Android Studio sync. Keep all Media3 modules on one version.
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation("androidx.media3:media3-transformer:1.11.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    // Phase 8M: Android HttpURLConnection does not reliably support PATCH.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Standard Play Integrity observations; server monitoring never gates app access.
    implementation("com.google.android.play:integrity:1.6.0")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
}
