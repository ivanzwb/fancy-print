package com.fancyprint.edge.print;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.hardware.usb.UsbManager;
import android.os.RemoteCallbackList;
import android.util.Log;

import com.fancyprint.edge.IPrintJobCallback;
import com.fancyprint.edge.print.UsbPrintConnector.UsbPermissionCallback;
import com.fancyprint.edge.config.AppConfig;
import com.fancyprint.edge.storage.JobDatabase;
import com.fancyprint.edge.storage.PrintJobEntity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * PrintJobManager — 打印任务队列管理器
 *
 * 对应 doc/2 §13.2.3 Android 端打印抽象层设计
 *
 * 职责：
 * - 接收云端/UI 下发的打印任务
 * - 管理任务队列（FIFO）
 * - 调用 UsbPrintConnector / BlePrintConnector 执行打印
 * - 通过 Room 持久化离线任务
 * - 通过 RemoteCallbackList 通知 UI 状态变更
 */
public class PrintJobManager {

    private static final String TAG = "PrintJobManager";
    private static final int MAX_RETRIES = 3;
    private static final long CLEANUP_THRESHOLD_MS = 24 * 60 * 60 * 1000L; // 24 小时
    private static final int JOB_SCHEDULER_ID = 1001;
    private static final int MAX_CONCURRENT_JOBS = 2;

    private final Context context;
    private final JobDatabase jobDatabase;
    private final RemoteCallbackList<IPrintJobCallback> callbacks;
    private final ExecutorService executor;

    private final java.util.Set<String> activeJobIds = new java.util.concurrent.CopyOnWriteArraySet<>();
    private final java.util.Map<String, Integer> retryCounts = new java.util.concurrent.ConcurrentHashMap<>();

    private final UsbPrintConnector usbPrintConnector;
    private final BlePrintConnector blePrintConnector;
    private final Object connectorLock = new Object();

    private AppConfig appConfig;

    public PrintJobManager(Context context, JobDatabase jobDatabase,
                           RemoteCallbackList<IPrintJobCallback> callbacks) {
        this.context = context;
        this.jobDatabase = jobDatabase;
        this.callbacks = callbacks;
        this.executor = Executors.newSingleThreadExecutor();
        this.usbPrintConnector = new UsbPrintConnector(context);
        this.blePrintConnector = new BlePrintConnector(context);
        this.appConfig = AppConfig.load(context);
    }

    /**
     * 提交打印任务（创建为 pending_confirm，等待用户确认后才入队列）
     */
    public boolean submitJob(String jobId, String imageUrl, String mode, String contentMode, int timeoutSec) {
        Log.i(TAG, "submitJob: " + jobId + " mode=" + mode + " contentMode=" + contentMode);
        if (timeoutSec <= 0 && appConfig != null) {
            timeoutSec = appConfig.getPrintTimeoutSec();
        }

        PrintJobEntity entity = new PrintJobEntity();
        entity.jobId = jobId != null ? jobId : java.util.UUID.randomUUID().toString();
        entity.imageUrl = imageUrl != null ? imageUrl : "";
        entity.mode = mode != null ? mode : "color";
        entity.contentMode = contentMode != null ? contentMode : "coloring";
        entity.timeoutSec = timeoutSec;
        entity.status = "pending_confirm";
        entity.errorCode = 0;
        entity.createdAt = System.currentTimeMillis();
        entity.updatedAt = System.currentTimeMillis();

        executor.execute(() -> {
            jobDatabase.printJobDao().insert(entity);
            Log.d(TAG, "Job persisted (pending_confirm): " + jobId);
            broadcastStatus(jobId, "pending_confirm", 0, "等待确认");
        });

        return true;
    }

