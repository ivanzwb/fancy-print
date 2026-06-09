package com.fancyprint.edge.ota;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.fancyprint.edge.FancyPrintApplication;
import com.fancyprint.edge.R;
import com.fancyprint.edge.cloud.ApiClient;

import org.json.JSONObject;

import java.io.File;

/**
 * OtaManager — OTA 更新管理器
 *
 * 对应 doc/2 §13.5.1 OTA 方案（Android 无 Google 服务场景）
 *
 * 职责：
 * - 从云端检查新版本
 * - 下载 OTA 更新包（APK 全量包）
 * - 校验签名
 * - 调用 PackageInstaller 安装
 *
 * 当前为骨架实现，实际部署需填充 OTA 服务器 URL 和签名校验逻辑。
 */
public class OtaManager {

    private static final String TAG = "OtaManager";
    private static final String PREFS_NAME = "ota_prefs";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_CURRENT_VERSION = "current_version";
    private static final String OTA_DIR = "ota_packages";

    private final Context context;
    private final ApiClient apiClient;
    private final File otaDir;

    public OtaManager(Context context) {
        this.context = context;
        this.apiClient = new ApiClient(context);
        this.otaDir = new File(context.getFilesDir(), OTA_DIR);
        if (!otaDir.exists()) {
            otaDir.mkdirs();
        }
    }

