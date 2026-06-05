package com.fancyprint.edge.ui;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.RemoteException;
import android.provider.Settings;
import android.util.Log;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.fancyprint.edge.IEdgeDaemonService;
import com.fancyprint.edge.R;

/**
 * SettingsActivity — 设备设置界面
 *
 * 家长通过 PIN 验证后进入的设置界面：
 * - 家长锁 PIN 修改
 * - 设备信息查看
 * - OTA 检查
 * - 重启设备
 * - 退出 Kiosk 模式
 */
public class SettingsActivity extends AppCompatActivity {

    private static final String TAG = "SettingsActivity";

    private IEdgeDaemonService daemonService;
    private boolean bound = false;

    private EditText oldPinInput;
    private EditText newPinInput;
    private EditText confirmPinInput;
    private Switch lockEnabledSwitch;
    private Switch otaAutoCheckSwitch;
    private Button changePinButton;
    private Button checkUpdateButton;
    private Button rebootButton;
    private Button factoryResetButton;
    private Button exitKioskButton;
    private Button wifiSettingsButton;
    private TextView deviceInfoText;
    private TextView wifiSsidText;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            daemonService = IEdgeDaemonService.Stub.asInterface(service);
            bound = true;
            loadDeviceInfo();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            daemonService = null;
            bound = false;
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        oldPinInput = findViewById(R.id.old_pin);
        newPinInput = findViewById(R.id.new_pin);
        confirmPinInput = findViewById(R.id.confirm_pin);
        lockEnabledSwitch = findViewById(R.id.lock_enabled_switch);
        changePinButton = findViewById(R.id.change_pin_button);
        otaAutoCheckSwitch = findViewById(R.id.ota_auto_check_switch);
        checkUpdateButton = findViewById(R.id.check_update_button);
        wifiSettingsButton = findViewById(R.id.wifi_settings_button);
        wifiSsidText = findViewById(R.id.wifi_ssid_text);
        rebootButton = findViewById(R.id.reboot_button);
        factoryResetButton = findViewById(R.id.factory_reset_button);
        exitKioskButton = findViewById(R.id.exit_kiosk_button);
        deviceInfoText = findViewById(R.id.device_info_text);

        // 绑定服务
        Intent intent = new Intent(this, com.fancyprint.edge.service.EdgeDaemonService.class);
        bindService(intent, connection, Context.BIND_AUTO_CREATE);

        // 修改 PIN
        changePinButton.setOnClickListener(v -> changePin());

        // 加载 WiFi 信息
        loadWifiSsid();

