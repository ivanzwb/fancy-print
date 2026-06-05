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
            }

            Log.i(TAG, "Config loaded: mqtt=" + config.mqttBrokerUrl
                    + " https=" + config.httpsBaseUrl);

        } catch (Exception e) {
            Log.e(TAG, "Failed to load config, using defaults", e);
            config.mqttBrokerUrl = "tcp://mqtt.fancy-print.local:1883";
            config.httpsBaseUrl = "https://api.fancy-print.local/v1";
            config.httpsTimeoutConnect = 30;
            config.httpsTimeoutRead = 60;
            config.printTimeoutSec = 120;
        }
        return config;
    }

    public String getMqttBrokerUrl() { return mqttBrokerUrl; }
    public String getHttpsBaseUrl() { return httpsBaseUrl; }
    public int getHttpsTimeoutConnect() { return httpsTimeoutConnect; }
    public int getHttpsTimeoutRead() { return httpsTimeoutRead; }
    public int getPrintTimeoutSec() { return printTimeoutSec; }
}
