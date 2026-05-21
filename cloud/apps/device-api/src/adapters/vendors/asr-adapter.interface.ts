export type AsrAdapterInput = {
  jobId: string;
  contentMode: string;
  audioBase64?: string | null;
  audioPresignedUrl?: string | null;
};

/**
 * 语音识别上游抽象。返回 **非空字符串** 表示成功；`null` 表示本适配器未启用或无可识别结果，
 * 由 {@link VendorFacadeService} 决定是否回退到桩或其它策略。
 */
export interface AsrAdapter {
  transcribe(input: AsrAdapterInput): Promise<string | null>;

  /** 是否使用「关采音后上云」路径（例如需要预签名 URL 给上游拉音频）。 */
  usesAudioStaging(): boolean;
}
