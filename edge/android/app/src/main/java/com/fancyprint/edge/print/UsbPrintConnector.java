package com.fancyprint.edge.print;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.util.Log;

import java.io.IOException;

/**
 * UsbPrintConnector — USB 打印连接器
 *
 * 对应 doc/2 §13.2.2 ZINK 打印的三条路径 — USB 打印类
 *
 * 通过 Android USB Host API 连接 ZINK 打印机（USB Printer Class），
 * 发送光栅化位图数据。适用于实现了 IEEE 1284 / USB Printer Class 的机芯。
 */
public class UsbPrintConnector {

    private static final String TAG = "UsbPrintConnector";
    private static final int USB_ENDPOINT_XFER_BULK = 2;
    private static final int USB_DIR_OUT = 0;
    private static final String ACTION_USB_PERMISSION = "com.fancyprint.edge.USB_PERMISSION";
    private static final int USB_TIMEOUT_MS = 5000;
    
    /** CPCL 模式切换命令（ESC/POS → CPCL） */
    private static final byte[] CPCL_SWITCH_CMD = new byte[]{0x1d, 0x49, 0x60, 0x01};

    private final Context context;
    private final UsbManager usbManager;
    private UsbDeviceConnection connection;
    private UsbEndpoint outEndpoint;

    /**
     * 检查 USB 设备是否已有权限
     */
    public boolean hasPermission(UsbDevice device) {
        return usbManager.hasPermission(device);
    }

    public interface UsbPermissionCallback {
        void onPermissionGranted(UsbDevice device);
        void onPermissionDenied(UsbDevice device);
    }

    public UsbPrintConnector(Context context) {
        this.context = context;
        this.usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
    }

    /**
     * 查找第一个 USB 打印机并请求权限
     */
    public UsbDevice findPrinter() {
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            // Printer Class (7) 或 Vendor 特定
            if (device.getDeviceClass() == 7 || hasPrinterInterface(device)) {
                Log.i(TAG, "Found printer: " + device.getProductName()
                        + " vendor=" + device.getVendorId()
                        + " product=" + device.getProductId());
                return device;
            }
        }
        Log.w(TAG, "No USB printer found");
        return null;
    }

    /**
     * 请求 USB 权限
     */
    public void requestPermission(UsbDevice device, UsbPermissionCallback callback) {
        if (usbManager.hasPermission(device)) {
            callback.onPermissionGranted(device);
            return;
        }

        BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                context.unregisterReceiver(this);
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    callback.onPermissionGranted(device);
                } else {
                    callback.onPermissionDenied(device);
                }
            }
        };

        context.registerReceiver(permissionReceiver,
                new IntentFilter(ACTION_USB_PERMISSION));

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, 0, new Intent(ACTION_USB_PERMISSION),
                PendingIntent.FLAG_IMMUTABLE);

        usbManager.requestPermission(device, pendingIntent);
    }

    /**
     * 打开 USB 打印机连接
     */
    public boolean connect(UsbDevice device) {
        UsbInterface intf = findPrintInterface(device);
        if (intf == null) {
            Log.e(TAG, "No print interface found");
            return false;
        }

        connection = usbManager.openDevice(device);
        if (connection == null) {
            Log.e(TAG, "Failed to open USB device");
            return false;
        }

        if (!connection.claimInterface(intf, true)) {
            Log.e(TAG, "Failed to claim interface");
            connection.close();
            connection = null;
            return false;
        }

        // 找到批量输出端点
        for (int i = 0; i < intf.getEndpointCount(); i++) {
            UsbEndpoint ep = intf.getEndpoint(i);
            if (ep.getType() == USB_ENDPOINT_XFER_BULK && ep.getDirection() == USB_DIR_OUT) {
                outEndpoint = ep;
                break;
            }
        }

        if (outEndpoint == null) {
            Log.e(TAG, "No bulk OUT endpoint found");
            connection.close();
            connection = null;
            return false;
        }

        // 切换到 CPCL 模式
        try {
            int sent = connection.bulkTransfer(outEndpoint, CPCL_SWITCH_CMD, CPCL_SWITCH_CMD.length, USB_TIMEOUT_MS);
            if (sent < 0) {
                Log.w(TAG, "CPCL switch command failed, but continuing anyway");
            } else {
                Log.i(TAG, "CPCL mode switch sent (" + sent + " bytes)");
                Thread.sleep(300);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        Log.i(TAG, "USB printer connected: " + device.getProductName());
        return true;
    }

    /**
     * 发送打印数据
     * @param data 打印位图数据（光栅化后）
     */
    public boolean print(byte[] data) {
        if (connection == null || outEndpoint == null) {
            Log.e(TAG, "Not connected");
            return false;
        }

        try {
            int offset = 0;
            int chunkSize = outEndpoint.getMaxPacketSize() * 16;
            while (offset < data.length) {
                int len = Math.min(chunkSize, data.length - offset);
                int written = connection.bulkTransfer(outEndpoint, data, offset, len, USB_TIMEOUT_MS);
                if (written < 0) {
                    Log.e(TAG, "USB write failed at offset " + offset);
                    return false;
                }
                offset += written;
            }
            Log.i(TAG, "USB print data sent: " + offset + " bytes");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "USB print error", e);
            return false;
        }
    }

    public boolean isConnected() {
        return connection != null;
    }

    /**
     * 断开连接
     */
    public void disconnect() {
        if (connection != null) {
            connection.close();
            connection = null;
        }
        outEndpoint = null;
        Log.i(TAG, "USB printer disconnected");
    }

    // ============================================================
    // 辅助方法
    // ============================================================

    private boolean hasPrinterInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            // Printer Class (7) 或 Vendor Specific (255)
            if (intf.getInterfaceClass() == 7 || intf.getInterfaceClass() == 255) {
                return true;
            }
        }
        return false;
    }

    private UsbInterface findPrintInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            if (intf.getInterfaceClass() == 7 || intf.getInterfaceClass() == 255) {
                return intf;
            }
        }
        return null;
    }
}
