package com.fancyprint.edge.service;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;
import android.os.RemoteCallbackList;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.fancyprint.edge.FancyPrintApplication;
import com.fancyprint.edge.IAsrCallback;
import com.fancyprint.edge.IEdgeDaemonService;
import com.fancyprint.edge.IPrintJobCallback;
import com.fancyprint.edge.R;
import com.fancyprint.edge.asr.SherpaAsrService;
import com.fancyprint.edge.audio.AudioController;
import com.fancyprint.edge.cloud.ApiClient;
import com.fancyprint.edge.cloud.CloudConnectorService;
import com.fancyprint.edge.ota.OtaManager;
import com.fancyprint.edge.print.PrintJobManager;
import com.fancyprint.edge.security.ParentalLockManager;
import com.fancyprint.edge.storage.JobDatabase;

import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.IOException;

/**
 * EdgeDaemonService — 端侧常驻前台服务
 *
 * 对应 doc/2 §13.4.2 Android 端 "edge-daemon" 服务架构
 *
 * 职责：
 * - 打印任务队列管理（USB/蓝牙 ZINK 打印）
 * - 音频控制（PTT 录音、TTS 播放）
 * - 云连接（MQTT/HTTPS）
 * - 离线任务 persistence
 * - 家长锁校验
 * - 健康监控
 */
public class EdgeDaemonService extends Service {

    private static final String TAG = "EdgeDaemonService";
    private static final int NOTIFICATION_ID = 1001;

    private final Binder binder = new DaemonBinder();
    private final RemoteCallbackList<IPrintJobCallback> callbacks = new RemoteCallbackList<>();

    private ExecutorService executor;
    private PrintJobManager printJobManager;
    private AudioController audioController;
    private ParentalLockManager parentalLockManager;
    private CloudConnectorService cloudConnector;
    private SherpaAsrService sherpaAsr;
    private OtaManager otaManager;
    private HealthMonitorService healthMonitor;
    private JobDatabase jobDatabase;

