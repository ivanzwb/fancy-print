// IEdgeDaemonService.aidl
// IPC 接口：UI → EdgeDaemonService
// 与 doc/2 端侧软件与工程样机技术分析.md §5.2 IPC 契约对齐

package com.fancyprint.edge;

import com.fancyprint.edge.IPrintJobCallback;
import com.fancyprint.edge.IAsrCallback;

interface IEdgeDaemonService {

    // ============================================================
    // 打印任务
    // ============================================================

    /**
     * 提交打印任务（创建为 pending_confirm，等待确认后才入队列）
     * @param jobId 任务唯一 ID（与云端一致）
     * @param imageUrl 打印图片 URL（已审核）
     * @param mode 打印模式：color / lineart / pastel
     * @param contentMode 创作模式：coloring / papercut / dressup 等（与云端枚举一致）
     * @param timeoutSec 超时秒数
     * @return boolean 是否成功入队
     */
    boolean submitPrintJob(String jobId, String imageUrl, String mode, String contentMode, int timeoutSec);

    /**
     * 确认打印 → 入队列
     * @param jobId 任务 ID
     * @return boolean 是否成功确认
     */
    boolean confirmPrintJob(String jobId);

    /**
     * 取消打印任务
     * @param jobId 任务 ID
     * @return boolean 是否成功取消
     */
    boolean cancelPrintJob(String jobId);

    /**
     * 查询打印任务状态
     * @param jobId 任务 ID
     * @return JSON 状态字符串：{"status":"queued|printing|done|failed","errorCode":0,"progress":50}
     */
    String getPrintJobStatus(String jobId);

    /**
     * 查询打印队列
     * @return JSON 数组字符串：[{"jobId":"...","status":"queued","imageUrl":"..."}]
     */
    String getPrintQueue();

    // ============================================================
    // 音频
    // ============================================================

    /**
     * 开始 PTT 录音
     * @return boolean 是否成功启动
     */
    boolean startRecording();

    /**
     * 停止 PTT 录音并返回音频路径
     * @return 音频文件路径，失败返回空字符串
     */
    String stopRecording();

    /**
     * 播放 TTS / 提示音
     * @param filePath 音频文件路径
     * @param volume 音量 0.0～1.0
     */
    void playAudio(String filePath, float volume);

    /**
     * 停止播放
     */
    void stopAudio();

    // ---- PCM 录制（本地 Sherpa-ONNX ASR） ----

    /**
     * 开始 PCM 录制（16kHz 16bit mono），供本地离线 ASR 使用
     * @return PCM 文件路径，失败返回空
     */
    String startPcmRecording();

    /**
     * 停止 PCM 录制并返回 PCM 文件路径
     * @return PCM 文件路径，失败返回空
     */
    String stopPcmRecording();

    // ---- ASR 语音识别 ----

    /**
     * 上传录音进行 ASR 语音识别（本地 Sherpa-ONNX 优先，云端 fallback）
     * 当 audioPath 为 .pcm 文件时，优先使用本地离线 ASR
     * oneway：异步调用，结果通过 callback 返回，不阻塞 UI 线程
     * @param audioPath 录音文件路径（.pcm 或 .mp4）
     * @param callback 识别结果回调
     */
    oneway void transcribeAudio(String audioPath, IAsrCallback callback);

    // ============================================================
    // 云连接
    // ============================================================

    /**
     * 获取设备连接状态
     * @return connected / disconnected / connecting
     */
    String getConnectionStatus();

    /**
     * 触发 MQTT 重连
     */
    void reconnectCloud();

    // ============================================================
    // 家长锁
    // ============================================================

    /**
     * 验证家长锁 PIN
     * @param pin PIN 码
     * @return boolean 是否通过
     */
    boolean validateParentPin(String pin);

    /**
     * 设置家长锁 PIN
     * @param oldPin 旧 PIN（首次设置传空）
     * @param newPin 新 PIN
     * @return boolean 是否成功
     */
    boolean setParentPin(String oldPin, String newPin);

    /**
     * 查询家长锁是否启用
     * @return boolean
     */
    boolean isParentLockEnabled();

    /**
     * 启用/禁用家长锁
     * @param enabled true 启用，false 禁用
     */
    void setParentLockEnabled(boolean enabled);

    // ============================================================
    // 系统
    // ============================================================

    /**
     * 获取设备信息
     * @return JSON：{"deviceId":"...","fwVersion":"...","battery":85,"storage":62}
     */
    String getDeviceInfo();

    /**
     * 触发 OTA 检查
     */
    void checkForUpdate();

    /**
     * 出厂重置（清除 PIN、设置、队列）
     */
    boolean factoryReset();

    /**
     * 设备重启
     */
    void rebootDevice();

    /**
     * 注册打印回调
     */
    void registerPrintCallback(IPrintJobCallback callback);

    /**
     * 注销打印回调
     */
    void unregisterPrintCallback(IPrintJobCallback callback);
}