    /**
     * 确认打印 → 入队列，开始处理
     */
    public boolean confirmJob(String jobId) {
        Log.i(TAG, "confirmJob: " + jobId);
        executor.execute(() -> {
            jobDatabase.printJobDao().updateStatus(jobId, "queued", System.currentTimeMillis());
            broadcastStatus(jobId, "queued", 0, "任务已入队");
            scheduleOfflineRetry();
            // 如果有可用并发槽位，立即开始处理
            if (activeJobIds.size() < MAX_CONCURRENT_JOBS) {
                processNext();
            }
        });
        return true;
    }

    /**
     * 取消打印任务
     */
    public boolean cancelJob(String jobId) {
        Log.i(TAG, "cancelJob: " + jobId);
        executor.execute(() -> {
            jobDatabase.printJobDao().updateStatus(jobId, "cancelled", System.currentTimeMillis());
            activeJobIds.remove(jobId);
            retryCounts.remove(jobId);
            broadcastStatus(jobId, "cancelled", 0, "任务已取消");
        });
        return true;
    }

    /**
     * 查询任务状态（JSON）
     */
    public String getJobStatus(String jobId) {
        try {
            PrintJobEntity entity = jobDatabase.printJobDao().getByJobId(jobId);
            if (entity == null) {
                return "{\"status\":\"unknown\",\"errorCode\":404}";
            }
            JSONObject json = new JSONObject();
            json.put("status", entity.status);
            json.put("errorCode", entity.errorCode);
            json.put("progress", entity.progress);
            json.put("imageUrl", entity.imageUrl != null ? entity.imageUrl : "");
            json.put("mode", entity.mode != null ? entity.mode : "color");
            json.put("contentMode", entity.contentMode != null ? entity.contentMode : "coloring");
            return json.toString();
        } catch (Exception e) {
            Log.e(TAG, "getJobStatus error", e);
            return "{\"status\":\"error\"}";
        }
    }

    /**
     * 获取队列 JSON
     */
    public String getQueueJson() {
        try {
            java.util.List<PrintJobEntity> queued = jobDatabase.printJobDao().getQueuedJobs();
            JSONArray arr = new JSONArray();
            for (PrintJobEntity e : queued) {
                JSONObject obj = new JSONObject();
                obj.put("jobId", e.jobId);
                obj.put("status", e.status);
                obj.put("imageUrl", e.imageUrl);
                obj.put("mode", e.mode);
                obj.put("contentMode", e.contentMode != null ? e.contentMode : "coloring");
                arr.put(obj);
            }
            return arr.toString();
        } catch (Exception e) {
            Log.e(TAG, "getQueueJson error", e);
            return "[]";
        }
    }

    /**
     * 处理下一个任务（含重试与校验）
     */
    private void processNext() {
        executor.execute(() -> {
            java.util.List<PrintJobEntity> queued = jobDatabase.printJobDao().getQueuedJobs();
            if (queued.isEmpty()) {
                if (activeJobIds.isEmpty()) {
                    cancelOfflineRetry();
                }
                return;
            }

            long now = System.currentTimeMillis();
            int slotsAvailable = MAX_CONCURRENT_JOBS - activeJobIds.size();

            for (PrintJobEntity job : queued) {
                if (slotsAvailable <= 0) break;
                // 跳过已在执行中的任务
                if (activeJobIds.contains(job.jobId)) continue;

                // 检查是否超时
                long elapsed = now - job.createdAt;
                long timeoutMs = job.timeoutSec * 1000L;
                if (timeoutMs > 0 && elapsed > timeoutMs) {
                    Log.w(TAG, "processNext: job " + job.jobId +
                            " timed out after " + elapsed + "ms (timeout=" + timeoutMs + "ms)");
                    jobDatabase.printJobDao().updateStatus(job.jobId, "timeout", now);
                    jobDatabase.printJobDao().updateErrorCode(job.jobId, 1003);
                    broadcastStatus(job.jobId, "timeout", 1003, "打印任务超时");
                    continue;
                }

                // 校验 imageUrl 非空
                if (job.imageUrl == null || job.imageUrl.isEmpty()) {
                    Log.w(TAG, "processNext: imageUrl is null/empty for " + job.jobId + ", skipping");
                    jobDatabase.printJobDao().updateStatus(job.jobId, "failed", now);
                    jobDatabase.printJobDao().updateErrorCode(job.jobId, 1002);
                    broadcastStatus(job.jobId, "failed", 1002, "缺少图片链接");
                    continue;
                }

                activeJobIds.add(job.jobId);
                retryCounts.put(job.jobId, 0);
                slotsAvailable--;
                executeWithRetry(job);
            }
        });
    }

