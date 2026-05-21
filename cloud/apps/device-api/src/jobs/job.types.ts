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
  preview_url?: string;
  preview_url_expires_at?: string;
  error_code?: string;
  print_ack_at?: string;
}
