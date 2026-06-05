package com.fancyprint.edge.cloud;

import android.content.Context;
import android.util.Log;

import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.IMqttToken;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * MqttClientManager — MQTT 连接管理器
 *
 * 使用 Eclipse Paho 客户端实现与云端 MQTT broker 的连接。
 *
 * TODO: 实际部署时从配置加载 broker URL、设备证书
 */
public class MqttClientManager {

    private static final String TAG = "MqttClientManager";

    private String BROKER_URL;
    private int QOS = 1;

    private final Context context;
    private MqttClient client;
    private MqttConnectOptions options;
    private MqttCallback callback;
    private final Set<String> subscribedTopics = new LinkedHashSet<>();

    public interface MqttCallback {
        void onConnected();
        void onDisconnected();
        void onMessageReceived(String topic, String payload);
        void onError(Exception e);
    }

    public MqttClientManager(Context context, String brokerUrl) {
        this.context = context;
        this.BROKER_URL = brokerUrl;
    }

    /**
     * 连接到 MQTT Broker
     */
    public void connect(MqttCallback callback) {
        this.callback = callback;

        try {
            String clientId = "fancy-print-" + UUID.randomUUID().toString().substring(0, 8);
            client = new MqttClient(BROKER_URL, clientId, new MemoryPersistence());

            options = new MqttConnectOptions();
            options.setAutomaticReconnect(true);
            options.setCleanSession(true);
            options.setConnectionTimeout(30);
            options.setKeepAliveInterval(60);
            // TODO: 设置 TLS 和设备证书
            // options.setSocketFactory(sslContext.getSocketFactory());

            client.setCallback(new MqttCallbackExtended() {
                @Override
                public void connectComplete(boolean reconnect, String serverURI) {
                    Log.i(TAG, "connectComplete reconnect=" + reconnect + " serverURI=" + serverURI);
                    if (reconnect) {
                        // P2-1：断线自动重连后重新订阅所有主题
                        resubscribeAll();
                    }
                    if (MqttClientManager.this.callback != null) {
                        MqttClientManager.this.callback.onConnected();
                    }
                }

                @Override
                public void connectionLost(Throwable cause) {
                    Log.e(TAG, "Connection lost", cause);
                    if (MqttClientManager.this.callback != null) {
                        MqttClientManager.this.callback.onDisconnected();
                    }
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    String payload = new String(message.getPayload());
                    Log.i(TAG, "Message arrived: " + topic);
                    if (MqttClientManager.this.callback != null) {
                        MqttClientManager.this.callback.onMessageReceived(topic, payload);
                    }
                }

                @Override
                public void deliveryComplete(IMqttDeliveryToken token) {
                    // QoS 1/2 投递完成
                }
            });

            client.connect(options);
            Log.i(TAG, "Connected to MQTT broker: " + BROKER_URL);
            // onConnected is fired by MqttCallbackExtended.connectComplete — do NOT double-fire

        } catch (MqttException e) {
            Log.e(TAG, "MQTT connect failed", e);
            if (callback != null) {
                callback.onError(e);
            }
        }
    }

    /**
     * 订阅主题
     */
    public void subscribe(String topic) {
        subscribedTopics.add(topic);
        if (client != null && client.isConnected()) {
            doSubscribe(topic);
        }
    }

    private void doSubscribe(String topic) {
        try {
            client.subscribe(topic, QOS);
            Log.i(TAG, "Subscribed to: " + topic);
        } catch (MqttException e) {
            Log.e(TAG, "Subscribe failed: " + topic, e);
        }
    }

    /**
     * P2-1：断线重连后重新订阅所有已注册的主题
     */
    private void resubscribeAll() {
        Log.i(TAG, "Re-subscribing " + subscribedTopics.size() + " topics after reconnect");
        for (String topic : subscribedTopics) {
            doSubscribe(topic);
        }
    }

    /**
     * 发布消息
     */
    public void publish(String topic, String payload) {
        if (client != null && client.isConnected()) {
            try {
                MqttMessage message = new MqttMessage(payload.getBytes());
                message.setQos(QOS);
                client.publish(topic, message);
                Log.d(TAG, "Published to: " + topic);
            } catch (MqttException e) {
                Log.e(TAG, "Publish failed: " + topic, e);
            }
        }
    }

    /**
     * 断开连接
     */
    public void disconnect() {
        if (client != null && client.isConnected()) {
            try {
                client.disconnect();
                client.close();
                Log.i(TAG, "Disconnected from MQTT broker");
            } catch (MqttException e) {
                Log.e(TAG, "Disconnect error", e);
            }
        }
    }

    /**
     * 是否已连接
     */
    public boolean isConnected() {
        return client != null && client.isConnected();
    }
}
