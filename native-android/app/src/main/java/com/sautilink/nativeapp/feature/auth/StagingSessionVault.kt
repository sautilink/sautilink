package com.sautilink.nativeapp.feature.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores ONLY the environment-specific refresh token; it is AES-GCM encrypted with a non-exportable
 * Android Keystore key. Never log tokens or enable cloud backup for this preview app.
 * All operations are synchronous and should be called from Dispatchers.IO.
 */
internal class StagingSessionVault(context: Context, backend: SautiBackend = SautiBackend.STAGING) {
    private val prefs = context.applicationContext.getSharedPreferences(
        "sautilink_${backend.id}_secure_session_v1", Context.MODE_PRIVATE
    )
    private val keyAlias = "sautilink_${backend.id}_refresh_aes_v1"
    private val preferenceName = "refresh_ciphertext_v1"

    private fun keystoreKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(keyAlias, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generateKey()
        }
    }

    fun save(refreshToken: String) {
        require(refreshToken.isNotBlank()) { "Empty refresh token must not be stored" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, keystoreKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(refreshToken.toByteArray(Charsets.UTF_8))
        val combined = byteArrayOf(iv.size.toByte()) + iv + encrypted
        check(prefs.edit().putString(preferenceName, Base64.encodeToString(combined, Base64.NO_WRAP)).commit()) {
            "Could not persist the encrypted staging session"
        }
    }

    fun read(): String? {
        val encoded = prefs.getString(preferenceName, null) ?: return null
        try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            require(combined.size > 29)
            val ivSize = combined[0].toInt() and 0xff
            require(ivSize == 12 && combined.size > 1 + ivSize + 16)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, keystoreKey(), GCMParameterSpec(128, combined.copyOfRange(1, 1 + ivSize)))
            return String(cipher.doFinal(combined.copyOfRange(1 + ivSize, combined.size)), Charsets.UTF_8)
                .takeIf(String::isNotBlank)
        } catch (_: Exception) {
            // Key invalidated or storage damaged. Never fall back to plaintext.
            clear()
            return null
        }
    }

    fun clear() {
        check(prefs.edit().remove(preferenceName).commit()) { "Could not clear staging session" }
    }
}
