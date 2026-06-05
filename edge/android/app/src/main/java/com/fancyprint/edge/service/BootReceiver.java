package com.fancyprint.edge.service;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * BootReceiver — 开机自启动接收器
 *
 * Android 启动完成后：
 * 1. 启动 EdgeDaemonService（常驻前台服务）
 * 2. 启动 MainActivity（Kiosk 主界面）
 *
 * 需要权限：android.permission.RECEIVE_BOOT_COMPLETED
 *
 * 对应 doc/2 §13.4.3 启动自启 — Android 端 BOOT_COMPLETED 方案
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }

        Log.i(TAG, "Boot completed, starting FancyPrint edge software");

        // 1. 启动 EdgeDaemonService（前台服务）
        Intent daemonIntent = new Intent(context, EdgeDaemonService.class);
        daemonIntent.setAction("com.fancyprint.edge.action.START_DAEMON");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(daemonIntent);
        } else {
            context.startService(daemonIntent);
        }
        Log.i(TAG, "EdgeDaemonService started on boot");

        // 2. 启动 Kiosk 主界面（带 NEW_TASK flag，因为不在 Activity 上下文中）
        Intent uiIntent = new Intent(context, com.fancyprint.edge.ui.MainActivity.class);
        uiIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        uiIntent.putExtra("from_boot", true);
        context.startActivity(uiIntent);
        Log.i(TAG, "MainActivity started on boot");
    }
}
