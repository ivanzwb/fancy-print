package com.fancyprint.edge.audio;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import com.fancyprint.edge.config.AppConfig;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * KittenTtsClient - 本地 Kitten TTS HTTP 客户端（离线部署在设备本机）
 */
public class KittenTtsClient {
    private static final String TAG = "KittenTtsClient";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final String CACHE_DIR = "tts_cache";

    private final boolean enabled;
    private final String synthUrl;
    private final OkHttpClient httpClient;
    private final File cacheDir;

    public KittenTtsClient(Context context, AppConfig config) {
        this.enabled = config.isKittenTtsEnabled();
        this.synthUrl = trimSlash(config.getKittenTtsBaseUrl()) + ensureSlash(config.getKittenTtsSynthesizePath());
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(config.getKittenTtsTimeoutSec(), TimeUnit.SECONDS)
                .readTimeout(config.getKittenTtsTimeoutSec(), TimeUnit.SECONDS)
                .build();
        this.cacheDir = new File(context.getFilesDir(), CACHE_DIR);
        if (!cacheDir.exists()) {
            cacheDir.mkdirs();
        }
    }

    public boolean isEnabled() {
        return enabled;
    }

    /**
     * 调用本地 Kitten TTS，返回合成出的 wav 文件；失败返回 null。
     */
    public File synthesizeToWav(String text) {
        if (!enabled || text == null || text.trim().isEmpty()) {
            return null;
        }
        try {
            JSONObject bodyJson = new JSONObject();
            bodyJson.put("text", text);
            bodyJson.put("format", "wav");

            Request request = new Request.Builder()
                    .url(synthUrl)
                    .post(RequestBody.create(bodyJson.toString(), JSON))
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null) {
                    Log.w(TAG, "Kitten TTS request failed: " + response.code());
                    return null;
                }

                byte[] bytes = response.body().bytes();
                String contentType = response.header("Content-Type", "");
                byte[] wavBytes = parseResponseAudio(bytes, contentType);
                if (wavBytes == null || wavBytes.length == 0) {
                    Log.w(TAG, "Kitten TTS returned empty audio");
                    return null;
                }

                File wavFile = new File(cacheDir, "kitten_" + System.currentTimeMillis() + ".wav");
                try (FileOutputStream fos = new FileOutputStream(wavFile)) {
                    fos.write(wavBytes);
                }
                cleanupOldCache();
                return wavFile;
            }
        } catch (Exception e) {
            Log.w(TAG, "Kitten TTS synthesize failed: " + e.getMessage());
            return null;
        }
    }

    private byte[] parseResponseAudio(byte[] bytes, String contentType) {
        try {
            if (contentType != null && (contentType.contains("audio/wav") || contentType.contains("audio/x-wav"))) {
                return bytes;
            }
            String bodyText = new String(bytes, StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(bodyText);
            String audioBase64 = json.optString("audio_base64", "");
            if (audioBase64.isEmpty()) {
                return null;
            }
            return Base64.decode(audioBase64, Base64.DEFAULT);
        } catch (Exception e) {
            // 不是 JSON 时按原始音频兜底
            if (bytes != null && bytes.length > 44) {
                return bytes;
            }
            return null;
        }
    }

    private void cleanupOldCache() {
        File[] files = cacheDir.listFiles();
        if (files == null || files.length <= 20) return;
        java.util.Arrays.sort(files, java.util.Comparator.comparingLong(File::lastModified));
        int toDelete = files.length - 20;
        for (int i = 0; i < toDelete; i++) {
            try {
                files[i].delete();
            } catch (Exception ignored) {}
        }
    }

    private static String trimSlash(String value) {
        if (value == null || value.isEmpty()) return "";
        if (value.endsWith("/")) return value.substring(0, value.length() - 1);
        return value;
    }

    private static String ensureSlash(String value) {
        if (value == null || value.isEmpty()) return "/v1/tts/kitten";
        return value.startsWith("/") ? value : "/" + value;
    }
}
