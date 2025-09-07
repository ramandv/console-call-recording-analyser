import { promises as fs } from 'fs';
import * as path from 'path';
import { AnalysisProvider, AnalysisResult } from './base-analysis';

export class BasicAnalysisProvider implements AnalysisProvider {
  name = 'basic-analysis';

  async analyzeTranscription(transcriptionPath: string): Promise<AnalysisResult> {
    console.log(`🔍 Analyzing transcription: ${path.basename(transcriptionPath)}`);

    try {
      // Read the transcription file
      const transcriptionContent = await fs.readFile(transcriptionPath, 'utf8');

      // Basic analysis - extract key information
      const lines = transcriptionContent.split('\n').filter(line => line.trim());
      const wordCount = transcriptionContent.split(/\s+/).length;

      // Simple sentiment analysis (basic keyword matching)
      const positiveWords = ['thank', 'great', 'excellent', 'good', 'happy', 'satisfied'];
      const negativeWords = ['problem', 'issue', 'complaint', 'disappointed', 'angry', 'frustrated'];

      let positiveScore = 0;
      let negativeScore = 0;

      const lowerContent = transcriptionContent.toLowerCase();
      positiveWords.forEach(word => {
        const matches = (lowerContent.match(new RegExp(word, 'g')) || []).length;
        positiveScore += matches;
      });

      negativeWords.forEach(word => {
        const matches = (lowerContent.match(new RegExp(word, 'g')) || []).length;
        negativeScore += matches;
      });

      let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (positiveScore > negativeScore) sentiment = 'positive';
      if (negativeScore > positiveScore) sentiment = 'negative';

      // Extract key points (simple sentence extraction)
      const sentences = transcriptionContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const keyPoints = sentences.slice(0, 5).map(s => s.trim());

      // Generate summary
      const summary = `Analysis of ${path.basename(transcriptionPath)}: ${wordCount} words, ${lines.length} lines, ${sentiment} sentiment.`;

      const result: AnalysisResult = {
        summary,
        keyPoints,
        sentiment,
        metadata: {
          wordCount,
          lineCount: lines.length,
          positiveScore,
          negativeScore,
          fileName: path.basename(transcriptionPath)
        }
      };

      console.log(`✅ Analysis completed: ${wordCount} words, ${sentiment} sentiment`);
      return result;

    } catch (error) {
      console.error(`❌ Failed to analyze ${transcriptionPath}:`, error);
      throw new Error(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
