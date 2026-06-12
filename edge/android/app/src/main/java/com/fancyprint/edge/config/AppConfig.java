package com.fancyprint.edge.config;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * AppConfig — 从 res/raw/config.json 加载运行时配置
 *
 * 对应 doc/2 §13.2.3, §13.4.2: "实际部署时从配置加载"
 * 生产环境通过 assets 或远端下发更新配置，避免硬编码。
 */
public class AppConfig {

    private static final String TAG = "AppConfig";

    private String mqttBrokerUrl;
    private String httpsBaseUrl;
    private int httpsTimeoutConnect;
    private int httpsTimeoutRead;
    private int printTimeoutSec;
    private int paperWidthMm = 76;
    private int paperHeightMm = 127;
    private boolean kittenTtsEnabled = false;
    private String kittenTtsBaseUrl = "http://127.0.0.1:3003";
    private String kittenTtsSynthesizePath = "/v1/tts/kitten";
    private int kittenTtsTimeoutSec = 3;

    private AppConfig() {}

    public static AppConfig load(Context context) {
        AppConfig config = new AppConfig();
        try {
            InputStream is = context.getResources().openRawResource(
                    context.getResources().getIdentifier("config", "raw", context.getPackageName()));
            byte[] bytes = new byte[is.available()];
            int read = is.read(bytes);
            is.close();

            String json = new String(bytes, 0, read, StandardCharsets.UTF_8);
            JSONObject root = new JSONObject(json);

            // MQtt
            JSONObject mqtt = root.optJSONObject("mqtt");
            if (mqtt != null) {
                config.mqttBrokerUrl = mqtt.optString("broker_url", "tcp://mqtt.fancy-print.local:1883");
            }

            // HTTPS
            JSONObject https = root.optJSONObject("https");
            if (https != null) {
                config.httpsBaseUrl = https.optString("base_url", "https://api.fancy-print.local/v1");
                config.httpsTimeoutConnect = https.optInt("timeout_connect", 30);
                config.httpsTimeoutRead = https.optInt("timeout_read", 60);
            }

            // Print
            JSONObject print = root.optJSONObject("print");
            if (print != null) {
                config.printTimeoutSec = print.optInt("timeout_sec", 120);
                config.paperWidthMm = print.optInt("paper_width_mm", 76);
                config.paperHeightMm = print.optInt("paper_height_mm", 127);
            }

            // TTS
            JSONObject tts = root.optJSONObject("tts");
            if (tts != null) {
                config.kittenTtsEnabled = tts.optBoolean("kitten_enabled", false);
                config.kittenTtsBaseUrl = tts.optString("kitten_base_url", "http://127.0.0.1:3003");
                config.kittenTtsSynthesizePath = tts.optString("kitten_synthesize_path", "/v1/tts/kitten");
                config.kittenTtsTimeoutSec = tts.optInt("kitten_timeout_sec", 3);
            }

            Log.i(TAG, "Config loaded: mqtt=" + config.mqttBrokerUrl
                    + " https=" + config.httpsBaseUrl
                    + " kittenTtsEnabled=" + config.kittenTtsEnabled);

        } catch (Exception e) {
            Log.e(TAG, "Failed to load config, using defaults", e);
            config.mqttBrokerUrl = "tcp://mqtt.fancy-print.local:1883";
            config.httpsBaseUrl = "https://api.fancy-print.local/v1";
            config.httpsTimeoutConnect = 30;
            config.httpsTimeoutRead = 60;
            config.printTimeoutSec = 120;
            config.kittenTtsEnabled = false;
            config.kittenTtsBaseUrl = "http://127.0.0.1:3003";
            config.kittenTtsSynthesizePath = "/v1/tts/kitten";
            config.kittenTtsTimeoutSec = 3;
        }
        return config;
    }

    public String getMqttBrokerUrl() { return mqttBrokerUrl; }
    public String getHttpsBaseUrl() { return httpsBaseUrl; }
    public int getHttpsTimeoutConnect() { return httpsTimeoutConnect; }
    public int getHttpsTimeoutRead() { return httpsTimeoutRead; }
    public int getPrintTimeoutSec() { return printTimeoutSec; }
    public int getPaperWidthMm() { return paperWidthMm; }
    public int getPaperHeightMm() { return paperHeightMm; }
    public boolean isKittenTtsEnabled() { return kittenTtsEnabled; }
    public String getKittenTtsBaseUrl() { return kittenTtsBaseUrl; }
    public String getKittenTtsSynthesizePath() { return kittenTtsSynthesizePath; }
    public int getKittenTtsTimeoutSec() { return kittenTtsTimeoutSec; }
}
