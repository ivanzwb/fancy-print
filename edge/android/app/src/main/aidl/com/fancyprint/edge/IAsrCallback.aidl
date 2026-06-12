// IAsrCallback.aidl
// ASR 转录结果回调

package com.fancyprint.edge;

interface IAsrCallback {
    /** 语音识别文字结果 */
    void onSuccess(String transcription);
    /** 云端生图预览就绪（base64 data URI 或 URL） */
    void onImageReady(String previewUrl);
    /** 识别失败 */
    void onError(int code, String message);
}
