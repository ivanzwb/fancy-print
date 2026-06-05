package com.fancyprint.edge.asr;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

public class SherpaAsrService {
    private static final String TAG = "SherpaAsrService";
    private Context context;
    private boolean isLoaded = false;

    public SherpaAsrService(Context context) {
        this.context = context;
    }

    public void loadModel() {
        if (isLoaded) return;
        try {
            System.loadLibrary("sherpa-onnx-jni");
            Log.i(TAG, "Native library loaded");
            isLoaded = true;
        } catch (Exception e) {
            Log.e(TAG, "loadModel failed", e);
        }
    }

    public String transcribePcmFile(String pcmPath) {
        if (!isLoaded) {
            Log.w(TAG, "Model not loaded");
            return "";
        }
        Log.i(TAG, "transcribePcmFile: " + pcmPath);

        try {
            File pcmFile = new File(pcmPath);
            if (!pcmFile.exists()) {
                Log.e(TAG, "PCM file not found: " + pcmPath);
                return "";
            }

            byte[] pcmData;
            try (FileInputStream fis = new FileInputStream(pcmFile)) {
                int size = (int) pcmFile.length();
                pcmData = new byte[size];
                fis.read(pcmData);
            }

            Log.i(TAG, "PCM loaded: " + pcmData.length + " bytes");

            // TODO: implement Sherpa-ONNX OnlineRecognizer
            return "";
        } catch (Exception e) {
            Log.e(TAG, "transcribePcmFile error", e);
            return "";
        }
    }

    public void release() {
        Log.i(TAG, "SherpaAsrService released");
    }
}
