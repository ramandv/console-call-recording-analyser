export interface AnalysisResult {
  summary: string;
  keyPoints: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  duration?: string;
  metadata?: Record<string, any>;
}

export interface AnalysisProvider {
  name: string;
  analyzeTranscription(transcriptionPath: string): Promise<AnalysisResult>;
}
