export interface TranscriptionResult {
  duration: string;
}

export interface TranscriptionProvider {
  name: string;
  transcribeFile(filePath: string, txtPath: string): Promise<TranscriptionResult>;
}
