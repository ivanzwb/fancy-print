package com.fancyprint.edge.service;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Environment;
import android.os.StatFs;
import android.util.Log;

import java.io.File;

/**
 * HealthMonitorService — 设备健康监控（纯 helper 类，非 Android Service）
 *
 * 职责：
 * - 监听电池状态（BatteryManager 广播）
 * - 提供电量、充电状态、存储使用率
 * - 通过 EdgeDaemonService 的 AlarmManager 发送定期健康心跳日志
 *
 * 对应 doc/2 §13.4.2 健康监控模块
 */
public class HealthMonitorService {

    private static final String TAG = "HealthMonitorService";
    private static final int HEALTH_ALARM_ID = 3001;
    private static final long HEALTH_INTERVAL_MS = 5 * 60 * 1000L;

    private int batteryLevel = 100;
    private boolean isCharging = false;
    private float temperature = 25.0f;
    private final Context context;

    public HealthMonitorService(Context context) {
        this.context = context;
    }

    public void init(Context context) {
        registerBatteryReceiver(context);
        scheduleHealthHeartbeat(context);
    }

    public void cleanup() {
        try {
            context.unregisterReceiver(batteryReceiver);
            Log.i(TAG, "Battery receiver unregistered");
        } catch (Exception e) {
            // receiver may not have been registered
            Log.d(TAG, "batteryReceiver not registered, skip unregister");
        }
        cancelHealthHeartbeat(context);
    }

    public int getBatteryLevel() {
        return batteryLevel;
    }

    public boolean isCharging() {
        return isCharging;
    }

    public int getStorageUsagePercent() {
        try {
            File dataDir = Environment.getDataDirectory();
            StatFs stat = new StatFs(dataDir.getPath());
            long totalBlocks = stat.getBlockCountLong();
            long availableBlocks = stat.getAvailableBlocksLong();
            long usedBlocks = totalBlocks - availableBlocks;
            return (int) (usedBlocks * 100 / totalBlocks);
        } catch (Exception e) {
            Log.e(TAG, "getStorageUsage error", e);
            return 0;
        }
    }

    public String getHealthJson() {
        return "{"
                + "\"battery\":" + batteryLevel + ","
                + "\"charging\":" + isCharging + ","
                + "\"storage\":" + getStorageUsagePercent() + ","
                + "\"temperature\":" + temperature
                + "}";
    }

    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())) {
                batteryLevel = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, 0);
                int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                batteryLevel = batteryLevel * 100 / scale;

                int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
                        || status == BatteryManager.BATTERY_STATUS_FULL;

                int temp = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 250);
                temperature = temp / 10.0f;
            }
        }
    };

    private void registerBatteryReceiver(Context context) {
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        context.registerReceiver(batteryReceiver, filter);
        Log.i(TAG, "Battery receiver registered");
    }

    private void scheduleHealthHeartbeat(Context context) {
        if (context == null) return;
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;

            Intent intent = new Intent(context, EdgeDaemonService.class);
            intent.setAction(EdgeDaemonService.ACTION_HEALTH_HEARTBEAT);
            PendingIntent pi = PendingIntent.getService(
                    context, HEALTH_ALARM_ID, intent,
                    PendingIntent.FLAG_IMMUTABLE);

            long triggerAt = System.currentTimeMillis() + HEALTH_INTERVAL_MS;
            am.setWindow(AlarmManager.RTC_WAKEUP, triggerAt, 30000L, pi);
            Log.i(TAG, "Health heartbeat scheduled every " + (HEALTH_INTERVAL_MS / 1000) + "s");
        } catch (Exception e) {
            Log.e(TAG, "scheduleHealthHeartbeat error", e);
        }
    }

    private void cancelHealthHeartbeat(Context context) {
        if (context == null) return;
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;

            Intent intent = new Intent(context, EdgeDaemonService.class);
            intent.setAction(EdgeDaemonService.ACTION_HEALTH_HEARTBEAT);
            PendingIntent pi = PendingIntent.getService(
                    context, HEALTH_ALARM_ID, intent,
                    PendingIntent.FLAG_IMMUTABLE);
            am.cancel(pi);
            Log.i(TAG, "Health heartbeat cancelled");
        } catch (Exception e) {
            Log.e(TAG, "cancelHealthHeartbeat error", e);
        }
    }
}
