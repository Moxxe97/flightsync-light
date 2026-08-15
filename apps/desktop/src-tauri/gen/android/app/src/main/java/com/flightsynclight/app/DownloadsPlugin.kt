package com.flightsynclight.app

import android.app.Activity
import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SaveFileArgs {
    var fileName: String? = null
    var mime: String? = null
    var contents: String? = null
}

// Writes an exported text file (CSV / ICS / JSON) into the device's public
// Downloads collection via MediaStore. Needed because the WebView's
// blob+<a download> idiom is silently dropped by wry on Android (the UI toast
// claimed success while no file existed anywhere — verified on-device
// 2026-08-15), and app-scoped dirs are not user-browsable since Android 11.
// MediaStore requires no storage permission on API 29+ and auto-uniquifies
// duplicate display names ("x.csv" → "x (1).csv").
@TauriPlugin
class DownloadsPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun saveFile(invoke: Invoke) {
        val args = invoke.parseArgs(SaveFileArgs::class.java)
        val fileName = args.fileName
        val contents = args.contents
        if (fileName.isNullOrEmpty() || contents == null) {
            invoke.reject("fileName and contents are required")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            invoke.reject("saving to Downloads requires Android 10+")
            return
        }
        try {
            val resolver = activity.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                // Strip content-type parameters ("text/csv;charset=utf-8") —
                // MediaStore expects a bare MIME type.
                put(MediaStore.Downloads.MIME_TYPE, (args.mime ?: "application/octet-stream").substringBefore(';'))
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("MediaStore insert failed")
            resolver.openOutputStream(uri).use { out ->
                out?.write(contents.toByteArray(Charsets.UTF_8))
                    ?: throw IllegalStateException("openOutputStream failed")
            }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            val ret = JSObject()
            ret.put("path", "Download/$fileName")
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "save failed")
        }
    }
}
