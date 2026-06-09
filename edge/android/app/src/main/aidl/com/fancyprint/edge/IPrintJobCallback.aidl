// IPrintJobCallback.aidl
// 回调接口：EdgeDaemonService → UI

package com.fancyprint.edge;

interface IPrintJobCallback {

    /**
     * 打印任务状态变更通知
     * @param jobId 任务 ID
     * @param status queued / printing / done / failed
     * @param errorCode 0=正常，非零=错误码
     * @param message 可读描述
     */
    void onPrintJobStatusChanged(String jobId, String status, int errorCode, String message);

    /**
     * 连接状态变更
     * @param status connected / disconnected / connecting
     */
    void onConnectionStatusChanged(String status);

    /**
     * 设备告警
     * @param type low_battery / jam / no_paper / overheat
     * @param message 描述
     */
    void onDeviceAlert(String type, String message);

    /**
     * OTA 可用通知
     * @param version 新版本号
     * @param changelog 更新说明
     */
    void onUpdateAvailable(String version, String changelog);
}
