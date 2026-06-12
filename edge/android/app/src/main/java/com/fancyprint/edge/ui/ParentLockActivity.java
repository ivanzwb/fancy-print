package com.fancyprint.edge.ui;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.res.Configuration;
import android.os.Bundle;
import android.os.IBinder;
import android.os.RemoteException;
import android.text.InputType;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.fancyprint.edge.IEdgeDaemonService;
import com.fancyprint.edge.FancyPrintApplication;
import com.fancyprint.edge.R;

/**
 * ParentLockActivity — 家长锁验证 / 设置界面
 *
 * 对应 doc/2 §13.5.2 儿童场景的 Android 特有优势
 *
 * 在访问设置、退出 kiosk、修改家长锁时弹出 PIN 验证。
 */
public class ParentLockActivity extends AppCompatActivity {

    private static final String TAG = "ParentLockActivity";

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



    private IEdgeDaemonService daemonService;
    private boolean bound = false;

    private EditText pinInput;
    private TextView titleText;
    private TextView errorText;
    private Button confirmButton;
    private Button cancelButton;

    private String target; // "settings" / "lock" / "exit_kiosk"

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            daemonService = IEdgeDaemonService.Stub.asInterface(service);
            bound = true;
            updateUI();
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
        setContentView(R.layout.activity_parent_lock);

        titleText = findViewById(R.id.parent_lock_title);
        pinInput = findViewById(R.id.pin_input);
        errorText = findViewById(R.id.error_text);
        confirmButton = findViewById(R.id.confirm_button);
        cancelButton = findViewById(R.id.cancel_button);
        Button forgotButton = findViewById(R.id.forgot_button);

        target = getIntent().getStringExtra("target");
        if (target == null) target = "settings";

        // 绑定服务
        Intent intent = new Intent(this, com.fancyprint.edge.service.EdgeDaemonService.class);
        bindService(intent, connection, Context.BIND_AUTO_CREATE);

        confirmButton.setOnClickListener(v -> validatePin());
        cancelButton.setOnClickListener(v -> finish());

        // 忘记 PIN — 验证管理员身份 TODO: 实现管理员恢复流程
        forgotButton.setOnClickListener(v -> {
            errorText.setText("请联系客服重置 PIN");
        });

        updateUI();
    }

    @Override
    protected void onDestroy() {
        if (bound) {
            unbindService(connection);
            bound = false;
        }
        super.onDestroy();
    }

    private void updateUI() {
        if (titleText == null) return;

        if (bound && daemonService != null) {
            try {
                boolean enabled = daemonService.isParentLockEnabled();
                if (!enabled && "settings".equals(target)) {
                    titleText.setText("设置家长锁 PIN");
                    pinInput.setHint("请输入 4-8 位 PIN");
                } else {
                    titleText.setText("家长验证");
                    pinInput.setHint("请输入 PIN");
                }
            } catch (RemoteException e) {
                Log.e(TAG, "isParentLockEnabled error", e);
            }
        } else {
            titleText.setText("家长验证");
            pinInput.setHint("请输入 PIN");
        }
    }

    private void validatePin() {
        String pin = pinInput.getText().toString().trim();
        if (pin.isEmpty()) {
            errorText.setText("请输入 PIN");
            return;
        }

        if (!bound || daemonService == null) {
            errorText.setText("服务未连接");
            return;
        }

        try {
            boolean valid = daemonService.validateParentPin(pin);
            if (valid) {
                navigateToTarget();
            } else {
                errorText.setText("PIN 错误，请重试");
                pinInput.setText("");
            }
        } catch (RemoteException e) {
            Log.e(TAG, "validatePin error", e);
            errorText.setText("验证失败");
        }
    }

    private void navigateToTarget() {
        Intent intent = null;
        switch (target) {
            case "settings":
                intent = new Intent(this, SettingsActivity.class);
                break;
            case "exit_kiosk":
                stopLockTask();
                finish();
                return;
            default:
                finish();
                return;
        }
        if (intent != null) {
            startActivity(intent);
            finish();
        }
    }
}
