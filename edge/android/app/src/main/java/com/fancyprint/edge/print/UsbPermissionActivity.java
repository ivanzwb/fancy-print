package com.fancyprint.edge.print;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;

import com.fancyprint.edge.FancyPrintApplication;

/**
 * UsbPermissionActivity — USB 权限请求透明 Activity
 *
 * 在 EdgeDaemonService 需要 USB 打印权限时，启动此透明 Activity
 * 向用户请求权限。权限获取后自动 finish。
 */
public class UsbPermissionActivity extends AppCompatActivity {

    private static final String TAG = "UsbPermissionActivity";

    @Override
    protected void attachBaseContext(Context newBase) {
        if (FancyPrintApplication.isRk3566Overdensed()) {
            Configuration config = new Configuration(newBase.getResources().getConfiguration());
            config.densityDpi = DisplayMetrics.DENSITY_MEDIUM;
            super.attachBaseContext(newBase.createConfigurationContext(config));
        } else {
            super.attachBaseContext(newBase);
        }
    }


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

        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(permissionReceiver, filter);
        }

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
