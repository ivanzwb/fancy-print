package com.fancyprint.edge.print;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Bundle;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;

/**
 * UsbPermissionActivity — USB 权限请求透明 Activity
 *
 * 在 EdgeDaemonService 需要 USB 打印权限时，启动此透明 Activity
 * 向用户请求权限。权限获取后自动 finish。
 */
public class UsbPermissionActivity extends AppCompatActivity {

    private static final String TAG = "UsbPermissionActivity";
    private static final String ACTION_USB_PERMISSION = "com.fancyprint.edge.USB_PERMISSION";

    private final BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_USB_PERMISSION.equals(intent.getAction())) {
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                Log.i(TAG, "USB permission " + (granted ? "granted" : "denied"));
                finish();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 透明主题，无 UI

        registerReceiver(permissionReceiver, new IntentFilter(ACTION_USB_PERMISSION));

        UsbDevice device = getIntent().getParcelableExtra(UsbManager.EXTRA_DEVICE);
        if (device == null) {
            finish();
            return;
        }

        UsbManager usbManager = (UsbManager) getSystemService(Context.USB_SERVICE);
        usbManager.requestPermission(device, PendingIntent.getBroadcast(
                this, 0, new Intent(ACTION_USB_PERMISSION),
                PendingIntent.FLAG_IMMUTABLE));
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(permissionReceiver);
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
