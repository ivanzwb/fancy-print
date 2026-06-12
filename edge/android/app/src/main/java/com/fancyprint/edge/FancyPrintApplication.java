package com.fancyprint.edge;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.os.Build;
import android.util.DisplayMetrics;
import android.util.Log;

/**
 * FancyPrint 端侧 Android 应用入口
 *
 * 职责：
 * 1. 创建通知渠道（EdgeDaemonService 前台服务、OTA、告警）
 * 2. 初始化全局组件（Room DB、MQTT 等）
 * 3. 应用级别配置
 *
 * 对应 doc/2 端侧设计 §13.4.2 架构
 *
 * Android 14 注意事项：
 * - Android 13+ (API 33) 需要运行时请求 POST_NOTIFICATIONS 权限
 * - 前台服务类型声明在 Manifest 中已配置（dataSync|connectedDevice）
 * - service 使用 android:persistent="true" 减轻 LMK 误杀
 */
public class FancyPrintApplication extends Application {

    private static final String TAG = "FancyPrintApp";

    public static final String CHANNEL_DAEMON = "fancy_print_daemon";
    public static final String CHANNEL_OTA = "fancy_print_ota";
    public static final String CHANNEL_ALERTS = "fancy_print_alerts";

    /** 通知权限是否已获得（Android 13+ 需运行时授权，kiosk 设备可在 DPC 设置中预授权） */
    public static boolean hasNotificationPermission = false;

    /**
     * 主界面选中的创作模式（与 Web UI ContentMode 一致），
     * 供 {@link com.fancyprint.edge.service.EdgeDaemonService} 创建云端 job 及本地打印队列使用。
     */
    public static volatile String selectedUiContentMode = ContentModes.UI_AI_CREATE;

    public static boolean isRk3566Overdensed() {
        DisplayMetrics dm = Resources.getSystem().getDisplayMetrics();
        return dm.widthPixels == 1024 && dm.heightPixels == 600 && dm.densityDpi > DisplayMetrics.DENSITY_MEDIUM;
    }

    @Override
    public void onCreate() {
        super.onCreate();

        Log.i(TAG, "FancyPrintApplication onCreate — Android " + Build.VERSION.RELEASE
                + " (API " + Build.VERSION.SDK_INT + ")");

        // Android 13+ 检查通知权限状态
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasNotificationPermission = checkSelfPermission(
                    android.Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
            Log.i(TAG, "POST_NOTIFICATIONS granted: " + hasNotificationPermission);
        } else {
            hasNotificationPermission = true;
        }

        createNotificationChannels();
    }

    private void createNotificationChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);

        // Daemon 前台服务通知
        NotificationChannel daemonChannel = new NotificationChannel(
                CHANNEL_DAEMON,
                getString(R.string.channel_daemon_name),
                NotificationManager.IMPORTANCE_LOW
        );
        daemonChannel.setDescription(getString(R.string.channel_daemon_desc));
        daemonChannel.setShowBadge(false);
        nm.createNotificationChannel(daemonChannel);

        // OTA 更新通知
        NotificationChannel otaChannel = new NotificationChannel(
                CHANNEL_OTA,
                getString(R.string.channel_ota_name),
                NotificationManager.IMPORTANCE_HIGH
        );
        otaChannel.setDescription(getString(R.string.channel_ota_desc));
        nm.createNotificationChannel(otaChannel);

        // 设备告警通知
        NotificationChannel alertsChannel = new NotificationChannel(
                CHANNEL_ALERTS,
                getString(R.string.channel_alerts_name),
                NotificationManager.IMPORTANCE_HIGH
        );
        alertsChannel.setDescription(getString(R.string.channel_alerts_desc));
        nm.createNotificationChannel(alertsChannel);
    }
}