    /**
     * 获取当前固件版本（从 PackageManager 读取）
     */
    public String getCurrentVersion() {
        try {
            return context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0)
                    .versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "0.0.0";
        }
    }

    /**
     * 获取设备 ID（与 CloudConnectorService/ApiClient 共用 EncryptedSharedPreferences）
     */
    public String getDeviceId() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                androidx.security.crypto.MasterKey mk = new androidx.security.crypto.MasterKey.Builder(context)
                        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM).build();
                SharedPreferences prefs = androidx.security.crypto.EncryptedSharedPreferences.create(
                        context,
                        "device_prefs",
                        mk,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
                String deviceId = prefs.getString("device_id", null);
                if (deviceId == null) {
                    deviceId = java.util.UUID.randomUUID().toString();
                    prefs.edit().putString("device_id", deviceId).apply();
                }
                return deviceId;
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to read device ID from EncryptedSharedPreferences", e);
        }
        // 降级：明文 SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences("device_prefs", Context.MODE_PRIVATE);
        String deviceId = prefs.getString("device_id", null);
        if (deviceId == null) {
            deviceId = java.util.UUID.randomUUID().toString();
            prefs.edit().putString("device_id", deviceId).apply();
        }
        return deviceId;
    }

    /**
     * 检查 OTA 更新
     */
    public void checkForUpdate() {
        Log.i(TAG, "Checking for update... Current version: " + getCurrentVersion());

        apiClient.checkOtaUpdate(getDeviceId(), new ApiClient.ApiCallback() {
            @Override
            public void onSuccess(String response) {
                try {
                    JSONObject json = new JSONObject(response);
                    String latestVersion = json.optString("version", "");
                    String downloadUrl = json.optString("downloadUrl", "");
                    String checksum = json.optString("checksum", "");

                    if (latestVersion.isEmpty() || downloadUrl.isEmpty()) {
                        Log.w(TAG, "OTA response missing version or downloadUrl");
                        return;
                    }

                    // 比对版本
                    if (latestVersion.compareTo(getCurrentVersion()) > 0) {
                        Log.i(TAG, "New version available: " + latestVersion);
                        sendOtaNotification(context.getString(R.string.ota_new_version, latestVersion));
                        downloadAndInstall(downloadUrl, checksum);
                    } else {
                        Log.i(TAG, "Already up to date (" + getCurrentVersion() + ")");
                    }

                } catch (Exception e) {
                    Log.e(TAG, "Failed to parse OTA response", e);
                }
            }

            @Override
            public void onError(int code, String message) {
                Log.e(TAG, "OTA check failed: " + code + " " + message);
            }
        });
    }

    /**
     * 下载并安装 OTA 更新包
     *
     * @param downloadUrl APK 下载 URL
     * @param expectedChecksum SHA-256 校验和
     */
    public void downloadAndInstall(String downloadUrl, String expectedChecksum) {
        Log.i(TAG, "Starting OTA download: " + downloadUrl);

        final String outputPath = new File(otaDir, "update_" + System.currentTimeMillis() + ".apk")
                .getAbsolutePath();

        new Thread(() -> {
            try {
                // 1. 下载
                apiClient.downloadOtaPackage(downloadUrl, outputPath);

                // 2. 校验签名
                if (!verifyPackage(outputPath, expectedChecksum)) {
                    Log.e(TAG, "OTA package checksum mismatch");
                    sendOtaNotification(context.getString(R.string.ota_checksum_failed));
                    return;
                }

                // 3. 安装
                installPackage(outputPath);
                sendOtaNotification(context.getString(R.string.ota_install_complete));

            } catch (Exception e) {
                Log.e(TAG, "OTA failed", e);
                sendOtaNotification(context.getString(R.string.ota_update_failed, e.getMessage()));
            }
        }, "ota-download").start();
    }

    private void installPackage(String apkPath) {
        File apkFile = new File(apkPath);
        if (!apkFile.exists()) {
            Log.e(TAG, "APK not found: " + apkPath);
            return;
        }

        if (tryPackageInstallerSession(apkFile)) {
            Log.i(TAG, "OTA installed via PackageInstaller Session");
            return;
        }

        try {
            Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            android.net.Uri apkUri = androidx.core.content.FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    apkFile);
            installIntent.setData(apkUri);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(installIntent);
            Log.i(TAG, "OTA install initiated via Intent (user confirmation required)");
        } catch (Exception e) {
            Log.e(TAG, "OTA install via Intent failed", e);
            try {
                Process process = Runtime.getRuntime().exec(
                        "pm install -r " + apkPath);
                int exitCode = process.waitFor();
                if (exitCode == 0) {
                    Log.i(TAG, "OTA installed via pm command");
                } else {
                    Log.e(TAG, "pm install failed with exit code: " + exitCode);
                }
            } catch (Exception e2) {
                Log.e(TAG, "pm install also failed", e2);
            }
        }
    }

    private boolean tryPackageInstallerSession(File apkFile) {
        try {
            if (context.checkSelfPermission(android.Manifest.permission.INSTALL_PACKAGES)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                return false;
            }

            android.content.pm.PackageInstaller packageInstaller =
                    context.getPackageManager().getPackageInstaller();
            if (packageInstaller == null) {
                return false;
            }

            android.content.pm.PackageInstaller.SessionParams params =
                    new android.content.pm.PackageInstaller.SessionParams(
                            android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = packageInstaller.createSession(params);

            android.content.pm.PackageInstaller.Session session =
                    packageInstaller.openSession(sessionId);
            java.io.OutputStream os = session.openWrite("base.apk", 0, apkFile.length());
            java.io.FileInputStream fis = new java.io.FileInputStream(apkFile);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                os.write(buffer, 0, read);
            }
            session.fsync(os);
            fis.close();
            os.close();

            session.commit(android.app.PendingIntent.getActivity(
                    context, 0, new Intent(), PendingIntent.FLAG_IMMUTABLE).getIntentSender());
            Log.i(TAG, "PackageInstaller session committed for: " + apkFile.getName());
            return true;

        } catch (Exception e) {
            Log.e(TAG, "PackageInstaller session failed", e);
            return false;
        }
    }

    /**
     * 发送 OTA 通知（P2-8）
     */
    private void sendOtaNotification(String text) {
        try {
            NotificationManager nm = (NotificationManager)
                    context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationCompat.Builder builder = new NotificationCompat.Builder(
                    context, FancyPrintApplication.CHANNEL_OTA)
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle(context.getString(R.string.notification_ota_title))
                    .setContentText(text)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH);

            nm.notify(2001, builder.build());
        } catch (Exception e) {
            Log.e(TAG, "sendOtaNotification error", e);
        }
    }

    /**
     * 校验 OTA 包完整性
     */
    private boolean verifyPackage(String filePath, String expectedChecksum) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            java.io.FileInputStream fis = new java.io.FileInputStream(filePath);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                md.update(buffer, 0, read);
            }
            fis.close();

            StringBuilder hexString = new StringBuilder();
            for (byte b : md.digest()) {
                hexString.append(String.format("%02x", b));
            }
            return hexString.toString().equalsIgnoreCase(expectedChecksum);

        } catch (Exception e) {
            Log.e(TAG, "Checksum verification failed", e);
            return false;
        }
    }
}
