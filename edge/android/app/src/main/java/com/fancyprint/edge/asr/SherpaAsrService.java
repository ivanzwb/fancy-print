package com.fancyprint.edge.asr;

import android.content.Context;
import android.util.Log;

import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineRecognizer;
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * SherpaAsrService — 本地离线语音识别（ASR）
 *
 * 基于 k2-fsa/sherpa-onnx 的 Zipformer 流式模型，在端侧本地完成
 * 语音→文本转换，无需联网。
 *
 * 模型：sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23
 *       - 中文专有，14M 参数量，适合儿童语音场景
 *       - 16kHz / 16-bit / mono PCM 输入
 *
 * 架构：PTT 按键录音 → PCM 文件 → transcribePcmFile() → 识别文本
 */
public class SherpaAsrService {

    private static final String TAG = "SherpaAsrService";
    private static final int SAMPLE_RATE = 16000;

    /** assets/ 下的模型目录名 */
    private static final String ASSET_MODEL_DIR = "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23";

    /** 必需模型文件列表（assets 目录下） */
    private static final String[] REQUIRED_MODEL_FILES = {
        "encoder-epoch-99-avg-1.int8.onnx",
        "decoder-epoch-99-avg-1.onnx",
        "joiner-epoch-99-avg-1.int8.onnx",
        "tokens.txt"
    };

    private final Context context;
    private OnlineRecognizer recognizer;
    private boolean isLoaded = false;
    private boolean isInitializing = false;

    public SherpaAsrService(Context context) {
        this.context = context;
    }

    /**
     * 加载 Sherpa-ONNX 模型（含首次运行时从 assets 解压到内部存储）
     *
     * 线程安全：同一时刻只允许一个初始化任务。
     * 如果模型已加载，直接返回。
     */
    public synchronized void loadModel() {
        if (isLoaded || isInitializing) return;
        isInitializing = true;

        try {
            // 1. 确保模型文件在内部存储中存在（首次运行从 assets 解压）
            File modelDir = new File(context.getFilesDir(), ASSET_MODEL_DIR);
            if (!hasAllModelFiles(modelDir)) {
                Log.i(TAG, "Extracting model files to " + modelDir.getAbsolutePath());
                extractAssetDir(ASSET_MODEL_DIR, modelDir);
            }

            String modelPath = modelDir.getAbsolutePath();

            // 2. 配置 Transducer 模型（encoder/joiner 用 int8 量化，decoder 用全精度）
            OnlineTransducerModelConfig transducerConfig = new OnlineTransducerModelConfig();
            transducerConfig.setEncoder(modelPath + "/encoder-epoch-99-avg-1.int8.onnx");
            transducerConfig.setDecoder(modelPath + "/decoder-epoch-99-avg-1.onnx");
            transducerConfig.setJoiner(modelPath + "/joiner-epoch-99-avg-1.int8.onnx");

            // 3. 配置识别器
            OnlineModelConfig modelConfig = new OnlineModelConfig();
            modelConfig.setTransducer(transducerConfig);
            modelConfig.setTokens(modelPath + "/tokens.txt");
            modelConfig.setModelType("zipformer");

            OnlineRecognizerConfig config = new OnlineRecognizerConfig();
            config.setModelConfig(modelConfig);

            // 4. 创建识别器（模型从绝对文件路径加载，AssetManager 传 null）
            //    如果传非 null AssetManager，Sherpa-ONNX 会尝试从 assets 读取，
            //    导致绝对路径文件加载失败（见 sherpa-onnx issue #2562）
            recognizer = new OnlineRecognizer(null, config);
            isLoaded = true;
            Log.i(TAG, "Sherpa-ONNX OnlineRecognizer loaded successfully");

        } catch (Exception e) {
            Log.e(TAG, "Failed to load Sherpa-ONNX model", e);
            recognizer = null;
            isLoaded = false;
        } finally {
            isInitializing = false;
        }
    }

