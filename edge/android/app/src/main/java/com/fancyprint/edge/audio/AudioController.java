package com.fancyprint.edge.audio;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.util.Log;

import com.fancyprint.edge.R;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Locale;

/**
 * AudioController — 音频控制器
 *
 * 对应 doc/2 §13.3.1 音频
 *
 * 职责：
 * - PTT 按键录音（MediaRecorder → PCM/WAV 文件）
 * - TTS / 提示音播放（MediaPlayer / AudioTrack）
 * - 与 Debian PipeWire/ALSA 方案对齐的音频抽象
 */
public class AudioController {

    private static final String TAG = "AudioController";
    private static final int SAMPLE_RATE = 16000; // 16kHz 适合语音
    private static final String RECORDINGS_DIR = "recordings"; 
    private static final int MIN_RECORDING_MS = 2000; // 最矮录音 2 秒（Baidu ASR 需要至少 1 秒）

    private final Context context;
    private final File recordingsDir;
    private final AudioManager audioManager;

    private MediaRecorder mediaRecorder;
    private MediaPlayer mediaPlayer;
    private String currentRecordingPath;
    private boolean isRecording = false;

    // TTS
    private TextToSpeech textToSpeech;
    private boolean ttsReady = false;

    public AudioController(Context context) {
        this.context = context;
        this.recordingsDir = new File(context.getFilesDir(), RECORDINGS_DIR);
        if (!recordingsDir.exists()) {
            recordingsDir.mkdirs();
        }
        this.audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        initTts();
    }

