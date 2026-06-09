package com.fancyprint.edge.security;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * DeviceAdminReceiver — 设备管理员广播接收器
 *
 * 对应 doc/2 §13.5.2 使用 DPC / Lock Task Mode 实现 kiosk
 *
 * 用于激活设备管理员权限，启用 Lock Task Mode（锁定任务模式），
 * 将设备锁定为单一应用（kiosk 模式），儿童无法退出。
 */
public class DeviceAdminReceiver extends android.app.admin.DeviceAdminReceiver {

    private static final String TAG = "DeviceAdminReceiver";

    @Override
    public void onEnabled(Context context, Intent intent) {
        Log.i(TAG, "Device admin enabled");
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        Log.w(TAG, "Device admin disabled");
    }

    @Override
    public void onLockTaskModeEntering(Context context, Intent intent, String pkg) {
        Log.i(TAG, "Lock task mode entering: " + pkg);
    }

    @Override
    public void onLockTaskModeExiting(Context context, Intent intent) {
        Log.i(TAG, "Lock task mode exiting");
    }
}