    /**
     * 对 PCM 录音文件进行离线语音识别
     *
     * @param pcmPath 16kHz / 16-bit / mono PCM 文件路径
     * @return 识别出的文本；失败时返回空字符串
     */
    public String transcribePcmFile(String pcmPath) {
        if (!isLoaded) {
            Log.w(TAG, "Model not loaded, attempting lazy load");
            loadModel();
            if (!isLoaded) return "";
        }

        File pcmFile = new File(pcmPath);
        if (!pcmFile.exists()) {
            Log.e(TAG, "PCM file not found: " + pcmPath);
            return "";
        }

        try {
            // 读取 PCM 文件
            byte[] pcmBytes;
            try (FileInputStream fis = new FileInputStream(pcmFile)) {
                int size = fis.available();
                if (size < 1600) { // 少于 0.1 秒 — 太短，可能无效
                    Log.w(TAG, "PCM file too short: " + size + " bytes");
                    return "";
                }
                pcmBytes = new byte[size];
                int read = fis.read(pcmBytes);
                if (read != size) {
                    Log.w(TAG, "Incomplete read: " + read + "/" + size);
                }
            }

            // 16-bit signed PCM → normalized float [-1, 1]
            int sampleCount = pcmBytes.length / 2;
            float[] samples = new float[sampleCount];
            ByteBuffer byteBuf = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < sampleCount; i++) {
                samples[i] = byteBuf.getShort(i * 2) / 32768.0f;
            }

            float durationSec = (float) sampleCount / SAMPLE_RATE;
            Log.i(TAG, "PCM loaded: " + sampleCount + " samples (" + String.format("%.1f", durationSec) + "s)");

            // 创建流并送入全部音频
            OnlineStream stream = recognizer.createStream("");
            stream.acceptWaveform(samples, SAMPLE_RATE);

            // 尾部填充静音帧（帮助模型检测句尾边界）
            float[] tailPaddings = new float[(int) (0.8 * SAMPLE_RATE)];
            stream.acceptWaveform(tailPaddings, SAMPLE_RATE);

            // 解码直到 ready
            while (recognizer.isReady(stream)) {
                recognizer.decode(stream);
            }

            String text = recognizer.getResult(stream).getText();
            stream.release();

            if (text != null && !text.isEmpty()) {
                Log.i(TAG, "ASR result: \"" + text + "\"");
            } else {
                Log.w(TAG, "ASR returned empty text");
            }

            return text != null ? text.trim() : "";

        } catch (Exception e) {
            Log.e(TAG, "transcribePcmFile error", e);
            return "";
        }
    }

    /**
     * 检查模型是否已加载
     */
    public boolean isLoaded() {
        return isLoaded;
    }

    /**
     * 释放识别器资源
     */
    public void release() {
        if (recognizer != null) {
            try {
                recognizer.release();
            } catch (Exception e) {
                Log.e(TAG, "Error releasing recognizer", e);
            }
            recognizer = null;
        }
        isLoaded = false;
        Log.i(TAG, "SherpaAsrService released");
    }

    // ============================================================
    // 模型文件管理
    // ============================================================

    /**
     * 检查模型目录下是否所有必需文件均存在
     */
    private boolean hasAllModelFiles(File dir) {
        if (!dir.exists() || !dir.isDirectory()) return false;
        for (String file : REQUIRED_MODEL_FILES) {
            if (!new File(dir, file).exists()) return false;
        }
        return true;
    }

    /**
     * 从 APK assets 递归提取模型文件到内部存储
     */
    private void extractAssetDir(String assetDir, File outDir) throws IOException {
        if (!outDir.exists()) {
            if (!outDir.mkdirs()) {
                throw new IOException("Cannot create directory: " + outDir);
            }
        }

        String[] entries = context.getAssets().list(assetDir);
        if (entries == null || entries.length == 0) {
            Log.w(TAG, "No model files found in assets/" + assetDir
                    + " — please run download_model.sh first");
            return;
        }

        for (String entry : entries) {
            String assetPath = assetDir + "/" + entry;
            File outFile = new File(outDir, entry);

            // 判断是文件还是子目录
            String[] subEntries = context.getAssets().list(assetPath);
            if (subEntries != null && subEntries.length > 0) {
                // 子目录 — 递归
                extractAssetDir(assetPath, outFile);
            } else {
                // 文件 — 复制
                try (InputStream in = context.getAssets().open(assetPath);
                     OutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }
                Log.d(TAG, "Extracted: " + outFile.getName());
            }
        }
    }
}