    /**
     * 带重试的执行打印
     */
    private void executeWithRetry(PrintJobEntity job) {
        jobDatabase.printJobDao().updateStatus(job.jobId, "printing", System.currentTimeMillis());
        broadcastStatus(job.jobId, "printing", 0, "正在打印...");

        boolean success = executePrintInternal(job);

        if (success) {
            jobDatabase.printJobDao().updateStatus(job.jobId, "done", System.currentTimeMillis());
            broadcastStatus(job.jobId, "done", 0, "打印完成");
            activeJobIds.remove(job.jobId);
            retryCounts.remove(job.jobId);
            processNext();
        } else {
            int count = retryCounts.getOrDefault(job.jobId, 0) + 1;
            retryCounts.put(job.jobId, count);
            if (count < MAX_RETRIES) {
                Log.w(TAG, "print failed (attempt " + count + "/" + MAX_RETRIES + "), retrying: " + job.jobId);
                jobDatabase.printJobDao().updateStatus(job.jobId, "queued", System.currentTimeMillis());
                jobDatabase.printJobDao().updateErrorCode(job.jobId, 1001);
                broadcastStatus(job.jobId, "queued", 1001, "打印失败，准备重试 (" + count + "/" + MAX_RETRIES + ")");
                executor.execute(() -> {
                    try {
                        Thread.sleep(2000L * count);
                    } catch (InterruptedException ignored) {
                    }
                    executeWithRetry(job);
                });
            } else {
                Log.e(TAG, "print failed after " + MAX_RETRIES + " attempts: " + job.jobId);
                jobDatabase.printJobDao().updateStatus(job.jobId, "failed", System.currentTimeMillis());
                jobDatabase.printJobDao().updateErrorCode(job.jobId, 1001);
                broadcastStatus(job.jobId, "failed", 1001, "打印失败（已达最大重试次数）");
                activeJobIds.remove(job.jobId);
                retryCounts.remove(job.jobId);
                processNext();
            }
        }
    }

    private boolean executePrintInternal(PrintJobEntity job) {
        Bitmap bitmap = downloadImage(job.imageUrl);
        if (bitmap == null) {
            Log.e(TAG, "Failed to download image: " + job.imageUrl);
            return false;
        }

        bitmap = adjustBitmapForMode(bitmap, job.mode);

        android.hardware.usb.UsbDevice printer = usbPrintConnector.findPrinter();
        if (printer == null) {
            Log.w(TAG, "No USB printer found, trying BLE...");
            return tryBlePrint(bitmap, job);
        }

        if (!usbPrintConnector.hasPermission(printer)) {
            Log.w(TAG, "USB permission not granted for printer: " + printer.getProductName());
            // 启动 UsbPermissionActivity 请求权限（透明 Activity，无 UI）
            Intent permIntent = new Intent(context, UsbPermissionActivity.class);
            permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            permIntent.putExtra(UsbManager.EXTRA_DEVICE, printer);
            context.startActivity(permIntent);
            bitmap.recycle();
            return false;
        }

        if (!usbPrintConnector.isConnected()) {
            boolean connected = usbPrintConnector.connect(printer);
            if (!connected) {
                Log.e(TAG, "Failed to connect to printer: " + printer.getProductName());
                bitmap.recycle();
                return false;
            }
        }

        byte[] imageData = bitmapToPngBytes(bitmap);
        bitmap.recycle();

        if (imageData == null || imageData.length == 0) {
            Log.e(TAG, "Bitmap conversion failed");
            usbPrintConnector.disconnect();
            return false;
        }

        Log.i(TAG, "Sending " + imageData.length + " bytes to USB printer");
        boolean printed = usbPrintConnector.print(imageData);
        usbPrintConnector.disconnect();

        if (printed) {
            Log.i(TAG, "Print job completed: " + job.jobId);
        } else {
            Log.e(TAG, "Print failed: " + job.jobId);
        }

        return printed;
    }

