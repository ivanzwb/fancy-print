package com.fancyprint.edge.cloud;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.fancyprint.edge.config.AppConfig;

import java.util.UUID;

/**
 * CloudConnectorService — 云连接管理器
 *
 * 对应 doc/2 §13.4.2 架构图中 CloudConnector 组件
 *
 * 职责：
 * - 管理与云端的 MQTT 连接（使用 Eclipse Paho）
 * - 发送设备状态、心跳
 * - 接收云端下发的打印任务、策略更新、OTA 指令
 * - HTTPS API 调用（文生图、审核状态查询）
 */
public class CloudConnectorService {

    private static final String TAG = "CloudConnectorService";
    private static final String PREFS_NAME = "device_prefs";
    private static final String KEY_DEVICE_ID = "device_id";

    private final Context context;
    private MqttClientManager mqttClient;
    private ApiClient apiClient;
    private String status = "disconnected";
    private MqttClientManager.MqttCallback externalCallback;
    /** MQTT 下行主题模板（{deviceId} 占位符替换） */
    private static final String TOPIC_PRINT_JOB = "fancy-print/{deviceId}/print/job";
    private static final String TOPIC_OTA = "fancy-print/{deviceId}/ota";
    private static final String TOPIC_POLICY = "fancy-print/{deviceId}/policy";

    private AppConfig appConfig;

    public CloudConnectorService(Context context) {
        this.context = context;
        this.apiClient = new ApiClient(context);
        this.appConfig = AppConfig.load(context);
    }

    /**
     * 连接到云端（MQTT）
     */
    public void connect(MqttClientManager.MqttCallback callback) {
        this.externalCallback = callback; // 保存用于重连
        mqttClient = new MqttClientManager(context, appConfig.getMqttBrokerUrl());
        mqttClient.connect(new MqttClientManager.MqttCallback() {
            @Override
            public void onConnected() {
                status = "connected";
                Log.i(TAG, "Cloud connected");
                subscribeToTopics(); // P1-1: 连接后订阅主题
                if (externalCallback != null) externalCallback.onConnected();
            }

            @Override
            public void onDisconnected() {
                status = "disconnected";
                Log.w(TAG, "Cloud disconnected");
                if (externalCallback != null) externalCallback.onDisconnected();
            }

            @Override
            public void onMessageReceived(String topic, String payload) {
                Log.i(TAG, "MQTT message: " + topic + " -> " + payload);
                if (externalCallback != null) externalCallback.onMessageReceived(topic, payload);
            }

            @Override
            public void onError(Exception e) {
                Log.e(TAG, "MQTT error", e);
                if (externalCallback != null) externalCallback.onError(e);
            }
        });
    }

    /**
     * 订阅云端下行主题（打印任务、OTA、策略）
     */
    private void subscribeToTopics() {
        String deviceId = getDeviceId();
        if (mqttClient == null || !mqttClient.isConnected()) return;

        String jobTopic = TOPIC_PRINT_JOB.replace("{deviceId}", deviceId);
        String otaTopic = TOPIC_OTA.replace("{deviceId}", deviceId);
        String policyTopic = TOPIC_POLICY.replace("{deviceId}", deviceId);

        mqttClient.subscribe(jobTopic);
        mqttClient.subscribe(otaTopic);
        mqttClient.subscribe(policyTopic);

        Log.i(TAG, "Subscribed to topics: " + jobTopic + ", " + otaTopic + ", " + policyTopic);
    }

    /**
     * 断开连接
     */
    public void disconnect() {
        if (mqttClient != null) {
            mqttClient.disconnect();
        }
        status = "disconnected";
        externalCallback = null; // P2-11: 防止回调泄漏
    }

    /**
     * 重连（保留已注册的外部回调）
     */
    public void reconnect() {
        disconnect();
        connect(externalCallback);
    }

    /**
     * 获取连接状态
     */
    public String getStatus() {
        return status;
    }

    /**
     * 发送设备状态
     */
    public void publishStatus(String statusJson) {
        if (mqttClient != null && mqttClient.isConnected()) {
            mqttClient.publish("fancy-print/device/status", statusJson);
        }
    }

    /**
     * 发送心跳
     */
    public void sendHeartbeat() {
        if (mqttClient != null && mqttClient.isConnected()) {
            mqttClient.publish("fancy-print/device/heartbeat",
                    "{\"timestamp\":" + System.currentTimeMillis() + "}");
        }
    }

    /**
     * 通过 HTTPS API 提交录音供 ASR
     */
    public void uploadAudio(String audioPath, ApiClient.ApiCallback callback) {
        apiClient.uploadAudio(audioPath, callback);
    }

    /**
     * 推进 pipeline 到下一阶段（供后台线程调用）
     */
    public String advanceJob(String jobId) throws java.io.IOException {
        return apiClient.advanceJobSync(jobId);
    }

    /**
     * 轮询任务状态（x-device-id 鉴权，无需 JWT）
     */
    public void fetchJobStatus(String jobId, ApiClient.ApiCallback callback) {
        apiClient.checkJobStatus(jobId, callback);
    }

    /**
     * 同步获取 job 状态（供后台线程轮询）
     */
    public String fetchJobStatusSync(String jobId) throws java.io.IOException {
        return apiClient.fetchJobStatusSync(jobId);
    }

    private SharedPreferences getSecuredPrefs() {
        try {
            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M) {
                return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            }
            androidx.security.crypto.MasterKey mk = new androidx.security.crypto.MasterKey.Builder(
                    context).setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM).build();
            return androidx.security.crypto.EncryptedSharedPreferences.create(
                    context,
                    PREFS_NAME,
                    mk,
                    androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            Log.e(TAG, "Failed to create EncryptedSharedPreferences, falling back", e);
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }
    }

    /**
     * 获取设备 ID（与 OtaManager 共享同一 key）
     */
    public String getDeviceId() {
        SharedPreferences prefs = getSecuredPrefs();
        String deviceId = prefs.getString(KEY_DEVICE_ID, null);
        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
        }
        return deviceId;
    }

    /**
     * 获取 MqttClientManager 引用（供外部直接订阅）
     */
    public MqttClientManager getMqttClient() {
        return mqttClient;
    }

    /**
     * 创建文字生图任务 — 创建 job + 提交文字 + 轮询预览
     * @deprecated Use createImageFromText instead
     */
    public void createImageJob(String transcript, String accessToken,
                               ApiClient.ApiCallback callback) {
        apiClient.createImageFromText(transcript, callback);
    }

    /**
     * 获取 API base URL（供外部拼接认证等 URL）
     */
    public String getBaseUrl() {
        return appConfig.getHttpsBaseUrl();
    }

    /**
     * 设备认证 + 文字生图全流程（auth → create job → submit text → poll preview）
     */
    public void createImageFromText(String transcript, ApiClient.ApiCallback callback) {
        apiClient.createImageFromText(transcript, callback);
    }
}
