/**
 * image-size.utils.ts — 文生图尺寸 / 宽高比工具
 *
 * 环境变量说明：
 * - WANX_IMAGE_SIZE：直接指定 size（如 "2048*2048"），优先级最高，设此值后 IMAGE_ASPECT 不生效
 * - IMAGE_ASPECT：预设宽高比别名或自定义比值，仅在 WANX_IMAGE_SIZE 未设置时生效
 *   支持值：
 *     - "a4" 或 "a4_portrait" → A4 肖像 (210:297, ISO A 系列 1:√2)
 *     - "a4_landscape"       → A4 横版 (297:210)
 *     - "a5" 或 "a5_portrait" → A5 肖像 (148:210, 与 A4 同比例)
 *     - "a5_landscape"       → A5 横版 (210:148)
 *     - "square"             → 1:1 正方形（默认）
 *     - 自定义数字字符串（如 "1.414"）→ 按该比值计算（>1 = 宽>高, <1 = 高>宽）
 *
 * DashScope qwen-image-2.0-pro / wan2.7 像素约束：
 *   总像素 ≥ 512×512, ≤ 2048×2048
 *   引擎最终调整到 16 的倍数
 */

const MAX_TOTAL_PX = 2048 * 2048; // 4,194,304
const ROUND_MULTIPLE = 16;

export type AspectAlias = 'a4' | 'a4_portrait' | 'a4_landscape' | 'a5' | 'a5_portrait' | 'a5_landscape' | 'square';

/**
 * aspect-ratio 预设表：key → (widthRatio, heightRatio)
 * 所有 ISO A 系列 (A4/A5) 比例相同：1:√2
 */
const ASPECT_PRESETS: Record<AspectAlias, [number, number]> = {
  a4:           [210, 297], // A4 portrait, 1:√2
  a4_portrait:  [210, 297],
  a4_landscape: [297, 210],
  a5:           [148, 210], // A5 portrait, 1:√2
  a5_portrait:  [148, 210],
  a5_landscape: [210, 148],
  square:       [1,   1],
};

function parseAspectRatio(input: string): number {
  const trimmed = input.trim().toLowerCase();
  // 先尝试匹配预设别名
  if (trimmed in ASPECT_PRESETS) {
    const [w, h] = ASPECT_PRESETS[trimmed as AspectAlias];
    return w / h;
  }
  // 尝试解析为浮点数比值
  const ratio = parseFloat(trimmed);
  if (!isNaN(ratio) && ratio > 0) return ratio;
  // 尝试解析 "w:h" 格式
  const colonMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
  if (colonMatch) {
    return parseFloat(colonMatch[1]) / parseFloat(colonMatch[2]);
  }
  // fallback
  return 1;
}

/**
 * 取不小于 n 的 ROUND_MULTIPLE 的倍数
 */
function ceilMultiple(n: number): number {
  return Math.ceil(n / ROUND_MULTIPLE) * ROUND_MULTIPLE;
}

/**
 * 取不大于 n 的 ROUND_MULTIPLE 的倍数
 */
function floorMultiple(n: number): number {
  return Math.floor(n / ROUND_MULTIPLE) * ROUND_MULTIPLE;
}

/**
 * 根据 IMAGE_ASPECT / WANX_IMAGE_SIZE 环境变量解析最终图片尺寸。
 *
 * @param envOverrides - 可由各 adapter 传入 process.env 或其子集，方便测试
 * @returns "width*height" 格式的字符串，如 "1712*2432"
 */