    private boolean tryBlePrint(Bitmap bitmap, PrintJobEntity job) {
        java.util.List<android.bluetooth.BluetoothDevice> printers = blePrintConnector.getPairedPrinters();
        if (printers == null || printers.isEmpty()) {
            Log.w(TAG, "No BLE printer found either");
            bitmap.recycle();
            return false;
        }

        android.bluetooth.BluetoothDevice blePrinter = printers.get(0);
        Log.i(TAG, "Trying BLE printer: " + blePrinter.getName());

        if (!blePrintConnector.connect(blePrinter)) {
            Log.e(TAG, "Failed to connect to BLE printer: " + blePrinter.getName());
            bitmap.recycle();
            return false;
        }

        byte[] imageData = bitmapToPngBytes(bitmap);
        bitmap.recycle();

        if (imageData == null || imageData.length == 0) {
            Log.e(TAG, "Bitmap conversion failed for BLE");
            blePrintConnector.disconnect();
            return false;
        }

        Log.i(TAG, "Sending " + imageData.length + " bytes to BLE printer");
        boolean printed = blePrintConnector.print(imageData);
        blePrintConnector.disconnect();

        if (printed) {
            Log.i(TAG, "Print job completed via BLE: " + job.jobId);
        } else {
            Log.e(TAG, "Print failed via BLE: " + job.jobId);
        }

        return printed;
    }

    /**
     * 下载图片并转换为 Bitmap
     */
    private Bitmap downloadImage(String imageUrl) {
        if (imageUrl == null || imageUrl.isEmpty()) {
            return null;
        }
        try {
            URL url = new URL(imageUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("Accept", "image/*");
            InputStream is = conn.getInputStream();
            Bitmap bitmap = BitmapFactory.decodeStream(is);
            is.close();
            conn.disconnect();
            if (bitmap == null) {
                Log.e(TAG, "Failed to decode bitmap from: " + imageUrl);
            }
            return bitmap;
        } catch (Exception e) {
            Log.e(TAG, "downloadImage error: " + imageUrl, e);
            return null;
        }
    }

    /**
     * 根据打印模式调整 Bitmap
     * - color: 保持彩色
     * - lineart: 二值化（黑白）
     * - pastel: 降低饱和度，模拟淡彩
     */
    private Bitmap adjustBitmapForMode(Bitmap src, String mode) {
        if (src == null) return null;
        if (mode == null) mode = "color";

        if ("lineart".equals(mode)) {
            Bitmap gray = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(gray);
            android.graphics.Paint paint = new android.graphics.Paint();
            paint.setColorFilter(new android.graphics.ColorMatrixColorFilter(
                    new float[]{
                            0.299f, 0.587f, 0.114f, 0, 0,
                            0.299f, 0.587f, 0.114f, 0, 0,
                            0.299f, 0.587f, 0.114f, 0, 0,
                            0, 0, 0, 1, 0
                    }));
            canvas.drawBitmap(src, 0, 0, paint);
            Bitmap lineart = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
            for (int y = 0; y < gray.getHeight(); y++) {
                for (int x = 0; x < gray.getWidth(); x++) {
                    int pixel = gray.getPixel(x, y);
                    int grayValue = (pixel >> 16) & 0xFF;
                    int color = grayValue < 128 ? 0xFF000000 : 0xFFFFFFFF;
                    lineart.setPixel(x, y, color);
                }
            }
            src.recycle();
            gray.recycle();
            return lineart;
        } else if ("pastel".equals(mode)) {
            Bitmap pastel = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(pastel);
            android.graphics.Paint paint = new android.graphics.Paint();
            for (int y = 0; y < src.getHeight(); y++) {
                for (int x = 0; x < src.getWidth(); x++) {
                    int pixel = src.getPixel(x, y);
                    int r = (pixel >> 16) & 0xFF;
                    int g = (pixel >> 8) & 0xFF;
                    int b = pixel & 0xFF;
                    float[] hsv = new float[3];
                    android.graphics.Color.RGBToHSV(r, g, b, hsv);
                    hsv[1] *= 0.5f;
                    int newColor = android.graphics.Color.HSVToColor(hsv);
                    pastel.setPixel(x, y, newColor);
                }
            }
            src.recycle();
            return pastel;
        } else {
            return src;
        }
    }

    /**
     * 将 Bitmap 转换为 PNG 字节数组
     */
    private byte[] bitmapToPngBytes(Bitmap bitmap) {
        if (bitmap == null) return null;
        try {
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos);
            return baos.toByteArray();
        } catch (Exception e) {
            Log.e(TAG, "bitmapToPngBytes error", e);
            return null;
        }
    }

