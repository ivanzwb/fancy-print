package com.fancyprint.edge.cloud;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.fancyprint.edge.config.AppConfig;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * ApiClient — HTTPS API 客户端
 *
 * 负责端侧发起的 HTTPS 请求：
 * - 上传录音文件至 ASR 服务
 * - 查询文生图任务状态
 * - 查询审核结果
 * - OTA 更新包下载
 *
 * TODO: 实际部署时从配置加载 API base URL 和设备凭据
 */
public class ApiClient {

    private static final String TAG = "ApiClient";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    static final String PREFS_NAME = "device_prefs";
    static final String KEY_DEVICE_ID = "device_id";

    private String BASE_URL;
    private int timeoutConnect;
    private int timeoutRead;

    private final Context context;
    private final OkHttpClient httpClient;
    private final ExecutorService executor;
    private AppConfig appConfig;
    private Handler mainHandler;

    public ApiClient(Context context) {
        this.context = context;
        this.appConfig = AppConfig.load(context);
        this.BASE_URL = appConfig.getHttpsBaseUrl();
        this.timeoutConnect = appConfig.getHttpsTimeoutConnect();
        this.timeoutRead = appConfig.getHttpsTimeoutRead();
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(timeoutConnect, TimeUnit.SECONDS)
                .readTimeout(timeoutRead, TimeUnit.SECONDS)
                .writeTimeout(timeoutRead, TimeUnit.SECONDS)
                .build();
        this.executor = Executors.newSingleThreadExecutor();
        this.mainHandler = new Handler(context.getMainLooper());
    }

    /**
     * HTTP 异步回调接口
     */
    public interface ApiCallback {
        void onSuccess(String response);
        void onError(int code, String message);
    }

    private void postSuccess(ApiCallback callback, String response) {
        mainHandler.post(() -> callback.onSuccess(response));
    }

    private void postError(ApiCallback callback, int code, String message) {
        mainHandler.post(() -> callback.onError(code, message));
    }

