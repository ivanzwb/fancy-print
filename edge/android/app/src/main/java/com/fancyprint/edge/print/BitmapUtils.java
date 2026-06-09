package com.fancyprint.edge.print;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;

/**
 * BitmapUtils — Bitmap manipulation utilities for printer image preparation
 *
 * Ported from com.lingmoyun.util.BitmapUtils (lingmoyun printer-demo-android)
 */
public final class BitmapUtils {

    private BitmapUtils() {}

    /**
     * Convert millimeters to pixels at given DPI
     *
     * @param mm  millimeters
     * @param dpi dots per inch (203 or 300)
     * @return pixels (dots)
     */
    public static int mm2px(int mm, int dpi) {
        return (int) (mm * dpi / 25.4f);
    }

    /**
     * Scale bitmap proportionally to fit within target dimensions
     *
     * @param src    source bitmap
     * @param width  target width in pixels
     * @param height target height in pixels
     * @return scaled bitmap (recycles src if scale ratio differs)
     */
    public static Bitmap scale(Bitmap src, int width, int height) {
        int w = src.getWidth();
        int h = src.getHeight();

        float widthScale = ((float) width) / w;
        float heightScale = ((float) height) / h;
        float scale = Math.min(widthScale, heightScale);

        Matrix matrix = new Matrix();
        matrix.postScale(scale, scale);

        return Bitmap.createBitmap(src, 0, 0, w, h, matrix, true);
    }

    /**
     * Apply Floyd-Steinberg dithering for better black-and-white image quality
     * on thermal printers.
     *
     * @param src source bitmap (any config)
     * @return dithered black-and-white bitmap
     */
    public static Bitmap floydSteinberg(Bitmap src) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), src.getConfig());

        int pixel;
        int threshold = 128;

        int width = src.getWidth();
        int height = src.getHeight();
        int error;
        int[][] errors = new int[width][height];
        for (int y = 0; y < height - 1; y++) {
            for (int x = 1; x < width - 1; x++) {

                pixel = src.getPixel(x, y);

                int alpha = Color.alpha(pixel);
                int red = Color.red(pixel);
                int green = Color.green(pixel);
                int blue = Color.blue(pixel);

                int grayC = (int) (0.21 * red + 0.72 * green + 0.07 * blue);
                int gray = grayC;
                if (gray + errors[x][y] < threshold) {
                    error = gray + errors[x][y];
                    gray = 0;
                } else {
                    error = gray + errors[x][y] - 255;
                    gray = 255;
                }
                errors[x + 1][y] += (7 * error) / 16;
                errors[x - 1][y + 1] += (3 * error) / 16;
                errors[x][y + 1] += (5 * error) / 16;
                errors[x + 1][y + 1] += (1 * error) / 16;

                out.setPixel(x, y, Color.argb(alpha, gray, gray, gray));
            }
        }

        return out;
    }
}