    /**
     * 释放资源
     */
    public void release() {
        executor.shutdown();
        cancelOfflineRetry();
        if (usbPrintConnector != null) {
            usbPrintConnector.disconnect();
        }
        if (blePrintConnector != null) {
            blePrintConnector.disconnect();
        }
        Log.i(TAG, "PrintJobManager released");
    }

    public void scheduleOfflineRetry() {
        try {
            android.app.job.JobScheduler js =
                    (android.app.job.JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;

            android.app.job.JobInfo jobInfo = new android.app.job.JobInfo.Builder(
                    JOB_SCHEDULER_ID,
                    new ComponentName(context, PrintJobService.class))
                    .setRequiredNetworkType(android.app.job.JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build();

            int result = js.schedule(jobInfo);
            if (result == android.app.job.JobScheduler.RESULT_SUCCESS) {
                Log.i(TAG, "JobScheduler job scheduled for offline retry");
            } else {
                Log.e(TAG, "Failed to schedule JobScheduler job: " + result);
            }
        } catch (Exception e) {
            Log.e(TAG, "scheduleOfflineRetry error", e);
        }
    }

    /**
     * 取消 JobScheduler 任务
     */
    public void cancelOfflineRetry() {
        try {
            android.app.job.JobScheduler js =
                    (android.app.job.JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            js.cancel(JOB_SCHEDULER_ID);
            Log.i(TAG, "JobScheduler job cancelled");
        } catch (Exception e) {
            Log.e(TAG, "cancelOfflineRetry error", e);
        }
    }

    /**
     * 清理 24 小时前的已完成/失败/已取消任务
     */
    public void cleanupOldJobs() {
        executor.execute(() -> {
            long cutoff = System.currentTimeMillis() - CLEANUP_THRESHOLD_MS;
            int deleted = jobDatabase.printJobDao().deleteOlderThan(cutoff);
            if (deleted > 0) {
                Log.i(TAG, "Cleaned up " + deleted + " old jobs");
            }
        });
    }

    /**
     * 广播任务状态到所有注册的 UI 回调
     */
    private void broadcastStatus(String jobId, String status, int errorCode, String message) {
        int n = callbacks.beginBroadcast();
        for (int i = 0; i < n; i++) {
            try {
                callbacks.getBroadcastItem(i).onPrintJobStatusChanged(jobId, status, errorCode, message);
            } catch (Exception e) {
                Log.e(TAG, "broadcast callback error", e);
            }
        }
        callbacks.finishBroadcast();
    }
}
