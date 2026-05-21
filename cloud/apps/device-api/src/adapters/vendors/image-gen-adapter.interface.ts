export type ImageGenAdapterInput = {
  jobId: string;
  contentMode: string;
  transcript: string;
};

export interface ImageGenAdapter {
  generate(
    input: ImageGenAdapterInput,
  ): Promise<{ imageUrl?: string; imageBase64?: string } | null>;
}