        // 家长锁开关
        lockEnabledSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (bound && daemonService != null) {
                try {
                    daemonService.setParentLockEnabled(isChecked);
                    Log.i(TAG, "Parent lock " + (isChecked ? "enabled" : "disabled"));
                    Toast.makeText(this, isChecked ? "家长锁已启用" : "家长锁已禁用", Toast.LENGTH_SHORT).show();
                } catch (RemoteException e) {
                    Log.e(TAG, "setParentLockEnabled error", e);
                    lockEnabledSwitch.setChecked(!isChecked);
                }
            }
        });

        // WiFi 设置按钮 → 打开系统 WiFi 设置
        wifiSettingsButton.setOnClickListener(v -> {
            startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
        });

        // OTA 自动检查开关
        otaAutoCheckSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            getSharedPreferences("settings", MODE_PRIVATE)
                    .edit()
                    .putBoolean("ota_auto_check", isChecked)
                    .apply();
            Log.i(TAG, "OTA auto-check " + (isChecked ? "enabled" : "disabled"));
        });

        // 检查更新
        checkUpdateButton.setOnClickListener(v -> {
            if (bound && daemonService != null) {
                try {
                    daemonService.checkForUpdate();
                    checkUpdateButton.setText("检查中...");
                } catch (RemoteException e) {
                    Log.e(TAG, "checkForUpdate error", e);
                }
            }
        });

        // 重启设备
        rebootButton.setOnClickListener(v -> {
            if (daemonService != null) {
                try {
                    daemonService.rebootDevice();
                } catch (RemoteException e) {
                    Log.e(TAG, "Reboot failed", e);
                }
            }
        });

        factoryResetButton.setOnClickListener(v -> {
            new AlertDialog.Builder(this)
                    .setTitle("恢复出厂设置")
                    .setMessage("此操作将清除所有数据，包括 PIN、打印队列和设置。确定继续？")
                    .setNegativeButton("取消", null)
                    .setPositiveButton("确定", (dialog, which) -> {
                        if (daemonService != null) {
                            try {
                                daemonService.factoryReset();
                                Toast.makeText(this, "已恢复出厂设置，请重启设备", Toast.LENGTH_LONG).show();
                            } catch (RemoteException e) {
                                Log.e(TAG, "FactoryReset failed", e);
                                Toast.makeText(this, "恢复出厂设置失败", Toast.LENGTH_SHORT).show();
                            }
                        }
                    })
                    .show();
        });

        exitKioskButton.setOnClickListener(v -> {
            stopLockTask();
        });
    }

    @Override
    protected void onDestroy() {
        if (bound) {
            unbindService(connection);
            bound = false;
        }
        super.onDestroy();
    }

    private void changePin() {
        String oldPin = oldPinInput.getText().toString().trim();
        String newPin = newPinInput.getText().toString().trim();
        String confirmPin = confirmPinInput.getText().toString().trim();

        if (newPin.length() < 4 || newPin.length() > 8) {
            changePinButton.setText("PIN 长度需 4-8 位");
            return;
        }
        if (!newPin.equals(confirmPin)) {
            changePinButton.setText("两次输入不一致");
            return;
        }

        if (bound && daemonService != null) {
            try {
                boolean success = daemonService.setParentPin(oldPin, newPin);
                if (success) {
                    changePinButton.setText("PIN 已更新");
                    oldPinInput.setText("");
                    newPinInput.setText("");
                    confirmPinInput.setText("");
                } else {
                    changePinButton.setText("旧 PIN 错误");
                }
            } catch (RemoteException e) {
                Log.e(TAG, "setParentPin error", e);
                changePinButton.setText("设置失败");
            }
        }
    }

    private void loadDeviceInfo() {
        if (!bound || daemonService == null) return;
        try {
            String info = daemonService.getDeviceInfo();
            deviceInfoText.setText(info);
            // 同步家长锁状态
            boolean enabled = daemonService.isParentLockEnabled();
            lockEnabledSwitch.setOnCheckedChangeListener(null);
            lockEnabledSwitch.setChecked(enabled);
            lockEnabledSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
                if (bound && daemonService != null) {
                    try {
                        daemonService.setParentLockEnabled(isChecked);
                        Log.i(TAG, "Parent lock " + (isChecked ? "enabled" : "disabled"));
                        Toast.makeText(this, isChecked ? "家长锁已启用" : "家长锁已禁用", Toast.LENGTH_SHORT).show();
                    } catch (RemoteException e) {
                        Log.e(TAG, "setParentLockEnabled error", e);
                        lockEnabledSwitch.setChecked(!isChecked);
                    }
                }
            });
        } catch (RemoteException e) {
            Log.e(TAG, "getDeviceInfo error", e);
            deviceInfoText.setText("无法获取设备信息");
        }
    }

    private void loadWifiSsid() {
        try {
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                WifiInfo wifiInfo = wifiManager.getConnectionInfo();
                if (wifiInfo != null) {
                    String ssid = wifiInfo.getSSID();
                    if (ssid != null) {
                        // Android 返回的 SSID 可能带引号
                        if (ssid.startsWith("\"") && ssid.endsWith("\"")) {
                            ssid = ssid.substring(1, ssid.length() - 1);
                        }
                        wifiSsidText.setText("已连接: " + ssid);
                        return;
                    }
                }
            }
            // 兜底：通过 ConnectivityManager 判断网络状态
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
                if (activeNetwork != null && activeNetwork.isConnected()) {
                    wifiSsidText.setText("WiFi 已连接");
                    return;
                }
            }
            wifiSsidText.setText("未连接 WiFi");
        } catch (Exception e) {
            Log.e(TAG, "loadWifiSsid error", e);
            wifiSsidText.setText("无法获取 WiFi 信息");
        }
    }
}
