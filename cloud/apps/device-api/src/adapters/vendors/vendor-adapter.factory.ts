import type { AsrAdapter } from './asr-adapter.interface';
import { IflytekIatAsrAdapter } from './iflytek-iat-asr.adapter';
import { StubAsrAdapter } from './stub-asr.adapter';
import type { ImageGenAdapter } from './image-gen-adapter.interface';
import { StubImageGenAdapter } from './stub-image-gen.adapter';
import { TongyiWanxiangImageGenAdapter } from './tongyi-wanxiang-image-gen.adapter';

/** `ASR_DRIVER`：`auto`（默认）| `iflytek` | `stub`。`auto`：有讯飞凭据 → IAT，否则桩。 */
export function createAsrAdapter(
  iflytek: IflytekIatAsrAdapter,
  stub: StubAsrAdapter,
): AsrAdapter {
  const d = (process.env.ASR_DRIVER ?? 'auto').trim().toLowerCase();
  if (d === 'stub') return stub;
  if (d === 'iflytek') return iflytek;
  if (d === 'auto' || d === '') {
    return iflytek.isConfigured() ? iflytek : stub;
  }
  return stub;
}

/** `IMAGE_GEN_DRIVER`：`auto`（默认）| `tongyi` | `stub`。`auto`：有 `DASHSCOPE_API_KEY` → 通义万相，否则桩。 */
export function createImageGenAdapter(
  tongyi: TongyiWanxiangImageGenAdapter,
  stub: StubImageGenAdapter,
): ImageGenAdapter {
  const d = (process.env.IMAGE_GEN_DRIVER ?? 'auto').trim().toLowerCase();
  if (d === 'stub') return stub;
  if (d === 'tongyi') return tongyi;
  if (d === 'auto' || d === '') {
    return tongyi.isConfigured() ? tongyi : stub;
  }
  return stub;
}
