/** Stub pipeline aligned with doc/4 §4.1 (polling advances one logical step). */
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
  /** Populated after stub ASR step (doc/4 §4.1 GET job 可读字段). */
  transcript?: string | null;
  /** Highest `seq` accepted on POST .../chunks while state is `created` (stub). */
  chunks_max_seq?: number;
  /** Optional PCM/WAV etc. base64 from `POST .../audio` (capped server-side) for ASR_HTTP_URL. */
  audio_base64?: string;
  preview_url?: string;
  preview_url_expires_at?: string;
  error_code?: string;
  print_ack_at?: string;
}
