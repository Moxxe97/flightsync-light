package com.flightsynclight.app

import android.app.Activity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SaveArgs {
    var token: String? = null
}

// Refresh-token storage backed by the Android Keystore (AES256 master key,
// EncryptedSharedPreferences). Mirrors the keyring commands used on
// macOS/iOS: save / load / delete of a single google-refresh-token entry.
@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
    private val prefs by lazy {
        EncryptedSharedPreferences.create(
            activity,
            "fsl-secure",
            MasterKey.Builder(activity).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @Command
    fun save(invoke: Invoke) {
        val args = invoke.parseArgs(SaveArgs::class.java)
        val token = args.token
        if (token.isNullOrEmpty()) {
            invoke.reject("empty token")
            return
        }
        prefs.edit().putString("google-refresh-token", token).apply()
        invoke.resolve()
    }

    @Command
    fun load(invoke: Invoke) {
        val ret = JSObject()
        ret.put("token", prefs.getString("google-refresh-token", null))
        invoke.resolve(ret)
    }

    @Command
    fun delete(invoke: Invoke) {
        prefs.edit().remove("google-refresh-token").apply()
        invoke.resolve()
    }
}