    // ============================================================
    // Service 生命周期
    // ============================================================

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "onCreate");
        executor = Executors.newSingleThreadExecutor();

        jobDatabase = JobDatabase.getInstance(this);

        printJobManager = new PrintJobManager(this, jobDatabase, callbacks);
        audioController = new AudioController(this);
        parentalLockManager = new ParentalLockManager(this);
        cloudConnector = new CloudConnectorService(this);
        sherpaAsr = new SherpaAsrService(this);
        otaManager = new OtaManager(this);
        healthMonitor = new HealthMonitorService(this);
        healthMonitor.init(this);

        // 连接云端 MQTT
        cloudConnector.connect(new com.fancyprint.edge.cloud.MqttClientManager.MqttCallback() {
            @Override
            public void onConnected() {
                Log.i(TAG, "Cloud connected");
                broadcastConnectionStatus("connected");
                // Heartbeat is handled by EdgeDaemonService's own AlarmManager alarms
            }

            @Override
            public void onDisconnected() {
                Log.w(TAG, "Cloud disconnected");
                broadcastConnectionStatus("disconnected");
            }

            @Override
            public void onMessageReceived(String topic, String payload) {
                Log.i(TAG, "Cloud message: " + topic + " -> " + payload);
                handleCloudMessage(topic, payload);
            }

            @Override
            public void onError(Exception e) {
                Log.e(TAG, "Cloud connection error", e);
            }
        });

        // startForeground 移至 onStartCommand（Android 14+ 要求）
    }

    public static final String ACTION_HEARTBEAT = "com.fancyprint.edge.HEARTBEAT";
    public static final String ACTION_HEALTH_HEARTBEAT = "com.fancyprint.edge.HEALTH_HEARTBEAT";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Android 14+ 前台服务验证：startForeground 必须在 onStartCommand 中调用
        startForeground(NOTIFICATION_ID, buildNotification());
        Log.i(TAG, "EdgeDaemonService started in foreground");

        String action = intent != null ? intent.getAction() : null;
        Log.i(TAG, "onStartCommand: " + (action != null ? action : "restart"));
        if (ACTION_HEARTBEAT.equals(action)) {
            Log.i(TAG, "Heartbeat alarm triggered, sending heartbeat");
            cloudConnector.sendHeartbeat();
        } else if (ACTION_HEALTH_HEARTBEAT.equals(action)) {
            String healthJson = healthMonitor.getHealthJson();
            Log.i(TAG, "Health heartbeat: " + healthJson);
            cloudConnector.publishStatus(healthJson);
        }
        // P2-2：从 PrintJobService（JobScheduler）启动时，触发队列重试
        if (action == null) {
            Log.i(TAG, "Start intent from PrintJobService, triggering queue retry");
        }
        // START_STICKY 确保服务被杀死后自动重启
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy");
        callbacks.kill();
        audioController.release();
        if (printJobManager != null) {
            printJobManager.release();
        }
        if (healthMonitor != null) {
            healthMonitor.cleanup();
        }
        cloudConnector.disconnect();
        executor.shutdown();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    // ============================================================
    // 通知
    // ============================================================

    private Notification buildNotification() {
        Intent mainIntent = new Intent(this, com.fancyprint.edge.ui.MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, mainIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, FancyPrintApplication.CHANNEL_DAEMON)
                .setContentTitle(getString(R.string.notification_daemon_title))
                .setContentText(getString(R.string.notification_daemon_text))
                .setSmallIcon(com.fancyprint.edge.R.drawable.ic_launcher_foreground)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    // ============================================================
    // MQTT 消息处理
    // ============================================================

    /**
     * 处理云端 MQTT 下行消息（P1-2）
     */
    private void handleCloudMessage(String topic, String payload) {
        try {
            if (topic.contains("/print/job")) {
                JSONObject json = new JSONObject(payload);
                String jobId = json.optString("jobId", UUID.randomUUID().toString());
                String imageUrl = json.optString("imageUrl", "");
                String mode = json.optString("mode", "color");
                String contentMode = json.optString("contentMode", "coloring");
                int timeout = json.optInt("timeoutSec", 120);

                // 创建 pending_confirm job
                boolean ok = printJobManager.submitJob(jobId, imageUrl, mode, contentMode, timeout);
                if (ok) {
                    Log.i(TAG, "Cloud print job received: " + jobId);
                    // 通知 UI 有新打印任务待确认
                    for (int i = 0; i < callbacks.beginBroadcast(); i++) {
                        try {
                            callbacks.getBroadcastItem(i).onPrintJobStatusChanged(
                                    jobId, "pending_confirm", 0, "有新打印任务");
                        } catch (Exception e) {
                            Log.e(TAG, "callback error", e);
                        }
                    }
                    callbacks.finishBroadcast();
                }
            } else if (topic.contains("/ota")) {
                Log.i(TAG, "OTA command received, checking for update");
                otaManager.checkForUpdate();
            } else if (topic.contains("/policy")) {
                Log.i(TAG, "Policy update received: " + payload);
            }
        } catch (Exception e) {
            Log.e(TAG, "handleCloudMessage error", e);
        }
    }

    /**
     * 广播连接状态变更到 UI
     */
    private void broadcastConnectionStatus(String connectionStatus) {
        int n = callbacks.beginBroadcast();
        for (int i = 0; i < n; i++) {
            try {
                callbacks.getBroadcastItem(i).onConnectionStatusChanged(connectionStatus);
            } catch (Exception e) {
                Log.e(TAG, "broadcast connection status error", e);
            }
        }
        callbacks.finishBroadcast();
    }

    /**
     * 后台轮询 job 状态：ASR → 文生图 → preview_ready → submitPrintJob
     * 每 3 秒轮询一次，最多 120 秒超时。先调用 advance 推进 pipeline。
     */
    private void pollJobForPreview(String jobId) {
        executor.execute(() -> {
            // 先推进 pipeline：ASR → 文本审核 → 生图与成图审核 → 预览
            try {
                cloudConnector.advanceJob(jobId);
            } catch (Exception e) {
                Log.w(TAG, "pollJob[" + jobId + "] advanceJob failed: " + e.getMessage());
            }
            for (int i = 0; i < 40; i++) {
                try {
                    Thread.sleep(3000);
                    String resp = cloudConnector.fetchJobStatusSync(jobId);
                    JSONObject json = new JSONObject(resp);
                    String state = json.optString("state", "");
                    Log.d(TAG, "pollJob[" + jobId + "] attempt=" + i + " state=" + state);
                    if ("preview_ready".equals(state)) {
                        String previewUrl = json.optString("preview_url", "");
                        String contentMode = json.optString("content_mode", "coloring");
                        if (!previewUrl.isEmpty()) {
                            printJobManager.submitJob(jobId, previewUrl, "color", contentMode, 120);
                            Log.i(TAG, "ASR -> preview: submitted job " + jobId);
                        }
                        return;
                    }
                    if ("failed".equals(state)) {
                        Log.w(TAG, "pollJob[" + jobId + "] failed: " + json.optString("error_code", ""));
                        return;
                    }
                } catch (InterruptedException e) {
                    return;
                } catch (IOException e) {
                    Log.w(TAG, "pollJob network error attempt=" + i + " " + e.getMessage());
                } catch (Exception e) {
                    Log.w(TAG, "pollJob parse error attempt=" + i, e);
                }
            }
            Log.w(TAG, "pollJob timeout for jobId=" + jobId + " (max attempts reached)");
        });
    }

    /**
     * 本地 ASR 成功后，提交文字到云端生图管道，预览 URL 通过 callback 返回
     */
    private void submitTextToCloud(String text, IAsrCallback callback) {
        executor.execute(() -> {
            cloudConnector.createImageFromText(text, new ApiClient.ApiCallback() {
                    @Override
                    public void onSuccess(String response) {
                        try {
                            String previewUrl = new org.json.JSONObject(response).optString("preview_url", "");
                            Log.i(TAG, "submitTextToCloud: preview ready, len=" + previewUrl.length());
                            try {
                                callback.onImageReady(previewUrl);
                                Log.i(TAG, "submitTextToCloud: onImageReady called OK");
                            } catch (Exception e) {
                                Log.e(TAG, "submitTextToCloud: onImageReady FAILED", e);
                            }
                        } catch (org.json.JSONException e) {
                            Log.e(TAG, "submitTextToCloud parse error", e);
                        }
                    }
                @Override
                public void onError(int code, String message) {
                    Log.w(TAG, "submitTextToCloud: error " + code + " " + message);
                    try { callback.onError(code, message); } catch (Exception ignored) {}
                }
            });
        });
    }

    // ============================================================
    // Binder — AIDL 实现
    // ============================================================

    private class DaemonBinder extends IEdgeDaemonService.Stub {

        // ---- 打印 ----

        @Override
        public boolean submitPrintJob(String jobId, String imageUrl, String mode, String contentMode, int timeoutSec) {
            return printJobManager.submitJob(jobId, imageUrl, mode, contentMode, timeoutSec);
        }

        @Override
        public boolean confirmPrintJob(String jobId) {
            return printJobManager.confirmJob(jobId);
        }

        @Override
        public boolean cancelPrintJob(String jobId) {
            return printJobManager.cancelJob(jobId);
        }

        @Override
        public String getPrintJobStatus(String jobId) {
            return printJobManager.getJobStatus(jobId);
        }

        @Override
        public String getPrintQueue() {
            return printJobManager.getQueueJson();
        }

        // ---- 音频 ----

        @Override
        public boolean startRecording() {
            return audioController.startRecording();
        }

        @Override
        public String stopRecording() {
            return audioController.stopRecording();
        }

        @Override
        public void playAudio(String filePath, float volume) {
            audioController.playAudio(filePath, volume);
        }

        @Override
        public void stopAudio() {
            audioController.stopAudio();
        }

        @Override
        public void speak(String text) {
            audioController.speak(text);
        }

        // ---- PCM 录制（本地离线 ASR） ----

        @Override
        public String startPcmRecording() {
            return audioController.startPcmRecording();
        }

        @Override
        public String stopPcmRecording() {
            return audioController.stopPcmRecording();
        }

        // ---- ASR 语音识别 ----

        @Override
        public void transcribeAudio(String audioPath, IAsrCallback callback) {
            // 如果是 PCM 文件，优先尝试本地 Sherpa-ONNX 离线 ASR
            if (sherpaAsr != null && audioPath != null && audioPath.endsWith(".pcm")) {
                // 确保模型已加载（懒加载）
                if (!sherpaAsr.isLoaded()) {
                    Log.i(TAG, "Lazy-loading Sherpa-ONNX model");
                    sherpaAsr.loadModel();
                }
                if (sherpaAsr.isLoaded()) {
                    String text = sherpaAsr.transcribePcmFile(audioPath);
                    if (text != null && !text.isEmpty()) {
                        Log.i(TAG, "transcribe: local ASR success, text=\"" + text + "\"");
                        try { callback.onSuccess(text); } catch (Exception ignored) {}

                        // 本地 ASR 成功 → 提交文字到云端生图
                        submitTextToCloud(text, callback);
                        return;
                    }
                }
                Log.w(TAG, "Local ASR failed or returned empty, falling back to cloud ASR");
            }
            // Fallback: cloud ASR
            cloudConnector.uploadAudio(audioPath, new ApiClient.ApiCallback() {
                @Override
                public void onSuccess(String response) {
                    try {
                        org.json.JSONObject json = new org.json.JSONObject(response);
                        String text = json.optString("text", response);
                        String jobId = json.optString("job_id", null);
                        Log.i(TAG, "transcribe: text=\"" + text + "\" jobId=" + jobId);
                        callback.onSuccess(text);
                        // 有 job_id → 后台轮询等待生图完成
                        if (jobId != null && !jobId.isEmpty()) {
                            pollJobForPreview(jobId);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "transcribe: parse error", e);
                        try { callback.onError(500, "识别结果解析失败"); } catch (Exception ignored) {}
                    }
                }
                @Override
                public void onError(int code, String message) {
                    Log.e(TAG, "transcribe: upload error " + code + " " + message);
                    try { callback.onError(code, message); } catch (Exception ignored) {}
                }
            });
        }

        // ---- 云连接 ----

        @Override
        public String getConnectionStatus() {
            return cloudConnector.getStatus();
        }

        @Override
        public void reconnectCloud() {
            cloudConnector.reconnect();
        }

        // ---- 家长锁 ----

        @Override
        public boolean validateParentPin(String pin) {
            return parentalLockManager.validatePin(pin);
        }

        @Override
        public boolean setParentPin(String oldPin, String newPin) {
            return parentalLockManager.setPin(oldPin, newPin);
        }

        @Override
        public boolean isParentLockEnabled() {
            return parentalLockManager.isEnabled();
        }

        @Override
        public void setParentLockEnabled(boolean enabled) {
            parentalLockManager.setEnabled(enabled);
        }

        // ---- 系统 ----

        @Override
        public String getDeviceInfo() {
            try {
                JSONObject info = new JSONObject();
                info.put("deviceId", otaManager.getDeviceId());
                info.put("fwVersion", otaManager.getCurrentVersion());
                info.put("health", new org.json.JSONObject(healthMonitor.getHealthJson()));
                return info.toString();
            } catch (Exception e) {
                Log.e(TAG, "getDeviceInfo error", e);
                return "{}";
            }
        }

        @Override
        public void checkForUpdate() {
            otaManager.checkForUpdate();
        }

        @Override
        public boolean factoryReset() {
            executor.execute(() -> {
                // 1. 清除 PIN / 家长锁
                parentalLockManager.reset();

                // 2. 清除所有打印任务
                jobDatabase.printJobDao().deleteAll();

                // 3. 清除 OTA 缓存
                // (SharedPreferences 由各管理器自行清除)

                Log.i(TAG, "Factory reset completed");
            });
            return true;
        }

        @Override
        public void rebootDevice() {
            executor.execute(() -> {
                try {
                    Thread.sleep(1000);
                    Runtime.getRuntime().exec("su -c reboot");
                } catch (Exception e) {
                    Log.e(TAG, "reboot failed", e);
                }
            });
        }

        // ---- 回调注册 ----

        @Override
        public void registerPrintCallback(IPrintJobCallback callback) {
            callbacks.register(callback);
        }

        @Override
        public void unregisterPrintCallback(IPrintJobCallback callback) {
            callbacks.unregister(callback);
        }
    }
}