    /**
     * 检查 OTA 更新
     */
    public void checkOtaUpdate(String deviceId, ApiCallback callback) {
        Request request = new Request.Builder()
                .url(BASE_URL + "/ota/check")
                .post(RequestBody.create(
                        "{\"deviceId\":\"" + deviceId + "\",\"currentVersion\":\"" + getAppVersion() + "\"}",
                        JSON))
                .addHeader("X-Device-ID", deviceId)
                .build();

        httpClient.newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(okhttp3.Call call, IOException e) {
                Log.e(TAG, "OTA check failed", e);
                postError(callback, 500, e.getMessage());
            }

            @Override
            public void onResponse(okhttp3.Call call, Response response) throws IOException {
                String body = response.body() != null ? response.body().string() : "";
                if (response.isSuccessful()) {
                    postSuccess(callback, body);
                } else {
                    postError(callback, response.code(), body);
                }
            }
        });
    }

    /**
     * 上传录音文件至 ASR（Base64 JSON）
     */
    public void uploadAudio(String audioPath, ApiCallback callback) {
        File audioFile = new File(audioPath);
        if (!audioFile.exists()) {
            callback.onError(400, "File not found");
            return;
        }

        try {
            String audioBase64;
            try (FileInputStream fis = new FileInputStream(audioFile);
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = fis.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
                audioBase64 = android.util.Base64.encodeToString(baos.toByteArray(),
                        android.util.Base64.NO_WRAP);
            }

            String json = "{\"audio_base64\":\"" + audioBase64 + "\"}";

            Request request = new Request.Builder()
                    .url(BASE_URL + "/asr/transcribe")
                    .post(RequestBody.create(json, JSON))
                    .addHeader("X-Device-ID", getDeviceId())
                    .build();

            httpClient.newCall(request).enqueue(new okhttp3.Callback() {
                @Override
                public void onFailure(okhttp3.Call call, IOException e) {
                    Log.e(TAG, "Upload failed", e);
                    postError(callback, 500, e.getMessage());
                }

                @Override
                public void onResponse(okhttp3.Call call, Response response) throws IOException {
                    String body = response.body() != null ? response.body().string() : "";
                    if (response.isSuccessful()) {
                        postSuccess(callback, body);
                    } else {
                        postError(callback, response.code(), body);
                    }
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Upload error", e);
            callback.onError(500, e.getMessage());
        }
    }

    /**
     * 检查打印任务审核状态
     */
    public void checkJobStatus(String jobId, ApiCallback callback) {
        Request request = new Request.Builder()
                .url(BASE_URL + "/jobs/" + jobId + "/status")
                .get()
                .addHeader("X-Device-ID", getDeviceId())
                .build();

        httpClient.newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(okhttp3.Call call, IOException e) {
                postError(callback, 500, e.getMessage());
            }

            @Override
            public void onResponse(okhttp3.Call call, Response response) throws IOException {
                String body = response.body() != null ? response.body().string() : "";
                if (response.isSuccessful()) {
                    postSuccess(callback, body);
                } else {
                    postError(callback, response.code(), body);
                }
            }
        });
    }

    /**
     * 获取任务状态（新端点，支持 x-device-id 鉴权）
     */
    public void fetchJobStatus(String jobId, ApiCallback callback) {
        Request request = new Request.Builder()
                .url(BASE_URL + "/jobs/" + jobId + "/status")
                .get()
                .addHeader("X-Device-ID", getDeviceId())
                .build();

        httpClient.newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(okhttp3.Call call, IOException e) {
                Log.e(TAG, "fetchJobStatus failed", e);
                postError(callback, 500, e.getMessage());
            }

            @Override
            public void onResponse(okhttp3.Call call, Response response) throws IOException {
                String body = response.body() != null ? response.body().string() : "";
                if (response.isSuccessful()) {
                    postSuccess(callback, body);
                } else {
                    postError(callback, response.code(), body);
                }
            }
        });
    }

    /**
     * 推进 pipeline（供后台线程轮询前调用）
     */
    public String advanceJobSync(String jobId) throws IOException {
        Request request = new Request.Builder()
                .url(BASE_URL + "/jobs/" + jobId + "/advance")
                .post(RequestBody.create(null, ""))
                .addHeader("X-Device-ID", getDeviceId())
                .build();
        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            if (response.isSuccessful()) return body;
            throw new IOException("HTTP " + response.code() + ": " + body);
        }
    }

    /**
     * 同步获取 job 状态（供后台线程轮询用）
     */
    public String fetchJobStatusSync(String jobId) throws IOException {
        Request request = new Request.Builder()
                .url(BASE_URL + "/jobs/" + jobId + "/status")
                .get()
                .addHeader("X-Device-ID", getDeviceId())
                .build();
        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            if (response.isSuccessful()) return body;
            throw new IOException("HTTP " + response.code() + ": " + body);
        }
    }

    /**
     * 下载 OTA 更新包
     */
    public void downloadOtaPackage(String downloadUrl, String outputPath) throws IOException {
        Request request = new Request.Builder()
                .url(downloadUrl)
                .get()
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Download failed: " + response.code());
            }
            byte[] data = response.body() != null ? response.body().bytes() : new byte[0];
            java.io.FileOutputStream fos = new java.io.FileOutputStream(outputPath);
            fos.write(data);
            fos.close();
            Log.i(TAG, "OTA package downloaded: " + outputPath + " (" + data.length + " bytes)");
        }
    }

    private String getAppVersion() {
        try {
            return context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0)
                    .versionName;
        } catch (Exception e) {
            return "0.0.0";
        }
    }

    /**
     * 获取设备 ID（TODO: 从安全存储或产线注入读取）
     */
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
     * 设备认证 + 文字生图一站式方法
     * 1. POST /v1/auth/device 获取 token
     * 2. POST /v1/jobs 创建 job
     * 3. POST /v1/jobs/:id/text 提交文字
     * 4. 轮询 GET /v1/jobs/:id 直到 preview_ready
     */
    public void createImageFromText(String transcript, ApiCallback callback) {
        executor.execute(() -> {
            try {
                // 1. Auth
                String authBody = "{\"device_id\":\"fancy-print-dev\",\"device_secret\":\"fancy-print-secret\"}";
                Request authReq = new Request.Builder()
                        .url(BASE_URL + "/auth/device")
                        .post(RequestBody.create(authBody, JSON))
                        .build();
                String authResp;
                try (Response resp = httpClient.newCall(authReq).execute()) {
                    authResp = resp.body() != null ? resp.body().string() : "";
                }
                String accessToken = new org.json.JSONObject(authResp).optString("access_token", "");
                if (accessToken.isEmpty()) { postError(callback, 401, "Auth failed"); return; }
                Log.i(TAG, "createImageFromText: authenticated");

                // 2. Create job
                String createBody = "{\"content_mode\":\"coloring_quiet_book\"}";
                Request createReq = new Request.Builder()
                        .url(BASE_URL + "/jobs")
                        .post(RequestBody.create(createBody, JSON))
                        .addHeader("Authorization", "Bearer " + accessToken)
                        .build();
                String createResp;
                try (Response resp = httpClient.newCall(createReq).execute()) {
                    createResp = resp.body() != null ? resp.body().string() : "";
                }
                String jobId = new org.json.JSONObject(createResp).optString("job_id", "");
                if (jobId.isEmpty()) { postError(callback, 500, "No job_id"); return; }
                Log.i(TAG, "createImageFromText: job=" + jobId);

                // 3. Submit text
                String escaped = transcript.replace("\\", "\\\\").replace("\"", "\\\"");
                String textBody = "{\"transcript\":\"" + escaped + "\"}";
                Request textReq = new Request.Builder()
                        .url(BASE_URL + "/jobs/" + jobId + "/text")
                        .post(RequestBody.create(textBody, JSON))
                        .addHeader("Authorization", "Bearer " + accessToken)
                        .build();
                try (Response resp = httpClient.newCall(textReq).execute()) {
                    if (!resp.isSuccessful()) {
                        postError(callback, resp.code(), resp.body() != null ? resp.body().string() : "");
                        return;
                    }
                }
                Log.i(TAG, "createImageFromText: text submitted, polling...");

                // 4. Poll for preview (up to 80s for real API)
                String result = pollJobUntilReady(jobId, accessToken, 40, 2000);
                if (result != null) {
                    postSuccess(callback, result);
                } else {
                    postError(callback, 504, "Timeout");
                }
            } catch (Exception e) {
                Log.e(TAG, "createImageFromText error", e);
                postError(callback, 500, e.getMessage());
            }
        });
    }

    /**
     * 轮询 job 状态直到 preview_ready 或失败
     */
    private String pollJobUntilReady(String jobId, String accessToken,
                                     int maxRetries, int intervalMs) throws Exception {
        for (int i = 0; i < maxRetries; i++) {
            Thread.sleep(intervalMs);
            Request pollReq = new Request.Builder()
                    .url(BASE_URL + "/jobs/" + jobId)
                    .get()
                    .addHeader("Authorization", "Bearer " + accessToken)
                    .build();
            String body;
            try (Response resp = httpClient.newCall(pollReq).execute()) {
                body = resp.body() != null ? resp.body().string() : "";
                if (!resp.isSuccessful()) return null;
            }
            org.json.JSONObject json = new org.json.JSONObject(body);
            String state = json.optString("state", "");
            Log.d(TAG, "pollJob[" + jobId + "] attempt=" + i + " state=" + state);
            if ("preview_ready".equals(state)) {
                // 防御性检查：确保 preview_url 已就绪再返回
                // （后端修复前曾出现过 state=preview_ready 但 preview_url 尚未写入的竞态条件）
                String previewUrl = json.optString("preview_url", "");
                if (!previewUrl.isEmpty()) {
                    return body;
                }
                Log.w(TAG, "pollJob[" + jobId + "] state=preview_ready but preview_url empty, retrying...");
                continue;
            }
            if ("failed".equals(state)) return body;
        }
        return null;
    }

    private String getDeviceId() {
        if (context == null) return "unknown-device";
        SharedPreferences prefs = getSecuredPrefs();
        String deviceId = prefs.getString(KEY_DEVICE_ID, null);
        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
        }
        return deviceId;
    }
}
