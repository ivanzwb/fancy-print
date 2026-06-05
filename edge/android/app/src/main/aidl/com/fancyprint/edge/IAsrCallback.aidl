// IAsrCallback.aidl
// ASR 转录结果回调

package com.fancyprint.edge;

interface IAsrCallback {
    void onSuccess(String transcription);
    void onError(int code, String message);
}
