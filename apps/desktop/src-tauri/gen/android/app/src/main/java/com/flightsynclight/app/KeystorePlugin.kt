package com.flightsynclight.app

import android.app.Activity
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore

@InvokeArg
class SaveArgs {
    var token: String? = null
}

// Refresh-token storage backed by the Android Keystore (AES256 master key,
// EncryptedSharedPreferences). Mirrors the keyring commands used on
// macOS/iOS: save / load / delete of a single google-refresh-token entry.
//
// The encrypted file is useless without this device's Keystore key, which never
// leaves the device. The file is excluded from Android backup and from
// device-to-device transfer (res/xml/data_extraction_rules.xml and
// backup_rules.xml), but a copy restored anyway (an older build's backup, an
// OEM transfer tool) cannot be decrypted: every call then threw, and the pilot
// could neither sign in, sign out nor back up until the app's data was cleared.
// An unreadable store is now discarded and recreated empty — that token was
// unusable anyway; the app shows the sign-in button and the pilot signs in again.
@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
    private var cached: SharedPreferences? = null

    private fun open(): SharedPreferences = EncryptedSharedPreferences.create(
        activity,
        PREFS,
        MasterKey.Builder(activity).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    // Throws only if even a freshly created store cannot be opened.
    private fun prefs(): SharedPreferences {
        cached?.let { return it }
        val p = try {
            open()
        } catch (e: Exception) {
            Log.w(TAG, "token store unreadable, recreating it empty", e)
            reset()
            open()
        }
        cached = p
        return p
    }

    // Deletes the encrypted file and the master key (only this store uses it).
    private fun reset() {
        cached = null
        activity.deleteSharedPreferences(PREFS)
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                .deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
        } catch (e: Exception) {
            Log.w(TAG, "could not delete the token store's master key", e)
        }
    }

    @Command
    fun save(invoke: Invoke) {
        val args = invoke.parseArgs(SaveArgs::class.java)
        val token = args.token
        if (token.isNullOrEmpty()) {
            invoke.reject("empty token")
            return
        }
        try {
            prefs().edit().putString(KEY, token).apply()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("could not store the sign-in token: ${e.message ?: e}")
        }
    }

    @Command
    fun load(invoke: Invoke) {
        val token = try {
            prefs().getString(KEY, null)
        } catch (e: Exception) {
            // An entry that cannot be decrypted is as good as none.
            Log.w(TAG, "stored token unreadable, discarding it", e)
            reset()
            null
        }
        val ret = JSObject()
        ret.put("token", token)
        invoke.resolve(ret)
    }

    // Always succeeds: if the store cannot be opened, deleting it removes the token.
    @Command
    fun delete(invoke: Invoke) {
        try {
            prefs().edit().remove(KEY).apply()
        } catch (e: Exception) {
            Log.w(TAG, "token store unreadable on delete, discarding it", e)
            reset()
        }
        invoke.resolve()
    }

    companion object {
        private const val TAG = "FSLKeystore"
        private const val PREFS = "fsl-secure" // shared_prefs/fsl-secure.xml — named in the backup rules
        private const val KEY = "google-refresh-token"
    }
}
