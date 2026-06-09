package com.fancyprint.edge.ui;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
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

import androidx.appcompat.app.AppCompatActivity;

import com.fancyprint.edge.ContentModes;
import com.fancyprint.edge.FancyPrintApplication;
import com.fancyprint.edge.IAsrCallback;
import com.fancyprint.edge.IEdgeDaemonService;
import com.fancyprint.edge.IPrintJobCallback;
import com.fancyprint.edge.R;
import com.fancyprint.edge.security.DeviceAdminReceiver;

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
    private TextView jobCountText;
    private ImageButton pttButton;
    private ImageView previewImage;
    private View voiceContainer, generatingContainer, previewContainer;
    private TextView previewTranscript, generatingText;
    private Button printButton, cancelButton, cancelGenButton;
    private ProgressBar generatingProgress;
    private String currentPreviewUrl; // 当前预览图片的 base64 URL
    private String currentTranscript; // 当前识别文字
    private View bottomBar;
    private View launcherContainer;
    private View launcherSettingsBtn;
    private Button backToLauncher;
    private View statusBar;
    private boolean isRecording = false;
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
        jobCountText = findViewById(R.id.job_count);
        pttButton = findViewById(R.id.ptt_button);
        previewImage = findViewById(R.id.preview_image);
        voiceContainer = findViewById(R.id.voice_container);
        generatingContainer = findViewById(R.id.generating_container);
        previewContainer = findViewById(R.id.preview_container);
        previewTranscript = findViewById(R.id.preview_transcript);
        generatingText = findViewById(R.id.generating_text);
        generatingProgress = findViewById(R.id.generating_progress);
        printButton = findViewById(R.id.print_button);
        cancelButton = findViewById(R.id.cancel_button);
        cancelGenButton = findViewById(R.id.cancel_gen_button);
        bottomBar = findViewById(R.id.bottom_bar);
        launcherContainer = findViewById(R.id.launcher_container);
        launcherSettingsBtn = findViewById(R.id.launcher_settings_btn);
        backToLauncher = findViewById(R.id.back_to_launcher);
        statusBar = findViewById(R.id.status_bar);

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

        // PTT 按键
        pttButton.setOnTouchListener((v, event) -> {
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
                        // 按键太短，延迟到最矮时长再停止
                        long delay = MIN_PTT_MS - pressDuration;
                        v.postDelayed(() -> stopPttRecording(), delay);
                        Log.i(TAG, "PTT too short (" + pressDuration + "ms), delaying stop by " + delay + "ms");
                    } else {
                        stopPttRecording();
                    }
                    return true;
            }
            return false;
        });

        // 设置按钮（需家长 PIN）— 底栏与启动器右下角共用
        findViewById(R.id.settings_button).setOnClickListener(v -> openParentLockForSettings());
        launcherSettingsBtn.setOnClickListener(v -> openParentLockForSettings());
        backToLauncher.setOnClickListener(v -> showLauncher());
        wireLauncherCards();

        // 打印确认
        findViewById(R.id.print_confirm_button).setOnClickListener(v -> {
            Intent confirmIntent = new Intent(MainActivity.this, PrintConfirmActivity.class);
            if (pendingJobId != null) {
                // 有云端下发的待确认任务 → 传递真实数据
                confirmIntent.putExtra("jobId", pendingJobId);
                if (bound && daemonService != null) {
                    try {
                        String jobJson = daemonService.getPrintJobStatus(pendingJobId);
                        org.json.JSONObject json = new org.json.JSONObject(jobJson);
                        confirmIntent.putExtra("imageUrl", json.optString("imageUrl", ""));
                        confirmIntent.putExtra("mode", json.optString("mode", "color"));
                        confirmIntent.putExtra("contentMode", json.optString("contentMode", "coloring"));
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to get pending job details", e);
                    }
                }
                pendingJobId = null; // 消费掉
            }
            startActivity(confirmIntent);
        });

        // 预览界面 — 打印按钮（直接打印：保存 bitmap → 提交打印任务）
        printButton.setOnClickListener(v -> {
            if (currentPreviewUrl == null || currentPreviewUrl.isEmpty()) return;
            printButton.setEnabled(false);
            printButton.setText("打印中...");
            try {
                // 将 base64 解码并保存到临时文件
                String base64 = currentPreviewUrl;
                if (base64.startsWith("data:image")) {
                    base64 = base64.substring(base64.indexOf(",") + 1);
                }
                byte[] imageBytes = Base64.decode(base64, Base64.DEFAULT);
                java.io.File cacheDir = getCacheDir();
                java.io.File tempFile = new java.io.File(cacheDir, "print_" + System.currentTimeMillis() + ".png");
                java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile);
                fos.write(imageBytes);
                fos.close();
                String fileUrl = "file://" + tempFile.getAbsolutePath();
                String jobId = "direct_" + System.currentTimeMillis();

                // 通过 AIDL 提交并确认打印
                if (bound && daemonService != null) {
                    daemonService.submitPrintJob(jobId, fileUrl, "color", FancyPrintApplication.selectedUiContentMode, 120);
                    daemonService.confirmPrintJob(jobId);
                    Log.i(TAG, "Direct print submitted: " + fileUrl);
                    statusText.setText("打印任务已提交");
                    Toast.makeText(this, "打印任务已提交", Toast.LENGTH_SHORT).show();
                } else {
                    statusText.setText("服务未连接");
                    Toast.makeText(this, "服务未连接", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Log.e(TAG, "Direct print error", e);
                Toast.makeText(this, "打印失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
            printButton.setEnabled(true);
            printButton.setText("打印");
        });

        // 预览界面 — 取消，回到语音输入
        cancelButton.setOnClickListener(v -> showVoiceMode());

        // 生成界面 — 取消
        cancelGenButton.setOnClickListener(v -> showVoiceMode());

        // 检查 DPC 设备管理员/Device Owner 激活状态
        checkDpcProvisioning();

        if (fromBoot) {
            Log.i(TAG, "Started from boot receiver");
        }

        showLauncher();
    }

    private void openParentLockForSettings() {
        Intent settingsIntent = new Intent(MainActivity.this, ParentLockActivity.class);
        settingsIntent.putExtra("target", "settings");
        startActivity(settingsIntent);
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

    private void updatePttHintForMode(String uiMode) {
        TextView hint = findViewById(R.id.hint_text);
        if (hint == null) return;
        if (ContentModes.UI_AI_CREATE.equals(uiMode)) {
            hint.setText("变彩画：按住说话，描述想要的画面");
        } else if (ContentModes.UI_COLORING.equals(uiMode)) {
            hint.setText("变线稿：按住说话，描述线稿内容");
        } else if (ContentModes.UI_TEMPLATE.equals(uiMode)) {
            hint.setText("安静书：按住说话，描述想要的内容");
        } else if (ContentModes.UI_MY_WORKS.equals(uiMode)) {
            hint.setText("小相册：按住说话，描述照片或回忆");
        } else {
            hint.setText(R.string.hint_ptt_default);
        }
    }

    /** 儿童主界面 2×2 启动器 */
    private void showLauncher() {
        resetWorkbenchUiState();
        launcherContainer.setVisibility(View.VISIBLE);
        statusBar.setVisibility(View.GONE);
        bottomBar.setVisibility(View.GONE);
    }

    private void resetWorkbenchUiState() {
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
        currentPreviewUrl = null;
        currentTranscript = null;
        statusText.setText("");
        pttButton.clearColorFilter();
    }

    /** 进入 PTT 工作区（保留顶栏与底栏） */
    private void showWorkspaceVoice() {
        launcherContainer.setVisibility(View.GONE);
        statusBar.setVisibility(View.VISIBLE);
        backToLauncher.setVisibility(View.VISIBLE);
        voiceContainer.setVisibility(View.VISIBLE);
        bottomBar.setVisibility(View.VISIBLE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
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
                                
                                if (handleVoiceCommand(transcription)) {
                                    isVoiceCommand = true;
                                    return;
                                }
                                isVoiceCommand = false;
                                showGeneratingMode(transcription);
                            });
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
                                                    previewTranscript.setText(currentTranscript != null ? currentTranscript : "");
                                                    showPreviewMode();
                                                    previewImage.setImageBitmap(bitmap);
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
                                            previewTranscript.setText(currentTranscript != null ? currentTranscript : "");
                                            showPreviewMode();
                                            previewImage.setImageBitmap(bitmap);
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
                                statusText.setText("识别失败: " + message);
                                showVoiceMode();
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
            jobCountText.setText("队列: " + arr.length() + " 个任务");
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
        if (launcherContainer != null) {
            launcherContainer.setVisibility(View.GONE);
        }
        voiceContainer.setVisibility(View.VISIBLE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.GONE);
        bottomBar.setVisibility(View.VISIBLE);
        currentPreviewUrl = null;
        currentTranscript = null;
        statusText.setText("");
        pttButton.clearColorFilter();
    }

    private void showGeneratingMode(String transcript) {
        if (launcherContainer != null) {
            launcherContainer.setVisibility(View.GONE);
        }
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.VISIBLE);
        previewContainer.setVisibility(View.GONE);
        bottomBar.setVisibility(View.GONE);
        generatingText.setText("🎨 AI 正在根据「" + transcript + "」生成图片...");
        generatingProgress.setVisibility(View.VISIBLE);
    }

    private void showPreviewMode() {
        if (launcherContainer != null) {
            launcherContainer.setVisibility(View.GONE);
        }
        voiceContainer.setVisibility(View.GONE);
        generatingContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.VISIBLE);
        previewContainer.bringToFront();
        bottomBar.setVisibility(View.GONE);
        generatingProgress.setVisibility(View.GONE);
    }

    private boolean handleVoiceCommand(String text) {
        if (text == null || text.isEmpty()) return false;
        
        String lower = text.toLowerCase().trim();
        
        if (containsAny(lower, "变线稿", "线稿", "涂色线稿", "涂色")) {
            Toast.makeText(this, "🎨 切换到变线稿", Toast.LENGTH_SHORT).show();
            enterWorkspace(ContentModes.UI_COLORING);
            return true;
        }
        
        if (containsAny(lower, "变彩画", "彩画", "画画", "创作", "ai画画")) {
            Toast.makeText(this, "🖼️ 切换到变彩画", Toast.LENGTH_SHORT).show();
            enterWorkspace(ContentModes.UI_AI_CREATE);
            return true;
        }
        
        if (containsAny(lower, "安静书", "安静", "模板")) {
            Toast.makeText(this, "📖 切换到安静书", Toast.LENGTH_SHORT).show();
            enterWorkspace(ContentModes.UI_TEMPLATE);
            return true;
        }
        
        if (containsAny(lower, "相册", "小相册", "我的作品")) {
            Toast.makeText(this, "📸 切换到小相册", Toast.LENGTH_SHORT).show();
            enterWorkspace(ContentModes.UI_MY_WORKS);
            return true;
        }
        
        if (containsAny(lower, "返回", "主页", "首页", "主界面", "回到主页")) {
            Toast.makeText(this, "🏠 返回主页", Toast.LENGTH_SHORT).show();
            if (bound && daemonService != null) {
                try { daemonService.speak("已返回主页"); } catch (Exception ignored) {}
            }
            showLauncher();
            return true;
        }
        
        return false;
    }
    
    private boolean containsAny(String text, String... keywords) {
        for (String keyword : keywords) {
            if (text.contains(keyword)) {
                return true;
            }
        }
        return false;
    }
}
