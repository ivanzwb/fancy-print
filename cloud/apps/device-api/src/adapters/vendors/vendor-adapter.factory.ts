import type { AsrAdapter } from './asr-adapter.interface';
import { BaiduAsrAdapter } from './baidu-asr.adapter';
import { IflytekIatAsrAdapter } from './iflytek-iat-asr.adapter';
import { StubAsrAdapter } from './stub-asr.adapter';
import type { ImageGenAdapter } from './image-gen-adapter.interface';
import { BaiduWenxinImageGenAdapter } from './baidu-wenxin-image-gen.adapter';
import { StubImageGenAdapter } from './stub-image-gen.adapter';
import { TongyiWanxiangImageGenAdapter } from './tongyi-wanxiang-image-gen.adapter';
import { QwenImageSyncAdapter } from './qwen-image-sync.adapter';

/** `ASR_DRIVER`：`auto`（默认）| `iflytek` | `baidu` | `stub`。`auto`：优先 iflytek → baidu → 桩。 */
export function createAsrAdapter(
  iflytek: IflytekIatAsrAdapter,
  baidu: BaiduAsrAdapter,
  stub: StubAsrAdapter,
): AsrAdapter {
  const d = (process.env.ASR_DRIVER ?? 'auto').trim().toLowerCase();
  console.log('[AdapterFactory] ASR driver selection: ASR_DRIVER=' + d);
  if (d === 'stub') return stub;
  if (d === 'iflytek') return iflytek;
  if (d === 'baidu') return baidu;
  if (d === 'auto' || d === '') {
    if (iflytek.isConfigured()) { console.log('[AdapterFactory] ASR: using iflytek'); return iflytek; }
    if (baidu.isConfigured()) { console.log('[AdapterFactory] ASR: using baidu'); return baidu; }
    console.log('[AdapterFactory] ASR: using stub (none configured)');
    return stub;
  }
  console.log('[AdapterFactory] ASR: unknown driver "' + d + '"');
  return stub;
}

/** IMAGE_GEN_DRIVER: `auto` (default) | `tongyi` | `baidu` | `stub`. `auto`: tongyi → baidu → stub. */
export function createImageGenAdapter(
  tongyi: TongyiWanxiangImageGenAdapter,
  qwenSync: QwenImageSyncAdapter,
  baidu: BaiduWenxinImageGenAdapter,
  stub: StubImageGenAdapter,
): ImageGenAdapter {
  const d = (process.env.IMAGE_GEN_DRIVER ?? 'auto').trim().toLowerCase();
  const model = (process.env.WANX_MODEL ?? '').trim();
  const isQwenSyncModel = model.startsWith('qwen-image-');
  
  console.log('[AdapterFactory] IMAGE GEN driver selection: IMAGE_GEN_DRIVER=' + d + ', WANX_MODEL=' + model);
  
  if (d === 'stub') { console.log('[AdapterFactory] IMAGE GEN: using stub'); return stub; }
  
  if (d === 'tongyi') {
    if (isQwenSyncModel) {
      console.log('[AdapterFactory] qwen-sync configured=' + qwenSync.isConfigured());
      if (qwenSync.isConfigured()) { console.log('[AdapterFactory] IMAGE GEN: using qwen-sync'); return qwenSync; }
    } else {
      console.log('[AdapterFactory] tongyi configured=' + tongyi.isConfigured());
      if (tongyi.isConfigured()) { console.log('[AdapterFactory] IMAGE GEN: using tongyi'); return tongyi; }
    }
    console.log('[AdapterFactory] IMAGE GEN: tongyi NOT configured, falling back to stub');
    return stub;
  }
  
  if (d === 'baidu') {
    console.log('[AdapterFactory] baidu configured=' + baidu.isConfigured());
    if (baidu.isConfigured()) { console.log('[AdapterFactory] IMAGE GEN: using baidu'); return baidu; }
    console.log('[AdapterFactory] IMAGE GEN: baidu NOT configured, falling back to stub');
    return stub;
  }
  
  if (d === 'auto' || d === '') {
    if (isQwenSyncModel && qwenSync.isConfigured()) { 
      console.log('[AdapterFactory] IMAGE GEN (auto): using qwen-sync'); 
      return qwenSync; 
    }
    if (tongyi.isConfigured()) { console.log('[AdapterFactory] IMAGE GEN (auto): using tongyi'); return tongyi; }
    if (baidu.isConfigured()) { console.log('[AdapterFactory] IMAGE GEN (auto): using baidu'); return baidu; }
    console.log('[AdapterFactory] IMAGE GEN (auto): using stub (none configured)');
    return stub;
  }
  
  console.log('[AdapterFactory] IMAGE GEN: unknown driver "' + d + '"');
  return stub;
}
