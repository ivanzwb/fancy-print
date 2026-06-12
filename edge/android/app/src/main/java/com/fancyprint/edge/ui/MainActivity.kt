package com.fancyprint.edge.ui

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.content.res.Configuration
import android.content.res.Resources
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.fancyprint.edge.IEdgeDaemonService
import com.fancyprint.edge.IPrintJobCallback
import com.fancyprint.edge.ui.theme.QixiangPrintTheme

class MainActivity : ComponentActivity() {
    private var mdpiResources: Resources? = null

    override fun attachBaseContext(newBase: Context?) {
        if (newBase != null && com.fancyprint.edge.FancyPrintApplication.isRk3566Overdensed()) {
            val config = Configuration(newBase.resources.configuration)
            config.densityDpi = DisplayMetrics.DENSITY_MEDIUM
            Log.w("MainActivity",
                "attachBaseContext override: ${newBase.resources.displayMetrics.densityDpi} -> ${DisplayMetrics.DENSITY_MEDIUM}")
            super.attachBaseContext(newBase.createConfigurationContext(config))
        } else {
            super.attachBaseContext(newBase)
        }
    }

    override fun getResources(): Resources {
        if (mdpiResources == null) {
            val res = super.getResources()
            val dm = res.displayMetrics
            Log.d("MainActivity",
                "getResources: density=${dm.density} dpi=${dm.densityDpi} w=${dm.widthPixels} h=${dm.heightPixels}")
            if (dm.widthPixels == 1024 && dm.densityDpi > DisplayMetrics.DENSITY_MEDIUM) {
                val config = Configuration(res.configuration)
                config.densityDpi = DisplayMetrics.DENSITY_MEDIUM
                Log.w("MainActivity",
                    "getResources override: ${dm.densityDpi} -> ${DisplayMetrics.DENSITY_MEDIUM} (mdpi)")
                mdpiResources = createConfigurationContext(config).resources
                val after = mdpiResources!!.displayMetrics
                Log.w("MainActivity", "After override: density=${after.density} dpi=${after.densityDpi}")
            } else {
                mdpiResources = res
            }
        }
        return mdpiResources!!
    }

    private var daemonService: IEdgeDaemonService? = null
    private var bound = false

    private val uiHandler = Handler(Looper.getMainLooper())
    private val pollRunnable = object : Runnable {
        override fun run() {
            updateNetworkStatus()
            uiHandler.postDelayed(this, 5000)
        }
    }

    private var daemonOnlineState = androidx.compose.runtime.mutableStateOf(false)
    private var batteryPercentState = androidx.compose.runtime.mutableIntStateOf(0)
    private var statusLabelState = androidx.compose.runtime.mutableStateOf("安静模式")

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            if (level >= 0 && scale > 0) {
                batteryPercentState.intValue = level * 100 / scale
            }
        }
    }

    private val printCallback = object : IPrintJobCallback.Stub() {
        override fun onPrintJobStatusChanged(jobId: String?, status: String?, errorCode: Int, message: String?) {
            runOnUiThread {
                statusLabelState.value = when {
                    status == "done" -> "打印完成"
                    status == "printing" -> "打印中"
                    !message.isNullOrBlank() -> message
                    else -> "安静模式"
                }
            }
        }

        override fun onConnectionStatusChanged(status: String?) {
            runOnUiThread {
                daemonOnlineState.value = status == "connected" || status == "已连接"
            }
        }

        override fun onDeviceAlert(type: String?, message: String?) {
            if (!message.isNullOrBlank()) {
                runOnUiThread { Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show() }
            }
        }

        override fun onUpdateAvailable(version: String?, changelog: String?) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, "发现新版本 ${version ?: ""}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            daemonService = IEdgeDaemonService.Stub.asInterface(service)
            bound = true
            try {
                daemonService?.registerPrintCallback(printCallback)
            } catch (e: Exception) {
                Log.e("MainActivity", "register callback failed", e)
            }
            statusLabelState.value = "在线"
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            bound = false
            daemonService = null
            daemonOnlineState.value = false
            statusLabelState.value = "离线"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)

        val daemonIntent = Intent(this, com.fancyprint.edge.service.EdgeDaemonService::class.java).apply {
            action = "com.fancyprint.edge.action.START_DAEMON"
        }
        startForegroundService(daemonIntent)
        bindService(daemonIntent, connection, Context.BIND_AUTO_CREATE)

        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        uiHandler.post(pollRunnable)

        setContent {
            QixiangPrintTheme {
                QixiangRoot(
                    daemonOnline = daemonOnlineState.value,
                    batteryPercent = batteryPercentState.intValue,
                    statusLabel = statusLabelState.value,
                    onPrintRequest = { emoji, desc, type -> submitPrintJob(emoji, desc, type) },
                    onOpenSettings = { openParentLockForSettings() },
                )
            }
        }

        // Defer immersive mode: on RK3566 (Android 14) the DecorView isn't ready
        // until after setContent() completes; calling too early crashes with NPE.
        window.decorView.post { enableFullScreenImmersive() }
    }

    override fun onResume() {
        super.onResume()
        enableFullScreenImmersive()
    }

    override fun onDestroy() {
        uiHandler.removeCallbacksAndMessages(null)
        try {
            unregisterReceiver(batteryReceiver)
        } catch (_: Exception) {
        }
        if (bound) {
            try {
                daemonService?.unregisterPrintCallback(printCallback)
            } catch (e: Exception) {
                Log.e("MainActivity", "unregister callback failed", e)
            }
            unbindService(connection)
            bound = false
        }
        super.onDestroy()
    }

    private fun updateNetworkStatus() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val network = cm.activeNetwork
        val capabilities = cm.getNetworkCapabilities(network)
        daemonOnlineState.value = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }

    private fun submitPrintJob(emoji: String, desc: String, type: String) {
        val service = daemonService
        if (!bound || service == null) {
            statusLabelState.value = "打印服务未连接"
            return
        }

        // Compose 新 UI 尚未打通本地 ASR/生成预览图链路，避免用占位 URL 提交错误任务。
        statusLabelState.value = "生成链路待对接"
        Toast.makeText(this, "当前仅完成 UI 替换，真实图片生成链路待接入", Toast.LENGTH_SHORT).show()
        try {
            service.speak("这个功能还在对接中")
        } catch (e: Exception) {
            Log.w("MainActivity", "speak failed", e)
        }
    }

    private fun openParentLockForSettings() {
        val settingsIntent = Intent(this, ParentLockActivity::class.java).apply {
            putExtra("target", "settings")
        }
        startActivity(settingsIntent)
    }

    private fun enableFullScreenImmersive() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val controller = window.insetsController
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                    controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    return
                }
            }
        } catch (_: Exception) {
            // Some ROMs (RK3566) throw inside insetsController getter
        }
        // Fallback: legacy API (also works on API 30+ when insetsController is null)
        @Suppress("DEPRECATION")
        try {
            window.decorView.systemUiVisibility = (
                android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        } catch (_: Exception) {
        }
    }
}
