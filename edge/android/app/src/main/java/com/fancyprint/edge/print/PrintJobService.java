package com.fancyprint.edge.print;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Intent;
import android.util.Log;

/**
 * PrintJobService — JobScheduler 任务
 *
 * 对应 doc/2 §13.4.2：注册 NetworkType.CONNECTED 的 JobScheduler 任务，
 * 网络恢复后自动重试离线打印队列。
 *
 * 当网络恢复时，此 Service 被触发，启动 EdgeDaemonService 处理离线队列。
 */
public class PrintJobService extends JobService {

    private static final String TAG = "PrintJobService";

    @Override
    public boolean onStartJob(JobParameters params) {
        Log.i(TAG, "Job started: network available, processing offline queue");
        // 启动 EdgeDaemonService 处理队列
        Intent intent = new Intent(this, com.fancyprint.edge.service.EdgeDaemonService.class);
        startService(intent);
        return false; // 任务完成，无需后台线程
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Log.w(TAG, "Job stopped");
        return true; // 需要重新调度
    }
}
