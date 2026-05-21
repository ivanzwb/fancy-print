/** 与 doc/4 §4.1 对齐的轮询推进流水线；`failed` 为终态。 */
export type JobState =
  | 'created'
  | 'audio_received'
  | 'asr_complete'
  | 'moderation_passed'
  | 'image_generation'
  | 'preview_ready'
  | 'failed'
  | 'print_acknowledged';

export interface JobRecord {
  job_id: string;
  device_id: string;
  content_mode: string;
  child_profile_id?: string;
  policy_version?: number;
  state: JobState;
  created_at: string;
  updated_at: string;
  transcript?: string | null;
  /** 分片上传时：已接受的最大 `seq`（`created` 态）。 */
  chunks_max_seq?: number;
  /** 整段关采音后的 base64（由各分片解码拼接后再编码）。无 `S3_AUDIO_BUCKET` 时回退到此字段。 */
  audio_base64?: string;
  /** `S3_AUDIO_BUCKET` 已配置时，音频 upload 后存储的 S3 key（替代 `audio_base64` 以避免内存常驻大字符串）。 */
  audio_s3_key?: string;
  /** 与 `audio_s3_key` 对应的桶名（冗余，供生成预签名 URL 用）。 */
  audio_s3_bucket?: string;
  /** `seq` → base64 片段（仅存于 `created` 态）。 */
  audio_chunk_buffers?: Record<string, string>;
  /** 生图档完成后、定稿预览前：中间态（不应对外长期暴露）。 */
  pending_preview_image_url?: string;
  pending_preview_image_base64?: string;
  preview_url?: string;
  preview_url_expires_at?: string;
  error_code?: string;
  print_ack_at?: string;
}
