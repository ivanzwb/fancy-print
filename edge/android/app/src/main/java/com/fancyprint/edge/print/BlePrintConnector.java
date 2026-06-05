package com.fancyprint.edge.print;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.util.Log;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * BlePrintConnector — 蓝牙（SPP/BLE）打印连接器
 *
 * 对应 doc/2 §13.2.2 ZINK 打印的三条路径 — 蓝牙 + 厂商 SDK
 *
 * 使用蓝牙 SPP（Serial Port Profile）连接 ZINK 蓝牙打印机，
 * 适用于口袋 ZINK 打印机（如 HPRT、Phomemo 等）以及厂商 SDK 封装。
 *
 * NOTE: 对于厂商提供专有 AAR SDK 的情况，应替换本类的 print() 为 SDK 调用。
 */
public class BlePrintConnector {

    private static final String TAG = "BlePrintConnector";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final Context context;
    private final BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket socket;
    private OutputStream outputStream;

    public interface ScanCallback {
        void onDeviceFound(BluetoothDevice device);
        void onScanFinished(List<BluetoothDevice> devices);
    }

    public BlePrintConnector(Context context) {
        this.context = context;
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
    }

    /**
     * 获取所有已配对的蓝牙设备（不按名称过滤，由调用方根据 vendor ID 或特性判断）
     */
    public List<BluetoothDevice> getPairedPrinters() {
        List<BluetoothDevice> printers = new ArrayList<>();
        if (bluetoothAdapter == null) return printers;

        Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
        if (pairedDevices == null) return printers;

        printers.addAll(pairedDevices);
        Log.i(TAG, "Found " + printers.size() + " bonded devices");
        return printers;
    }

    /**
     * 连接蓝牙打印机（SPP）
     */
    public boolean connect(BluetoothDevice device) {
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            outputStream = socket.getOutputStream();
            Log.i(TAG, "Connected to BT printer: " + device.getName());
            return true;
        } catch (IOException e) {
            Log.e(TAG, "BT connect failed", e);
            // 尝试 fallback 方法
            try {
                socket = (BluetoothSocket) device.getClass()
                        .getMethod("createRfcommSocket", int.class)
                        .invoke(device, 1);
                socket.connect();
                outputStream = socket.getOutputStream();
                Log.i(TAG, "Connected via fallback");
                return true;
            } catch (Exception e2) {
                Log.e(TAG, "BT connect fallback also failed", e2);
                return false;
            }
        }
    }

    /**
     * 发送打印数据（经蓝牙 SPP）
     */
    public boolean print(byte[] data) {
        if (outputStream == null) {
            Log.e(TAG, "Not connected");
            return false;
        }

        try {
            outputStream.write(data);
            outputStream.flush();
            Log.i(TAG, "BT print data sent: " + data.length + " bytes");
            return true;
        } catch (IOException e) {
            Log.e(TAG, "BT print error", e);
            return false;
        }
    }

    /**
     * 断开连接
     */
    public void disconnect() {
        try {
            if (outputStream != null) {
                outputStream.close();
            }
            if (socket != null) {
                socket.close();
            }
        } catch (IOException e) {
            Log.e(TAG, "BT disconnect error", e);
        }
        outputStream = null;
        socket = null;
        Log.i(TAG, "BT printer disconnected");
    }
}
