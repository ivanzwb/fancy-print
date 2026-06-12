package com.fancyprint.edge.ui;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.fancyprint.edge.IEdgeDaemonService;
import com.fancyprint.edge.FancyPrintApplication;
import com.fancyprint.edge.R;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * PrintConfirmActivity — 打印确认界面
 *
 * 对应 doc/2 §5.2 IPC 契约 — 预览与打印确认
 *
 * 显示云端下发的预览图供儿童确认，确认后调用 EdgeDaemonService 提交打印任务。
 */
public class PrintConfirmActivity extends AppCompatActivity {

    private static final String TAG = "PrintConfirmActivity";

    @Override
    protected void attachBaseContext(Context newBase) {
        if (FancyPrintApplication.isRk3566Overdensed()) {
            Configuration config = new Configuration(newBase.getResources().getConfiguration());
            config.densityDpi = DisplayMetrics.DENSITY_MEDIUM;
            super.attachBaseContext(newBase.createConfigurationContext(config));
        } else {
            super.attachBaseContext(newBase);
        }
    }



    private IEdgeDaemonService daemonService;
    private boolean bound = false;
    private final ExecutorService imageLoader = Executors.newSingleThreadExecutor();

    private ImageView previewImage;
    private TextView jobInfoText;
    private Button confirmButton;
    private Button cancelButton;
    private ProgressBar loadingSpinner;

    private String jobId;
    private String imageUrl;
    private String mode;
    private String contentMode;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            daemonService = IEdgeDaemonService.Stub.asInterface(service);
            bound = true;
            Log.i(TAG, "Bound to EdgeDaemonService");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            daemonService = null;
            bound = false;
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_print_confirm);

        previewImage = findViewById(R.id.preview_image);
        jobInfoText = findViewById(R.id.job_info);
        confirmButton = findViewById(R.id.confirm_button);
        cancelButton = findViewById(R.id.cancel_button);
        loadingSpinner = findViewById(R.id.loading_spinner);

        // 从 Intent 获取任务参数
        jobId = getIntent().getStringExtra("jobId");
        imageUrl = getIntent().getStringExtra("imageUrl");
        mode = getIntent().getStringExtra("mode");
        contentMode = getIntent().getStringExtra("contentMode");
        if (jobId == null) jobId = "job_" + System.currentTimeMillis();
        if (mode == null) mode = "color";
        if (contentMode == null) contentMode = "coloring";

        jobInfoText.setText("打印模式: " + getModeLabel(mode) + " · " + getContentModeLabel(contentMode));

        // 绑定服务
        Intent intent = new Intent(this, com.fancyprint.edge.service.EdgeDaemonService.class);
        bindService(intent, connection, Context.BIND_AUTO_CREATE);

        // 加载预览图
        if (imageUrl != null && !imageUrl.isEmpty()) {
            loadImage(imageUrl);
        } else {
            previewImage.setImageResource(android.R.drawable.ic_menu_gallery);
            loadingSpinner.setVisibility(View.GONE);
        }

        // 确认打印
        confirmButton.setOnClickListener(v -> {
            confirmButton.setEnabled(false);
            submitPrintJob();
        });

        // 取消
        cancelButton.setOnClickListener(v -> {
            // 如果存在 pending 的 job，取消它
            if (bound && daemonService != null && jobId != null) {
                try {
                    daemonService.cancelPrintJob(jobId);
                } catch (RemoteException e) {
                    Log.e(TAG, "cancelPrintJob error", e);
                }
            }
            finish();
        });
    }

    @Override
    protected void onDestroy() {
        imageLoader.shutdownNow();
        if (bound) {
            unbindService(connection);
            bound = false;
        }
        super.onDestroy();
    }

    private void submitPrintJob() {
        if (!bound || daemonService == null) {
            Log.e(TAG, "Service not bound");
            finish();
            return;
        }

        try {
            String existingStatus = daemonService.getPrintJobStatus(jobId);
            org.json.JSONObject statusJson = null;
            if (existingStatus != null && !existingStatus.isEmpty()) {
                try {
                    statusJson = new org.json.JSONObject(existingStatus);
                } catch (Exception ignored) {}
            }

            boolean confirmed;
            if (statusJson != null && "pending_confirm".equals(statusJson.optString("status"))) {
                confirmed = daemonService.confirmPrintJob(jobId);
                Log.i(TAG, "Confirmed existing pending_confirm job: " + jobId);
            } else {
                boolean submitted = daemonService.submitPrintJob(jobId, imageUrl, mode, contentMode, 120);
                confirmed = submitted && daemonService.confirmPrintJob(jobId);
            }

            if (confirmed) {
                jobInfoText.setText("打印任务已提交");
                confirmButton.setText("打印中...");
                confirmButton.setEnabled(false);
            } else {
                jobInfoText.setText("提交失败，请重试");
                confirmButton.setEnabled(true);
            }
        } catch (RemoteException e) {
            Log.e(TAG, "submitPrintJob error", e);
            jobInfoText.setText("提交失败: " + e.getMessage());
            confirmButton.setEnabled(true);
        }
    }

    private void loadImage(String url) {
        loadingSpinner.setVisibility(View.VISIBLE);
        imageLoader.execute(() -> {
            Bitmap bitmap = null;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);
                InputStream is = conn.getInputStream();
                bitmap = BitmapFactory.decodeStream(is);
                is.close();
            } catch (Exception e) {
                Log.e(TAG, "Failed to load image", e);
            }
            final Bitmap result = bitmap;
            runOnUiThread(() -> {
                loadingSpinner.setVisibility(View.GONE);
                if (result != null) {
                    previewImage.setImageBitmap(result);
                } else {
                    previewImage.setImageResource(android.R.drawable.ic_menu_gallery);
                }
            });
        });
    }

    private String getModeLabel(String mode) {
        switch (mode) {
            case "lineart": return "线稿";
            case "pastel": return "淡彩";
            case "color":
            default: return "彩色";
        }
    }

    private String getContentModeLabel(String cm) {
        if (cm == null) return "变线稿";
        switch (cm) {
            case "papercut": return "剪纸";
            case "dressup":
            case "dress_up": return "换装";
            case "coloring_quiet_book": return "安静书";
            case "paper_craft": return "安静书";
            case "ai_create": return "变彩画";
            case "template": return "安静书";
            case "my_works": return "小相册";
            case "coloring": return "变线稿";
            default: return cm;
        }
    }
}
