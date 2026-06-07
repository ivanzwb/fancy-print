package com.fancyprint.edge.asr;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.mockito.junit.MockitoJUnitRunner;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import static org.junit.Assert.*;

/**
 * SherpaAsrService 单元测试
 *
 * 测试 PCM 数据处理、文件校验逻辑（不依赖 Sherpa-ONNX native 库）
 */
@RunWith(MockitoJUnitRunner.class)
public class SherpaAsrServiceTest {

    @Mock
    private Context mockContext;

    @Mock
    private AssetManager mockAssetManager;

    private File tempDir;

    @Before
    public void setUp() throws IOException {
        MockitoAnnotations.openMocks(this);
        // 创建临时目录存放测试 PCM 文件
        tempDir = new File(System.getProperty("java.io.tmpdir"), "sherpa_test_" + System.currentTimeMillis());
        tempDir.mkdirs();
    }

    // ============================================================
    // transcribePcmFile — 输入校验
    // ============================================================

    @Test
    public void transcribePcmFile_fileNotFound_returnsEmpty() {
        // Model not loaded → returns empty (not testing native library in unit test)
        SherpaAsrService service = new SherpaAsrService(mockContext);
        String result = service.transcribePcmFile("/nonexistent/file.pcm");
        assertEquals("", result);
    }

    @Test
    public void transcribePcmFile_modelNotLoaded_returnsEmpty() throws IOException {
        // 创建一个有效的 PCM 文件
        File pcmFile = createPcmFile("test.pcm", 16000); // 1 秒 16kHz mono 16bit

        SherpaAsrService service = new SherpaAsrService(mockContext);
        String result = service.transcribePcmFile(pcmFile.getAbsolutePath());
        // 模型未加载 → 返回空
        assertEquals("", result);
    }

    @Test
    public void transcribePcmFile_tooShort_returnsEmpty() throws IOException {
        // 创建太短的 PCM（< 0.1 秒 → < 1600 bytes）
        File shortPcm = createPcmFile("short.pcm", 800); // 仅 800 samples

        SherpaAsrService service = new SherpaAsrService(mockContext);
        String result = service.transcribePcmFile(shortPcm.getAbsolutePath());
        assertEquals("", result);
    }

    // ============================================================
    // isLoaded — 状态
    // ============================================================

    @Test
    public void isLoaded_initiallyFalse() {
        SherpaAsrService service = new SherpaAsrService(mockContext);
        assertFalse(service.isLoaded());
    }

    @Test
    public void loadModel_withoutAssets_doesNotCrash() {
        // 加载模型时 assets 没有模型文件 → 不应崩溃
        SherpaAsrService service = new SherpaAsrService(mockContext);
        try {
            service.loadModel();
            // 没有模型文件时 isLoaded 应为 false
            assertFalse(service.isLoaded());
        } catch (Exception e) {
            fail("loadModel should not throw: " + e.getMessage());
        }
    }

    @Test
    public void release_setsNotLoaded() {
        SherpaAsrService service = new SherpaAsrService(mockContext);
        service.release();
        assertFalse(service.isLoaded());
    }

    // ============================================================
    // PCM byte → float 转换逻辑验证
    // ============================================================

    @Test
    public void pcmByteToFloat_zeroIsZero() {
        byte[] pcm = shortToBytes((short) 0);
        float[] samples = pcmBytesToFloat(pcm);
        assertEquals(0.0f, samples[0], 0.0001f);
    }

    @Test
    public void pcmByteToFloat_maxPositive() {
        byte[] pcm = shortToBytes(Short.MAX_VALUE); // 32767
        float[] samples = pcmBytesToFloat(pcm);
        assertEquals(32767.0f / 32768.0f, samples[0], 0.0001f);
    }

    @Test
    public void pcmByteToFloat_maxNegative() {
        byte[] pcm = shortToBytes(Short.MIN_VALUE); // -32768
        float[] samples = pcmBytesToFloat(pcm);
        assertEquals(-1.0f, samples[0], 0.0001f);
    }

    @Test
    public void pcmByteToFloat_multipleSamples() {
        short[] input = {0, 16384, -16384, 32767, -32768};
        byte[] pcm = new byte[input.length * 2];
        ByteBuffer buf = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN);
        for (short s : input) buf.putShort(s);

        float[] samples = pcmBytesToFloat(pcm);
        assertEquals(input.length, samples.length);
        assertEquals(0.0f, samples[0], 0.0001f);
        assertEquals(0.5f, samples[1], 0.0001f);
        assertEquals(-0.5f, samples[2], 0.0001f);
    }

    // ============================================================
    // Helpers
    // ============================================================

    /**
     * 创建指定采样数的假 PCM 文件（16kHz, 16-bit, mono）
     */
    private File createPcmFile(String name, int sampleCount) throws IOException {
        File file = new File(tempDir, name);
        byte[] silence = new byte[sampleCount * 2]; // 2 bytes per sample
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(silence);
        }
        return file;
    }

    private byte[] shortToBytes(short value) {
        return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value).array();
    }

    /**
     * 复制 SherpaAsrService 中的 PCM→float 转换逻辑用于验证
     */
    static float[] pcmBytesToFloat(byte[] pcmBytes) {
        int sampleCount = pcmBytes.length / 2;
        float[] samples = new float[sampleCount];
        ByteBuffer byteBuf = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < sampleCount; i++) {
            samples[i] = byteBuf.getShort(i * 2) / 32768.0f;
        }
        return samples;
    }
}
