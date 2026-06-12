package com.fancyprint.edge.ui;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.RemoteException;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.viewpager.widget.PagerAdapter;
import androidx.viewpager.widget.ViewPager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import com.fancyprint.edge.cloud.ApiClient;

import androidx.appcompat.app.AppCompatActivity;

import com.fancyprint.edge.ContentModes;
import com.fancyprint.edge.FancyPrintApplication;
import com.fancyprint.edge.IAsrCallback;
import com.fancyprint.edge.IEdgeDaemonService;
import com.fancyprint.edge.IPrintJobCallback;
import com.fancyprint.edge.R;
import com.fancyprint.edge.security.DeviceAdminReceiver;
import com.fancyprint.edge.voice.VoiceIntent;

/**
 * MainActivity — Kiosk 主界面（全屏沉浸、不可退出、开机自启）
 *
 * 对应 doc/2 §13.3.2 显示与触屏 — Lock Task Mode kiosk
 *
 * 安全措施：
 * - 全屏沉浸模式（隐藏系统栏/导航栏/状态栏）
 * - Lock Task Mode（锁定当前应用，禁止退出到桌面）
 * - 禁止返回键、最近任务键、Home 键
 * - 窗口焦点变化时重新进入沉浸模式
 * - 屏幕常亮（不自动息屏）
 * - 开机自启动（BootReceiver）
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";

    private IEdgeDaemonService daemonService;
    private boolean bound = false;
    private boolean fromBoot = false;
    private boolean dpcProvisioned = false;
    private String pendingJobId; // 云端下发的待确认任务 ID（P1-4）

    private TextView statusText;
    private ImageButton pttButton;
    private Button pttBarButton;
    private ViewPager previewPager;
    private PreviewPagerAdapter previewAdapter;
    private final List<Bitmap> previewHistory = new ArrayList<>();
    private final List<String> previewTranscripts = new ArrayList<>();
    private View voiceContainer, generatingContainer, previewContainer;
    private TextView previewTranscript, generatingText;
    private Button cancelGenButton;
    private ProgressBar generatingProgress;
    private String currentPreviewUrl;
    private String currentTranscript;
    private View launcherContainer;
    private View launcherSettingsBtn;
    private View launcherHeader;
    private View headerBackButton;
    private TextView headerModeTitle;
    private TextView headerLauncherTitle;
    private boolean isRecording = false;
    
    // 预览图片数据模型
    private static class PreviewImageInfo {
        String filePath;
        String transcript;
        long timestamp;
        boolean savedToCloud;

        PreviewImageInfo(String filePath, String transcript, long timestamp) {
            this.filePath = filePath;
            this.transcript = transcript;
            this.timestamp = timestamp;
            this.savedToCloud = false;
        }
    }

    // 打印/保存按钮
    private Button btnPrintPreview;
    private Button btnSavePreview;

    // 预览图片元数据
    private final List<PreviewImageInfo> previewImageInfos = new ArrayList<>();

    // 云端 API 客户端
    private ApiClient apiClient;

    // 启动器顶部状态栏
    private ImageView statusWifi;
    private ImageView statusCloud;
    private ImageView statusBattery;
    
    private BroadcastReceiver batteryReceiver;
    private long pttDownTime = 0;
    private static final int MIN_PTT_MS = 2000;
    private boolean isVoiceCommand = false; // 最短 PTT 按键 2 秒（Baidu ASR 需要至少 1 秒）

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            daemonService = IEdgeDaemonService.Stub.asInterface(service);
            bound = true;
            Log.i(TAG, "Bound to EdgeDaemonService");
            registerCallback();
            updateDeviceInfo();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            daemonService = null;
            bound = false;
            Log.w(TAG, "Disconnected from EdgeDaemonService");
        }
    };

    private final IPrintJobCallback.Stub printCallback = new IPrintJobCallback.Stub() {
        @Override
        public void onPrintJobStatusChanged(String jobId, String status, int errorCode, String message) {
            runOnUiThread(() -> {
                statusText.setText("打印: " + message);
                if ("pending_confirm".equals(status)) {
                    pendingJobId = jobId; // 记录云端下发的待确认任务
                    statusText.setText("有新打印任务");
                }
                updateQueueInfo();
            });
        }

        @Override
        public void onConnectionStatusChanged(String status) {
            runOnUiThread(() -> {
                findViewById(R.id.connection_status).setVisibility(View.VISIBLE);
                ((TextView) findViewById(R.id.connection_status)).setText("连接: " + status);
                if (statusCloud != null) {
                    if ("connected".equals(status) || "已连接".equals(status)) {
                        statusCloud.setColorFilter(0xFF4CAF50);
                    } else {
                        statusCloud.setColorFilter(0xFFFF5252);
                    }
                }
            });
        }

        @Override
        public void onDeviceAlert(String type, String message) {
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            });
        }

        @Override
        public void onUpdateAvailable(String version, String changelog) {
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this,
                        "新版本 " + version + " 可用", Toast.LENGTH_LONG).show();
            });
        }
    };

    // ============================================================
    // 生命周期
    // ============================================================

    @SuppressLint("MissingSuperCall")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        fromBoot = getIntent().getBooleanExtra("from_boot", false);

        // === 屏幕常亮（不自动息屏） ===
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // === 禁用屏幕锁定（不显示锁屏界面） ===
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        setContentView(R.layout.activity_main);

        // === 全屏沉浸模式（setContentView 之后，确保 DecorView 已创建） ===
        enableFullScreenImmersive();

        statusText = findViewById(R.id.status_text);
        pttButton = findViewById(R.id.ptt_button);
        pttBarButton = findViewById(R.id.ptt_bar_button);
        previewPager = findViewById(R.id.preview_pager);
        previewAdapter = new PreviewPagerAdapter();
        previewPager.setAdapter(previewAdapter);
        previewPager.addOnPageChangeListener(new ViewPager.SimpleOnPageChangeListener() {
            @Override
            public void onPageSelected(int position) {
                if (position >= 0 && position < previewTranscripts.size()) {
                    previewTranscript.setText(previewTranscripts.get(position));
                }
            }
        });
        voiceContainer = findViewById(R.id.voice_container);
        generatingContainer = findViewById(R.id.generating_container);
        previewContainer = findViewById(R.id.preview_container);
        previewTranscript = findViewById(R.id.preview_transcript);
        generatingText = findViewById(R.id.generating_text);
        generatingProgress = findViewById(R.id.generating_progress);
        cancelGenButton = findViewById(R.id.cancel_gen_button);
        launcherContainer = findViewById(R.id.launcher_container);
        launcherSettingsBtn = findViewById(R.id.launcher_settings_btn);
        launcherHeader = findViewById(R.id.launcher_header);
        headerBackButton = findViewById(R.id.header_back_button);
        headerModeTitle = findViewById(R.id.header_mode_title);
        headerLauncherTitle = findViewById(R.id.header_launcher_title);
        statusWifi = findViewById(R.id.status_wifi);
        statusCloud = findViewById(R.id.status_cloud);
        statusBattery = findViewById(R.id.status_battery);
        btnPrintPreview = findViewById(R.id.btn_print_preview);
        btnSavePreview = findViewById(R.id.btn_save_preview);

        // 启动并绑定 EdgeDaemonService（Android 14+ 必须先 startForegroundService）
        Intent intent = new Intent(this, com.fancyprint.edge.service.EdgeDaemonService.class);
        intent.setAction("com.fancyprint.edge.action.START_DAEMON");
        startForegroundService(intent);
        bindService(intent, connection, Context.BIND_AUTO_CREATE);

        // 激活 Lock Task Mode（仅在 kiosk/DPC 设备上生效）
        // 测试时跳过，量产 kiosk 设备取消注释
        // enableKioskMode();

        // Android 13+ 请求通知权限（kiosk 场景使用 DPC 预授权或直接请求）
        requestNotificationPermission();

        // PTT 按键（居中大麦克风 + 底部麦克风条共享相同逻辑）
        View.OnTouchListener pttTouchListener = (v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    v.setPressed(true);
                    startPttRecording();
                    pttDownTime = System.currentTimeMillis();
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    v.setPressed(false);
                    long pressDuration = System.currentTimeMillis() - pttDownTime;
                    if (pressDuration < MIN_PTT_MS) {
                        long delay = MIN_PTT_MS - pressDuration;
                        v.postDelayed(() -> stopPttRecording(), delay);
                        Log.i(TAG, "PTT too short (" + pressDuration + "ms), delaying stop by " + delay + "ms");
                    } else {
                        stopPttRecording();
                    }
                    return true;
            }
            return false;
        };
        pttButton.setOnTouchListener(pttTouchListener);
        if (pttBarButton != null) pttBarButton.setOnTouchListener(pttTouchListener);

        // 初始化云端 API 客户端（用于保存图片到服务器）
        apiClient = new ApiClient(this);

        // 保存按钮
        if (btnSavePreview != null) {
            btnSavePreview.setOnClickListener(v -> saveCurrentImageToCloud());
        }

        // 设置按钮（需家长 PIN）— 启动器右下角
        launcherSettingsBtn.setOnClickListener(v -> openParentLockForSettings());
        wireLauncherCards();

        // 顶部返回按钮 → 回启动器主页
        if (headerBackButton != null) {
            headerBackButton.setOnClickListener(v -> showLauncher());
        }

        // 检查 DPC 设备管理员/Device Owner 激活状态
        checkDpcProvisioning();

        if (fromBoot) {
            Log.i(TAG, "Started from boot receiver");
        }

        // 生成界面 — 取消
        if (cancelGenButton != null) {
            cancelGenButton.setOnClickListener(v -> showVoiceMode());
        }

        showLauncher();
    }

    private void openParentLockForSettings() {
        Intent settingsIntent = new Intent(MainActivity.this, ParentLockActivity.class);
        settingsIntent.putExtra("target", "settings");
        startActivity(settingsIntent);
    }

    // ============================================================
    // 状态监控（电池、WiFi、连接状态）
    // ============================================================

    private void startStatusMonitoring() {
        // 电池状态
        batteryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int pct = (level >= 0 && scale > 0) ? (level * 100 / scale) : 0;
                if (statusBattery != null) {
                    if (pct <= 20) {
                        statusBattery.setColorFilter(0xFFFF5252);
                    } else if (pct <= 50) {
                        statusBattery.setColorFilter(0xFFFFAA00);
                    } else {
                        statusBattery.setColorFilter(0xFF4CAF50);
                    }
                }
            }
        };
        IntentFilter batteryFilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        registerReceiver(batteryReceiver, batteryFilter);

        // WiFi 状态
        updateWifiStatus();
    }

    private void updateWifiStatus() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null || statusWifi == null) return;
        Network activeNetwork = cm.getActiveNetwork();
        if (activeNetwork == null) {
            statusWifi.setAlpha(0.3f);
            return;
        }
        NetworkCapabilities caps = cm.getNetworkCapabilities(activeNetwork);
        boolean hasWifi = caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        statusWifi.setAlpha(hasWifi ? 1.0f : 0.3f);
    }

    private void wireLauncherCards() {
        findViewById(R.id.launcher_card_paint).setOnClickListener(v -> enterWorkspace(ContentModes.UI_AI_CREATE));
        findViewById(R.id.launcher_card_lineart).setOnClickListener(v -> enterWorkspace(ContentModes.UI_COLORING));
        findViewById(R.id.launcher_card_quiet).setOnClickListener(v -> enterWorkspace(ContentModes.UI_TEMPLATE));
        findViewById(R.id.launcher_card_album).setOnClickListener(v -> enterWorkspace(ContentModes.UI_MY_WORKS));
    }

    private void enterWorkspace(String uiMode) {
        FancyPrintApplication.selectedUiContentMode = uiMode;
        updatePttHintForMode(uiMode);
        updateHeaderTitle(uiMode);
        showWorkspaceVoice();
        speakModeHint(uiMode);
    }
    
    private void speakModeHint(String uiMode) {
        if (!bound || daemonService == null) return;
        try {
            if (ContentModes.UI_AI_CREATE.equals(uiMode)) {
                daemonService.speak("变彩画模式，按住说话描述画面");
            } else if (ContentModes.UI_COLORING.equals(uiMode)) {
                daemonService.speak("变线稿模式，按住说话描述线稿");
            } else if (ContentModes.UI_TEMPLATE.equals(uiMode)) {
                daemonService.speak("安静书模式，按住说话描述内容");
            } else if (ContentModes.UI_MY_WORKS.equals(uiMode)) {
                daemonService.speak("小相册模式");
            }
        } catch (Exception e) {
            Log.e(TAG, "speakModeHint error", e);
        }
    }

    private void updateHeaderTitle(String uiMode) {
        if (headerModeTitle == null) return;
        if (headerLauncherTitle != null) headerLauncherTitle.setVisibility(View.GONE);
        headerModeTitle.setVisibility(View.VISIBLE);
        if (ContentModes.UI_AI_CREATE.equals(uiMode)) {
            headerModeTitle.setText("变彩画");
        } else if (ContentModes.UI_COLORING.equals(uiMode)) {
            headerModeTitle.setText("变线稿");
        } else if (ContentModes.UI_TEMPLATE.equals(uiMode)) {
            headerModeTitle.setText("安静书");
        } else if (ContentModes.UI_MY_WORKS.equals(uiMode)) {
            headerModeTitle.setText("小相册");
        } else {
            headerModeTitle.setText("奇想印印");
        }
    }

    private void updatePttHintForMode(String uiMode) {
        TextView hint = findViewById(R.id.hint_text);
        if (hint == null) return;
        if (ContentModes.UI_AI_CREATE.equals(uiMode)) {
            hint.setText("按住说话，描述想要的画面");
        } else if (ContentModes.UI_COLORING.equals(uiMode)) {
            hint.setText("按住说话，描述线稿内容");
        } else if (ContentModes.UI_TEMPLATE.equals(uiMode)) {
            hint.setText("按住说话，描述想要的内容");
        } else if (ContentModes.UI_MY_WORKS.equals(uiMode)) {
            hint.setText("按住说话，描述照片或回忆");
        } else {
            hint.setText(R.string.hint_ptt_default);
        }
    }

    /** 儿童主界面启动器 */
    private void showLauncher() {
        resetWorkbenchUiState();
        launcherContainer.setVisibility(View.VISIBLE);
        launcherHeader.setVisibility(View.VISIBLE);
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
        if (headerBackButton != null) headerBackButton.setVisibility(View.GONE);
        if (headerLauncherTitle != null) headerLauncherTitle.setVisibility(View.VISIBLE);
        if (headerModeTitle != null) headerModeTitle.setVisibility(View.GONE);
    }

    private void resetWorkbenchUiState() {
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
        currentPreviewUrl = null;
        currentTranscript = null;
        statusText.setText("");
        pttButton.clearColorFilter();
        previewHistory.clear();
        previewTranscripts.clear();
        previewImageInfos.clear();
        previewAdapter.notifyDataSetChanged();
    }

    /** 进入 PTT 工作区（居中麦克风 + 按住说话） */
    private void showWorkspaceVoice() {
        launcherContainer.setVisibility(View.GONE);
        launcherHeader.setVisibility(View.VISIBLE);
        voiceContainer.setVisibility(View.VISIBLE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
        currentPreviewUrl = null;
        currentTranscript = null;
        statusText.setText("");
        pttButton.clearColorFilter();
        if (headerBackButton != null) headerBackButton.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 每次恢复时重新进入沉浸模式（防止系统栏意外出现）
        enableFullScreenImmersive();
        // 确保 Lock Task Mode 仍激活（kiosk 模式）
        // ensureKioskActive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 窗口获焦时重新隐藏系统栏（防止通知栏下拉后残留）
        if (hasFocus) {
            enableFullScreenImmersive();
        }
    }

    @Override
    protected void onDestroy() {
        if (batteryReceiver != null) {
            try { unregisterReceiver(batteryReceiver); } catch (Exception ignored) {}
        }
        if (bound && daemonService != null) {
            try {
                daemonService.unregisterPrintCallback(printCallback);
            } catch (RemoteException e) {
                Log.e(TAG, "unregister callback error", e);
            }
            unbindService(connection);
            bound = false;
        }
        super.onDestroy();
    }

    // ============================================================
    // 全屏沉浸模式（API 30+ 和旧版本兼容）
    // ============================================================

    @SuppressLint("ObsoleteSdkInt")
    private void enableFullScreenImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+：WindowInsetsController
            final WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                // 隐藏状态栏和导航栏
                controller.hide(WindowInsets.Type.statusBars()
                        | WindowInsets.Type.navigationBars());
                // 手势滑动时不显示系统栏（immersive）
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            // Android 10 及以下：SYSTEM_UI_FLAGS
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LOW_PROFILE
            );
        }

        // 隐藏 ActionBar
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }
    }

    // ============================================================
    // Lock Task Mode（Kiosk 锁定）
    // ============================================================

    private void enableKioskMode() {
        DevicePolicyManager dpm = (DevicePolicyManager)
                getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, DeviceAdminReceiver.class);

        if (dpm.isAdminActive(admin)) {
            // 将本包名加入锁任务白名单
            dpm.setLockTaskPackages(admin, new String[]{getPackageName()});
            if (dpm.isLockTaskPermitted(getPackageName())) {
                startLockTask();
                Log.i(TAG, "Lock Task Mode activated");
                return;
            }
        }
        // 如果设备管理员未激活，尝试直接 startLockTask（部分 ROM 支持）
        try {
            startLockTask();
            Log.i(TAG, "Lock Task Mode started (no DPC)");
        } catch (Exception e) {
            Log.w(TAG, "Lock Task Mode not available", e);
        }
    }

    /**
     * 检查 DPC（Device Policy Controller）是否已配置
     *
     * 如果设备管理员未激活，说明设备尚未完成 Android Enterprise 托管配置。
     * 对于 kiosk 设备，应使用 DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE
     * 通过 NFC/QR 完成托管配置，从而获得 Lock Task Mode 和设备管理器权限。
     */
    private void checkDpcProvisioning() {
        DevicePolicyManager dpm = (DevicePolicyManager)
                getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, DeviceAdminReceiver.class);

        // 检查是否为 Device Owner（完全托管设备）
        if (dpm.isDeviceOwnerApp(getPackageName())) {
            dpcProvisioned = true;
            Log.i(TAG, "DPC provisioned: device owner");
            return;
        }

        // 检查设备管理员是否已激活（部分托管场景）
        if (dpm.isAdminActive(admin)) {
            dpcProvisioned = true;
            Log.i(TAG, "DPC provisioned: admin active");
            return;
        }

        // 未配置 DPC — 记录日志，UI 上通过状态栏提示
        dpcProvisioned = false;
        Log.w(TAG, "DPC not provisioned — device admin not active, "
                + "Lock Task Mode may be unavailable");

        // DPC 配置仅在 kiosk 量产设备上需要，测试/调试阶段跳过
        // 取消下面注释以启用设备管理：
        // try {
        //     Intent provisioningIntent = new Intent(
        //             DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE);
        //     provisioningIntent.putExtra(
        //             DevicePolicyManager.EXTRA_PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME,
        //             admin);
        //     provisioningIntent.putExtra(
        //             DevicePolicyManager.EXTRA_PROVISIONING_SKIP_ENCRYPTION, true);
        //     provisioningIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        //     startActivity(provisioningIntent);
        //     Log.i(TAG, "Provisioning intent launched");
        // } catch (Exception e) {
        //     Log.w(TAG, "Cannot launch provisioning: " + e.getMessage());
        // }
    }

    private boolean isLockTaskModeActive() {
        android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && am.getLockTaskModeState() != android.app.ActivityManager.LOCK_TASK_MODE_NONE;
    }

    private void ensureKioskActive() {
        try {
            if (isLockTaskModeActive()) {
                // 已在锁定模式，无需操作
                return;
            }
        } catch (Exception ignored) {}
        // 如果不在锁定模式（被意外退出），重新锁定
        enableKioskMode();
    }

    // ============================================================
    // 通知权限（Android 13+ 运行时请求）
    // ============================================================

    private static final int REQUEST_POST_NOTIFICATIONS = 1001;
    private static final int REQUEST_RECORD_AUDIO = 1002;

    /**
     * 请求 POST_NOTIFICATIONS 权限（Android 13+ / API 33+）
     *
     * Android 14 要求：前台服务和通知渠道必须在获得此权限后才会对用户可见。
     * Kiosk 设备可通过 DPC 预授权（DevicePolicyManager.setPermissionGrantState），
     * 若 DPC 未配置则直接弹系统对话框。
     */
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return; // API 33 以下不需要运行时权限
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            FancyPrintApplication.hasNotificationPermission = true;
            return;
        }

        // 尝试通过 DPC 静默授权（kiosk 设备管理员可做到）
        DevicePolicyManager dpm = (DevicePolicyManager)
                getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, DeviceAdminReceiver.class);
        if (dpm.isAdminActive(admin)) {
            try {
                dpm.setPermissionGrantState(admin, getPackageName(),
                        Manifest.permission.POST_NOTIFICATIONS,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
                Log.i(TAG, "POST_NOTIFICATIONS granted via DPC");
                FancyPrintApplication.hasNotificationPermission = true;
                return;
            } catch (Exception e) {
                Log.w(TAG, "DPC grant failed, fallback to dialog", e);
            }
        }

        // 兜底：弹系统对话框请求
        requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                REQUEST_POST_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            if (grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                FancyPrintApplication.hasNotificationPermission = true;
                Log.i(TAG, "POST_NOTIFICATIONS granted by user");
            } else {
                Log.w(TAG, "POST_NOTIFICATIONS denied — 前台服务通知可能不显示");
                // kiosk 设备上无法拒绝 — 可通过 DPC 强制授权
            }
        } else if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.i(TAG, "RECORD_AUDIO granted, restarting recording");
                statusText.setText("按住说话");
                // 权限刚授予，用户需要重新按住 PTT 按键
            } else {
                Log.w(TAG, "RECORD_AUDIO denied");
                statusText.setText("麦克风权限被拒绝");
            }
        }
    }

    // ============================================================
    // 按键拦截（禁止退出 Kiosk）
    // ============================================================

    /**
     * 拦截所有物理按键：
     * - 返回键 → 无反应（不退出 Activity）
     * - Home 键 → Lock Task Mode 已拦截
     * - 最近任务键 → Lock Task Mode 已拦截
     * - 音量键 → 保留（用于调节 PTT/TTS 音量）
     */
    @Override
    public void onBackPressed() {
        // Kiosk 模式下返回键无反应
        Log.d(TAG, "Back button blocked (kiosk mode)");
        // 不调用 super.onBackPressed()
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 拦截返回键和菜单键
        if (keyCode == KeyEvent.KEYCODE_BACK
                || keyCode == KeyEvent.KEYCODE_MENU
                || keyCode == KeyEvent.KEYCODE_APP_SWITCH) {
            Log.d(TAG, "Key blocked: " + keyCode);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        // 拦截长按（如长按 Home 键调出最近任务）
        if (keyCode == KeyEvent.KEYCODE_HOME
                || keyCode == KeyEvent.KEYCODE_BACK
                || keyCode == KeyEvent.KEYCODE_MENU) {
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    // ============================================================
    // 阻止通过 Recent Apps 进入 / 多窗口拖拽
    // ============================================================

    @Override
    protected void onUserLeaveHint() {
        // 防止用户通过手势离开 Activity
        super.onUserLeaveHint();
        if (isLockTaskModeActive()) {
            // Re-lock if somehow left
            moveTaskToBack(true);
        }
    }

    // ============================================================
    // PTT 录音
    // ============================================================

    private void startPttRecording() {
        if (!bound || daemonService == null) return;
        // Android 14 需要运行时请求 RECORD_AUDIO
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            statusText.setText("需要麦克风权限");
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                    REQUEST_RECORD_AUDIO);
            return;
        }
        try {
            // 使用 PCM 录制（16kHz 16bit mono），供本地 Sherpa-ONNX 离线 ASR
            String pcmPath = daemonService.startPcmRecording();
            if (pcmPath != null && !pcmPath.isEmpty()) {
                isRecording = true;
                pttButton.setColorFilter(0xFFFF4444, android.graphics.PorterDuff.Mode.SRC_IN);
                statusText.setText("录音中...");
            } else {
                Log.w(TAG, "startPcmRecording returned empty path");
                statusText.setText("录音启动失败");
            }
        } catch (RemoteException e) {
            Log.e(TAG, "startPcmRecording error", e);
            statusText.setText("录音异常");
        }
    }

    private void stopPttRecording() {
        if (!bound || daemonService == null || !isRecording) return;
        // 标记录音结束（UI 操作仍在主线程）
        isRecording = false;
        pttButton.setColorFilter(0xFFFFAA00, android.graphics.PorterDuff.Mode.SRC_IN);
        statusText.setText("语音识别中...");

        // AIDL 调用放到后台线程，避免阻塞 UI 导致 ANR
        final IEdgeDaemonService service = daemonService;
        new Thread(() -> {
            try {
                String pcmPath = service.stopPcmRecording();
                Log.i(TAG, "PTT PCM recording saved: " + pcmPath);

                if (pcmPath != null && !pcmPath.isEmpty()) {
                service.transcribeAudio(pcmPath, new IAsrCallback.Stub() {
                        @Override
                        public void onSuccess(String transcription) {
                            runOnUiThread(() -> {
                                pttButton.clearColorFilter();
                                currentTranscript = transcription;
                            });
                        }

                        @Override
                        public void onIntentResult(String resultJson) {
                            runOnUiThread(() -> handleVoiceIntentResult(resultJson));
                        }

                        @Override
                        public void onImageReady(String previewUrl) {
                            runOnUiThread(() -> {
                                if (isVoiceCommand) {
                                    Log.i(TAG, "onImageReady: ignored (voice command mode)");
                                    return;
                                }
                                currentPreviewUrl = previewUrl;
                                
                                // 处理 HTTPS URL vs data:image vs 纯 base64
                                if (previewUrl.startsWith("http://") || previewUrl.startsWith("https://")) {
                                    // HTTPS URL: 需要下载图片
                                    Log.i(TAG, "onImageReady: downloading from URL: " + previewUrl);
                                    new Thread(() -> {
                                        try {
                                            java.net.URL url = new java.net.URL(previewUrl);
                                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                                            conn.setConnectTimeout(15000);
                                            conn.setReadTimeout(30000);
                                            java.io.InputStream is = conn.getInputStream();
                                            Bitmap bitmap = BitmapFactory.decodeStream(is);
                                            is.close();
                                            conn.disconnect();
                                            
                                            runOnUiThread(() -> {
                                                if (bitmap != null) {
                                                    Log.i(TAG, "onImageReady: downloaded bitmap " + bitmap.getWidth() + "x" + bitmap.getHeight());
                                                    addToPreviewHistory(bitmap, currentTranscript);
                                                    showPreviewMode();
                                                } else {
                                                    Log.e(TAG, "onImageReady: downloaded bitmap is null");
                                                    statusText.setText("图片下载失败");
                                                    showVoiceMode();
                                                }
                                            });
                                        } catch (Exception e) {
                                            Log.e(TAG, "onImageReady: download error", e);
                                            runOnUiThread(() -> {
                                                statusText.setText("图片下载失败: " + e.getMessage());
                                                showVoiceMode();
                                            });
                                        }
                                    }).start();
                                } else {
                                    // data:image 或纯 base64
                                    try {
                                        String base64 = previewUrl;
                                        if (previewUrl.startsWith("data:image")) {
                                            base64 = previewUrl.substring(previewUrl.indexOf(",") + 1);
                                        }
                                        byte[] imageBytes = Base64.decode(base64, Base64.DEFAULT);
                                        Bitmap bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
                                        if (bitmap != null) {
                                            Log.i(TAG, "onImageReady: base64 bitmap " + bitmap.getWidth() + "x" + bitmap.getHeight());
                                            addToPreviewHistory(bitmap, currentTranscript);
                                            showPreviewMode();
                                        } else {
                                            Log.e(TAG, "onImageReady: base64 bitmap is null");
                                            statusText.setText("图片解析失败");
                                            showVoiceMode();
                                        }
                                    } catch (Exception e) {
                                        Log.e(TAG, "onImageReady error", e);
                                        statusText.setText("图片解析失败");
                                        showVoiceMode();
                                    }
                                }
                            });
                        }

                        @Override
                        public void onError(int code, String message) {
                            runOnUiThread(() -> {
                                pttButton.clearColorFilter();
                                showVoiceMode();
                                statusText.setText("识别失败: " + message);
                            });
                        }
                    });
                } else {
                    runOnUiThread(() -> {
                        pttButton.clearColorFilter();
                        statusText.setText("录音为空");
                    });
                }
            } catch (RemoteException e) {
                Log.e(TAG, "stopPcmRecording error", e);
                runOnUiThread(() -> pttButton.clearColorFilter());
            }
        }, "ptt-asr").start();
    }

    // ============================================================
    // 设备信息
    // ============================================================

    private void updateDeviceInfo() {
        if (!bound || daemonService == null) return;
        try {
            String info = daemonService.getDeviceInfo();
            Log.i(TAG, "Device info: " + info);
            updateQueueInfo();
        } catch (RemoteException e) {
            Log.e(TAG, "getDeviceInfo error", e);
        }
    }

    private void updateQueueInfo() {
        if (!bound || daemonService == null) return;
        try {
            String queueJson = daemonService.getPrintQueue();
            org.json.JSONArray arr = new org.json.JSONArray(queueJson);
            statusText.setText("队列: " + arr.length() + " 个任务");
        } catch (Exception e) {
            Log.e(TAG, "getPrintQueue error", e);
        }
    }

    private void registerCallback() {
        if (!bound || daemonService == null) return;
        try {
            daemonService.registerPrintCallback(printCallback);
        } catch (RemoteException e) {
            Log.e(TAG, "register callback error", e);
        }
    }

    // ============================================================
    // 界面模式切换
    // ============================================================

    private void showVoiceMode() {
        launcherContainer.setVisibility(View.GONE);
        launcherHeader.setVisibility(View.VISIBLE);
        voiceContainer.setVisibility(View.VISIBLE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
        currentPreviewUrl = null;
        currentTranscript = null;
        statusText.setText("");
        pttButton.clearColorFilter();
        if (headerBackButton != null) headerBackButton.setVisibility(View.VISIBLE);
    }

    private void showGeneratingMode(String transcript) {
        launcherContainer.setVisibility(View.GONE);
        launcherHeader.setVisibility(View.VISIBLE);
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.VISIBLE);
        previewContainer.setVisibility(View.GONE);
        generatingText.setText("🎨 AI 正在根据「" + transcript + "」生成图片...");
        generatingProgress.setVisibility(View.VISIBLE);
        if (headerBackButton != null) headerBackButton.setVisibility(View.VISIBLE);
    }

    private void showPreviewMode() {
        launcherContainer.setVisibility(View.GONE);
        launcherHeader.setVisibility(View.VISIBLE);
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.VISIBLE);
        previewContainer.bringToFront();
        generatingProgress.setVisibility(View.GONE);
        if (headerBackButton != null) headerBackButton.setVisibility(View.VISIBLE);
    }

    private void handleVoiceIntentResult(String resultJson) {
        try {
            org.json.JSONObject json = new org.json.JSONObject(resultJson);
            String intent = json.optString("intent", VoiceIntent.ASK_CLARIFY);
            String contentMode = json.optString("contentMode", "");
            String prompt = json.optString("prompt", currentTranscript != null ? currentTranscript : "");
            String replyText = json.optString("replyText", "");

            if (VoiceIntent.CREATE_IMAGE.equals(intent)) {
                isVoiceCommand = false;
                showGeneratingMode(prompt);
                return;
            }

            isVoiceCommand = true;
            if (VoiceIntent.SWITCH_MODE.equals(intent)) {
                if (!contentMode.isEmpty()) {
                    enterWorkspace(contentMode);
                }
            } else if (VoiceIntent.GO_HOME.equals(intent)) {
                showLauncher();
                startStatusMonitoring();
            } else if (VoiceIntent.CONFIRM_PRINT.equals(intent)) {
                confirmCurrentPrintByVoice();
            } else if (VoiceIntent.CANCEL_CURRENT.equals(intent)) {
                showVoiceMode();
            } else if (VoiceIntent.HELP.equals(intent) || VoiceIntent.ASK_CLARIFY.equals(intent)) {
                showVoiceMode();
                statusText.setText(replyText);
            } else {
                showVoiceMode();
                statusText.setText(replyText.isEmpty() ? "我没有听懂，可以再说一遍吗" : replyText);
            }
        } catch (Exception e) {
            Log.e(TAG, "handleVoiceIntentResult parse error", e);
            showVoiceMode();
            statusText.setText("我没有听懂，可以再说一遍吗");
        }
    }

    private void confirmCurrentPrintByVoice() {
        if (!bound || daemonService == null) {
            statusText.setText("设备还没准备好");
            return;
        }
        if (pendingJobId == null || pendingJobId.isEmpty()) {
            statusText.setText("还没有可以确认的打印任务");
            return;
        }
        try {
            boolean ok = daemonService.confirmPrintJob(pendingJobId);
            statusText.setText(ok ? "已确认打印" : "确认打印失败");
            if (ok) {
                pendingJobId = null;
            }
        } catch (RemoteException e) {
            Log.e(TAG, "confirmPrintJob by voice error", e);
            statusText.setText("确认打印异常");
        }
    }

    // ============================================================
    // 图片预览历史（左右滑动 + 本地文件存储）
    // ============================================================

    private static final int MAX_HISTORY_IMAGES = 50;
    private static final long MIN_FREE_DISK_BYTES = 50 * 1024 * 1024L;

    private void addToPreviewHistory(Bitmap bitmap, String transcript) {
        // 保存到本地文件
        String filePath = saveBitmapToFile(bitmap);
        if (filePath != null) {
            ensureFreeDiskSpace();
        }

        // 管理内存缓存上限
        if (previewHistory.size() >= MAX_HISTORY_IMAGES) {
            int removeCount = previewHistory.size() - MAX_HISTORY_IMAGES + 1;
            for (int i = 0; i < removeCount; i++) {
                previewHistory.remove(0);
                previewTranscripts.remove(0);
                if (!previewImageInfos.isEmpty()) {
                    previewImageInfos.remove(0);
                }
            }
        }

        previewHistory.add(bitmap);
        String transcriptStr = transcript != null ? transcript : "";
        previewTranscripts.add(transcriptStr);
        previewImageInfos.add(new PreviewImageInfo(
                filePath != null ? filePath : "",
                transcriptStr,
                System.currentTimeMillis()));
        previewAdapter.notifyDataSetChanged();
        previewPager.setCurrentItem(previewHistory.size() - 1, false);
        previewTranscript.setText(transcriptStr);
    }

    private String saveBitmapToFile(Bitmap bitmap) {
        File dir = new File(getFilesDir(), "previews");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.e(TAG, "saveBitmapToFile: failed to create previews dir");
            return null;
        }
        String filename = System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8) + ".jpg";
        File file = new File(dir, filename);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, fos);
            fos.flush();
            Log.i(TAG, "saveBitmapToFile: saved " + file.getAbsolutePath());
            return file.getAbsolutePath();
        } catch (IOException e) {
            Log.e(TAG, "saveBitmapToFile error", e);
            return null;
        }
    }

    private void ensureFreeDiskSpace() {
        File dir = new File(getFilesDir(), "previews");
        if (!dir.exists()) return;
        long freeBytes = dir.getFreeSpace();
        if (freeBytes >= MIN_FREE_DISK_BYTES) return;

        // 收集未保存的文件，按时间升序（最旧在前）
        List<PreviewImageInfo> unsaved = new ArrayList<>();
        for (PreviewImageInfo info : previewImageInfos) {
            if (!info.savedToCloud && info.filePath != null && !info.filePath.isEmpty()) {
                unsaved.add(info);
            }
        }
        Collections.sort(unsaved, (a, b) -> Long.compare(a.timestamp, b.timestamp));

        long targetFree = MIN_FREE_DISK_BYTES + 10 * 1024 * 1024L;
        for (PreviewImageInfo info : unsaved) {
            if (dir.getFreeSpace() >= targetFree) break;
            File f = new File(info.filePath);
            if (f.exists() && f.delete()) {
                Log.i(TAG, "ensureFreeDiskSpace: deleted " + info.filePath);
            }
            // 从列表中移除
            int idx = previewImageInfos.indexOf(info);
            if (idx >= 0) {
                previewImageInfos.remove(idx);
                if (idx < previewHistory.size()) {
                    previewHistory.remove(idx);
                    previewTranscripts.remove(idx);
                }
            }
        }
        previewAdapter.notifyDataSetChanged();
    }

    // ============================================================
    // 保存当前预览图片到云端
    // ============================================================

    private void saveCurrentImageToCloud() {
        int pos = previewPager.getCurrentItem();
        if (pos < 0 || pos >= previewImageInfos.size()) return;

        final PreviewImageInfo info = previewImageInfos.get(pos);
        if (info.filePath == null || info.filePath.isEmpty()) {
            Toast.makeText(this, "图片文件不存在", Toast.LENGTH_SHORT).show();
            return;
        }

        if (info.savedToCloud) {
            Toast.makeText(this, "已保存到云端", Toast.LENGTH_SHORT).show();
            return;
        }

        btnSavePreview.setEnabled(false);
        btnSavePreview.setText("保存中...");

        apiClient.uploadImage(info.filePath, info.transcript, new ApiClient.ApiCallback() {
            @Override
            public void onSuccess(String response) {
                info.savedToCloud = true;
                runOnUiThread(() -> {
                    btnSavePreview.setEnabled(true);
                    btnSavePreview.setText(getString(R.string.preview_save));
                    Toast.makeText(MainActivity.this, "已保存到云端", Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onError(int code, String message) {
                runOnUiThread(() -> {
                    btnSavePreview.setEnabled(true);
                    btnSavePreview.setText(getString(R.string.preview_save));
                    Toast.makeText(MainActivity.this, "保存失败: " + message, Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    // ============================================================
    // PreviewPagerAdapter
    // ============================================================

    private class PreviewPagerAdapter extends PagerAdapter {
        @Override
        public int getCount() {
            return previewHistory.size();
        }

        @Override
        public boolean isViewFromObject(@NonNull View view, @NonNull Object object) {
            return view == object;
        }

        @NonNull
        @Override
        public Object instantiateItem(@NonNull ViewGroup container, int position) {
            ImageView imageView = new ImageView(MainActivity.this);
            imageView.setLayoutParams(new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
            imageView.setImageBitmap(previewHistory.get(position));
            container.addView(imageView);
            return imageView;
        }

        @Override
        public void destroyItem(@NonNull ViewGroup container, int position, @NonNull Object object) {
            container.removeView((View) object);
        }
    }
}
