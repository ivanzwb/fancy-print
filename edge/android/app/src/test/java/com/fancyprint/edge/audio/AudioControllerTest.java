package com.fancyprint.edge.audio;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;

import android.content.Context;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import static org.junit.Assert.*;

/**
 * AudioController 单元测试
 *
 * 测试 WAV 头写入、PCM 文件路径管理（不依赖 Android 硬件录音）
 */
@RunWith(MockitoJUnitRunner.class)
public class AudioControllerTest {

    @Mock
    private Context mockContext;

    private File tempDir;

    @Before
    public void setUp() {
        tempDir = new File(System.getProperty("java.io.tmpdir"), "audio_test_" + System.currentTimeMillis());
        tempDir.mkdirs();
    }

    // ============================================================
    // pcmToWav — WAV 文件头写入
    // ============================================================

    @Test
    public void pcmToWav_producesValidWavHeader() throws IOException {
        byte[] pcmData = generateSilentPcm(16000); // 1 秒静音

        File wavFile = new File(tempDir, "test.wav");
        AudioController.pcmToWav(pcmData, wavFile);

        // 验证 WAV 文件存在且大于 header 大小
        assertTrue(wavFile.exists());
        assertTrue(wavFile.length() > 44); // 44 byte header + data

        // 验证 WAV 头
        try (FileInputStream fis = new FileInputStream(wavFile)) {
            byte[] header = new byte[44];
            int read = fis.read(header);
            assertEquals(44, read);

            // RIFF chunk
            assertEquals('R', header[0]);
            assertEquals('I', header[1]);
            assertEquals('F', header[2]);
            assertEquals('F', header[3]);

            // WAVE format
            assertEquals('W', header[8]);
            assertEquals('A', header[9]);
            assertEquals('V', header[10]);
            assertEquals('E', header[11]);

            // fmt subchunk
            assertEquals('f', header[12]);
            assertEquals('m', header[13]);
            assertEquals('t', header[14]);
            assertEquals(' ', header[15]);

            // AudioFormat: PCM = 1
            assertEquals(1, readShortLE(header, 20));
            // Channels: mono = 1
            assertEquals(1, readShortLE(header, 22));
            // SampleRate: 16000
            assertEquals(16000, readIntLE(header, 24));
            // BitsPerSample: 16
            assertEquals(16, readShortLE(header, 34));

            // data subchunk
            assertEquals('d', header[36]);
            assertEquals('a', header[37]);
            assertEquals('t', header[38]);
            assertEquals('a', header[39]);

            // data size should equal PCM data length
            int dataSize = readIntLE(header, 40);
            assertEquals(pcmData.length, dataSize);
        }
    }

    @Test
    public void pcmToWav_totalSizeMatches() throws IOException {
        byte[] pcmData = new byte[32000]; // 1 秒
        File wavFile = new File(tempDir, "size_test.wav");
        AudioController.pcmToWav(pcmData, wavFile);

        // Total file size = 44 (header) + data length
        long expectedSize = 44L + pcmData.length;
        assertEquals(expectedSize, wavFile.length());
    }

    @Test
    public void pcmToWav_emptyData() throws IOException {
        byte[] pcmData = new byte[0];
        File wavFile = new File(tempDir, "empty.wav");
        AudioController.pcmToWav(pcmData, wavFile);

        assertTrue(wavFile.exists());
        assertEquals(44, wavFile.length()); // Only header
    }

    @Test(expected = IOException.class)
    public void pcmToWav_invalidOutputPath() throws IOException {
        byte[] pcmData = new byte[1600];
        File invalidFile = new File("/nonexistent/path/test.wav");
        AudioController.pcmToWav(pcmData, invalidFile);
    }

    // ============================================================
    // Helper
    // ============================================================

    private byte[] generateSilentPcm(int sampleCount) {
        return new byte[sampleCount * 2]; // 16-bit = 2 bytes per sample, all zeros = silence
    }

    private static int readIntLE(byte[] data, int offset) {
        return ByteBuffer.wrap(data, offset, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
    }

    private static short readShortLE(byte[] data, int offset) {
        return ByteBuffer.wrap(data, offset, 2).order(ByteOrder.LITTLE_ENDIAN).getShort();
    }
}