export function resolveImageSize(
  envOverrides?: Record<string, string | undefined>,
): string {
  const env = envOverrides ?? process.env;

  // 1. 显式指定 WANX_IMAGE_SIZE 直接返回
  const explicitSize = env.WANX_IMAGE_SIZE?.trim();
  if (explicitSize) return explicitSize;

  // 2. 读取 IMAGE_ASPECT
  const aspectRaw = env.IMAGE_ASPECT?.trim();
  if (!aspectRaw) {
    // 没有设置任何尺寸相关环境变量 → 返回空，由调用者使用其内置默认值
    return '';
  }

  const ratio = parseAspectRatio(aspectRaw);

  // 在总像素 ≤ MAX_TOTAL_PX 的约束下，找到最大的 W×H 满足 W/H = ratio，
  // 且 W,H 均为 ROUND_MULTIPLE 的倍数。
  //
  //   W × H ≤ MAX_TOTAL_PX   其中 H = W / ratio  或  W = H × ratio
  //   W × (W / ratio) ≤ MAX_TOTAL_PX
  //   W² ≤ MAX_TOTAL_PX × ratio
  //   W ≤ sqrt(MAX_TOTAL_PX × ratio)
  //
  // 但 ratio > 0 可能 <1 (portrait) 或 >1 (landscape)
  // 设更大的边为 long，更小的边为 short

  const maxPx = MAX_TOTAL_PX;

  // ratio = w / h，即宽是高的 ratio 倍
  // 如果 ratio ≥ 1：宽 ≥ 高 (landscape or square)
  // 如果 ratio < 1：宽 < 高 (portrait)
  if (ratio >= 1) {
    // landscape: W ≥ H
    // W² / ratio ≤ maxPx
    const w = Math.sqrt(maxPx * ratio);
    const wRounded = floorMultiple(w);
    const hRounded = floorMultiple(wRounded / ratio);
    // 重新检验像素上限
    if (wRounded * hRounded > maxPx) {
      // 退一档
      const w2 = wRounded - ROUND_MULTIPLE;
      const h2 = floorMultiple(w2 / ratio);
      return `${Math.max(w2, ROUND_MULTIPLE)}*${Math.max(h2, ROUND_MULTIPLE)}`;
    }
    return `${Math.max(wRounded, ROUND_MULTIPLE)}*${Math.max(hRounded, ROUND_MULTIPLE)}`;
  } else {
    // portrait: W < H, H = W / ratio (ratio < 1)
    // W × (W / ratio) ≤ maxPx
    // W² ≤ maxPx × ratio
    // W ≤ sqrt(maxPx × ratio)
    const w = Math.sqrt(maxPx * ratio);
    const wRounded = floorMultiple(w);
    const hRounded = floorMultiple(wRounded / ratio);
    if (wRounded * hRounded > maxPx) {
      const w2 = wRounded - ROUND_MULTIPLE;
      const h2 = floorMultiple(w2 / ratio);
      return `${Math.max(w2, ROUND_MULTIPLE)}*${Math.max(h2, ROUND_MULTIPLE)}`;
    }
    return `${Math.max(wRounded, ROUND_MULTIPLE)}*${Math.max(hRounded, ROUND_MULTIPLE)}`;
  }
}

/**
 * 纯函数版本，不依赖环境变量。
 * @param aspectAlias 预设别名或自定义比值字符串
 * @param defaultSize 解析失败时的回退值
 * @returns "width*height"
 */
export function resolveImageSizeFromAspect(
  aspectAlias: string | undefined,
  defaultSize: string = '2048*2048',
): string {
  if (!aspectAlias) return defaultSize;
  const ratio = parseAspectRatio(aspectAlias);
  if (ratio === 1) return defaultSize;

  const maxPx = MAX_TOTAL_PX;
  if (ratio >= 1) {
    const w = Math.sqrt(maxPx * ratio);
    const wR = floorMultiple(w);
    const hR = floorMultiple(wR / ratio);
    return `${Math.max(wR, ROUND_MULTIPLE)}*${Math.max(hR, ROUND_MULTIPLE)}`;
  } else {
    const w = Math.sqrt(maxPx * ratio);
    const wR = floorMultiple(w);
    const hR = floorMultiple(wR / ratio);
    return `${Math.max(wR, ROUND_MULTIPLE)}*${Math.max(hR, ROUND_MULTIPLE)}`;
  }
}