    private void initTts() {
        textToSpeech = new TextToSpeech(context, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int langResult = textToSpeech.setLanguage(Locale.CHINESE);
                if (langResult == TextToSpeech.LANG_MISSING_DATA
                        || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                    Log.w(TAG, "TTS: Chinese not supported, falling back to default");
                    textToSpeech.setLanguage(Locale.getDefault());
                }
                ttsReady = true;
                Log.i(TAG, "TTS initialized");
            } else {
                Log.w(TAG, "TTS initialization failed: " + status);
            }
        });
    }

    // ============================================================
    // PTT 录音
    // ============================================================

    /**
     * 开始 PTT 录音
     */
    public boolean startRecording() {
        if (isRecording) {
            Log.w(TAG, "Already recording");
            return false;
        }

        try {
            String fileName = "ptt_" + System.currentTimeMillis() + ".mp4";
            currentRecordingPath = new File(recordingsDir, fileName).getAbsolutePath();

            mediaRecorder = new MediaRecorder();
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mediaRecorder.setAudioSamplingRate(SAMPLE_RATE);
            mediaRecorder.setAudioChannels(1);
            mediaRecorder.setAudioEncodingBitRate(64000);
            mediaRecorder.setOutputFile(currentRecordingPath);
            mediaRecorder.prepare();
            mediaRecorder.start();

            isRecording = true;
            Log.i(TAG, "Recording started: " + currentRecordingPath);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Failed to start recording", e);
            return false;
        }
    }

    /**
     * 停止录音并返回音频文件路径
     */
    public String stopRecording() {
        if (!isRecording || mediaRecorder == null) {
            Log.w(TAG, "Not recording");
            return "";
        }

        String result = "";
        try {
            mediaRecorder.stop();
            result = currentRecordingPath;
            Log.i(TAG, "Recording saved: " + currentRecordingPath);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop recording", e);
        } finally {
            try { mediaRecorder.release(); } catch (Exception ignored) {}
            mediaRecorder = null;
            isRecording = false;
        }
        return result;
    }

    // ============================================================
    // TTS / 提示音播放
    // ============================================================

    /**
     * TTS 语音播报（优先使用预录制音频）
     */
    public void speak(String text) {
        int resId = getTextToAudioResource(text);
        if (resId != 0) {
            playRawResource(resId);
        } else if (ttsReady && textToSpeech != null) {
            requestAudioFocus();
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, null);
            Log.i(TAG, "TTS speak: " + text);
        } else {
            Log.w(TAG, "TTS not ready, cannot speak: " + text);
        }
    }

    /**
     * 根据文本映射到预录制音频资源
     */
    private int getTextToAudioResource(String text) {
        if (text == null) return 0;
        
        if (text.contains("变彩画")) {
            return R.raw.mode_ai_create;
        } else if (text.contains("变线稿")) {
            return R.raw.mode_coloring;
        } else if (text.contains("安静书")) {
            return R.raw.mode_template;
        } else if (text.contains("相册")) {
            return R.raw.mode_album;
        } else if (text.contains("返回主页") || text.contains("已返回")) {
            return R.raw.back_home;
        }
        return 0;
    }

    /**
     * 播放 res/raw 资源音频
     */
    public void playRawResource(int rawResId) {
        stopAudio();
        requestAudioFocus();

        try {
            mediaPlayer = MediaPlayer.create(context, rawResId);
            if (mediaPlayer != null) {
                mediaPlayer.setVolume(1.0f, 1.0f);
                mediaPlayer.setOnCompletionListener(mp -> {
                    mp.release();
                    mediaPlayer = null;
                });
                mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                    Log.e(TAG, "MediaPlayer error: " + what + " " + extra);
                    mp.release();
                    mediaPlayer = null;
                    return true;
                });
                mediaPlayer.start();
                Log.i(TAG, "Playing raw resource: " + rawResId);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to play raw resource", e);
        }
    }

    /**
     * 播放音频文件
     * @param filePath 音频文件路径
     * @param volume 音量 0.0～1.0
     */
    public void playAudio(String filePath, float volume) {
        stopAudio();
        requestAudioFocus();

        try {
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(filePath);
            mediaPlayer.setVolume(volume, volume);
            mediaPlayer.setOnCompletionListener(mp -> {
                mp.release();
                mediaPlayer = null;
            });
            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                Log.e(TAG, "MediaPlayer error: " + what + " " + extra);
                mp.release();
                mediaPlayer = null;
                return true;
            });
            mediaPlayer.prepare();
            mediaPlayer.start();
            Log.i(TAG, "Playing: " + filePath);

        } catch (Exception e) {
            Log.e(TAG, "Failed to play audio", e);
        }
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioFocusRequest focusRequest = new AudioFocusRequest.Builder(
                    AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build())
                    .build();
            audioManager.requestAudioFocus(focusRequest);
        } else {
            audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioFocusRequest focusRequest = new AudioFocusRequest.Builder(
                    AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build())
                    .build();
            audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(null);
        }
    }

    /**
     * 停止播放
     */
    public void stopAudio() {
        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception e) {
                Log.e(TAG, "Error stopping media player", e);
            }
            mediaPlayer = null;
        }
        abandonAudioFocus();
    }

    // ============================================================
    // PCM 录制（16kHz 16bit mono，供本地 Sherpa-ONNX ASR 使用）
    // ============================================================
    private AudioRecord audioRecord;
    private boolean isPcmRecording = false;
    private Thread pcmRecordingThread;
    private String pcmRecordingPath; // 当前 PCM 录制文件路径

    /**
     * 开始 PCM 录制（16kHz 16bit mono）
     * 返回 PCM 数据文件路径
     */
    public String startPcmRecording() {
        if (isPcmRecording) {
            Log.w(TAG, "Already PCM recording");
            return "";
        }
        try {
            int sampleRate = 16000;
            int channelConfig = AudioFormat.CHANNEL_IN_MONO;
            int audioFormat = AudioFormat.ENCODING_PCM_16BIT;
            int minBuf = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat);
            final int bufferSize = minBuf > 0 ? minBuf : 4096;

            String fileName = "pcm_" + System.currentTimeMillis() + ".pcm";
            pcmRecordingPath = new File(recordingsDir, fileName).getAbsolutePath();

            audioRecord = new AudioRecord(MediaRecorder.AudioSource.MIC, sampleRate, channelConfig, audioFormat, bufferSize);
            audioRecord.startRecording();
            isPcmRecording = true;

            final String finalPcmPath = pcmRecordingPath;
            pcmRecordingThread = new Thread(() -> {
                try (FileOutputStream fos = new FileOutputStream(finalPcmPath)) {
                    byte[] buffer = new byte[bufferSize];
                    while (isPcmRecording) {
                        int read = audioRecord.read(buffer, 0, buffer.length);
                        if (read > 0) fos.write(buffer, 0, read);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "PCM recording error", e);
                }
            });
            pcmRecordingThread.start();

            Log.i(TAG, "PCM recording started: " + pcmRecordingPath);
            return pcmRecordingPath;
        } catch (Exception e) {
            Log.e(TAG, "Failed to start PCM recording", e);
            pcmRecordingPath = null;
            return "";
        }
    }

    /**
     * 停止 PCM 录制并返回文件路径
     */
    public String stopPcmRecording() {
        if (!isPcmRecording || audioRecord == null) {
            Log.w(TAG, "Not PCM recording");
            return "";
        }
        String result = "";
        try {
            isPcmRecording = false;
            if (pcmRecordingThread != null) {
                pcmRecordingThread.join(500);
            }
            audioRecord.stop();
            result = pcmRecordingPath != null ? pcmRecordingPath : "";
            Log.i(TAG, "PCM recording saved: " + result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop PCM recording", e);
        } finally {
            try { audioRecord.release(); } catch (Exception ignored) {}
            audioRecord = null;
            pcmRecordingPath = null;
        }
        return result;
    }

    /**
     * 将 PCM 数据写入 WAV 文件
     */
    public static File pcmToWav(byte[] pcmData, File outputFile) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(outputFile)) {
            int dataSize = pcmData.length;
            int sampleRate = 16000;
            int channels = 1;
            int bitsPerSample = 16;

            // WAV header (44 bytes)
            writeWavHeader(fos, dataSize, sampleRate, channels, bitsPerSample);
            fos.write(pcmData);
        }
        return outputFile;
    }

    private static void writeWavHeader(FileOutputStream fos, int dataSize,
                                        int sampleRate, int channels, int bitsPerSample)
            throws IOException {
        int byteRate = sampleRate * channels * bitsPerSample / 8;
        int blockAlign = channels * bitsPerSample / 8;
        int totalSize = 36 + dataSize;

        writeLE(fos, "RIFF".getBytes());           // ChunkID
        writeIntLE(fos, totalSize);                 // ChunkSize
        writeLE(fos, "WAVE".getBytes());            // Format
        writeLE(fos, "fmt ".getBytes());            // Subchunk1ID
        writeIntLE(fos, 16);                        // Subchunk1Size (PCM)
        writeShortLE(fos, (short) 1);               // AudioFormat (PCM)
        writeShortLE(fos, (short) channels);
        writeIntLE(fos, sampleRate);
        writeIntLE(fos, byteRate);
        writeShortLE(fos, (short) blockAlign);
        writeShortLE(fos, (short) bitsPerSample);
        writeLE(fos, "data".getBytes());            // Subchunk2ID
        writeIntLE(fos, dataSize);                  // Subchunk2Size
    }

    private static void writeLE(FileOutputStream fos, byte[] data) throws IOException {
        fos.write(data);
    }

    private static void writeIntLE(FileOutputStream fos, int value) throws IOException {
        fos.write(value & 0xFF);
        fos.write((value >> 8) & 0xFF);
        fos.write((value >> 16) & 0xFF);
        fos.write((value >> 24) & 0xFF);
    }

    private static void writeShortLE(FileOutputStream fos, short value) throws IOException {
        fos.write(value & 0xFF);
        fos.write((value >> 8) & 0xFF);
    }

    /**
     * 释放资源
     */
    public void release() {
        stopAudio();
        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
                textToSpeech.shutdown();
            } catch (Exception ignored) {}
            textToSpeech = null;
            ttsReady = false;
        }
        if (mediaRecorder != null) {
            try {
                mediaRecorder.release();
            } catch (Exception ignored) {}
            mediaRecorder = null;
        }
        isRecording = false;
        abandonAudioFocus();
    }
}
