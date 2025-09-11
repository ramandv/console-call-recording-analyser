import { GoogleGenerativeAI } from '@google/generative-ai';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AnalysisProvider, AnalysisResult } from './base-analysis';

export interface GeminiAnalysisConfig {
  model?: string; // Default: 'gemini-2.0-flash-lite'
}

export class GeminiAnalysisProvider implements AnalysisProvider {
  name = 'gemini-analysis';
  private config: Required<GeminiAnalysisConfig>;

  constructor(config: GeminiAnalysisConfig = {}) {
    this.config = {
      model: config.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite'
    };
  }

  async analyzeTranscription(transcriptionPath: string): Promise<AnalysisResult> {
    console.log('🚀 GEMINI ANALYSIS STARTED');
    console.log(`📁 Audio file: ${path.basename(transcriptionPath)}`);

    try {
      console.log('🔄 Preparing Gemini analysis request...');

      // Get Gemini API key
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error('Gemini API key not provided. Set GEMINI_API_KEY environment variable');
      }

      const fileExt = path.extname(transcriptionPath).toLowerCase();
      console.log(`📁 Processing file: ${path.basename(transcriptionPath)}`);
      console.log(`🎵 File format: ${fileExt}`);

      // Read the audio file
      console.log(`📖 Reading audio file...`);
      const audioBuffer = await fs.readFile(transcriptionPath);
      console.log(`✅ File read successfully, size: ${audioBuffer.length} bytes`);

      const fileSize = (audioBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`📏 File size: ${fileSize} MB`);

      // Read the prompt.md file
      const promptPath = path.join(__dirname, 'prompt.md');
      console.log(`📖 Reading prompt file...`);
      const promptContent = await fs.readFile(promptPath, 'utf8');
      console.log(`✅ Prompt read successfully`);

      // Initialize Gemini
      console.log('💎 Initializing Gemini client...');
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: this.config.model });
      console.log(`✅ Gemini ${this.config.model} initialized`);

      // Convert audio buffer to base64
      const audioBase64 = audioBuffer.toString('base64');
      const mimeType = this.getMimeType(fileExt);

      console.log('🎙️ Sending analysis request to Gemini API...');
      console.log('⏳ Processing audio file...');

      // Generate content with audio
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: audioBase64
          }
        },
        promptContent
      ]);

      console.log('✅ Received response from Gemini API');

      const response = await result.response;
      const responseText = response.text();

      console.log(`💾 Processing analysis response...`);

      // Try to parse as JSON
      let analysisData;
      try {
        // Remove markdown code blocks if present
        const cleanedResponse = responseText.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
        analysisData = JSON.parse(cleanedResponse);
        console.log('✅ Response parsed as JSON');
      } catch (parseError) {
        console.warn('⚠️ Response is not valid JSON, treating as text');
        analysisData = { raw_response: responseText };
      }

      // Save the JSON to a file
      const jsonPath = path.join(path.dirname(transcriptionPath), path.basename(transcriptionPath, path.extname(transcriptionPath)) + '_analysis.json');
      await fs.writeFile(jsonPath, JSON.stringify(analysisData, null, 2), 'utf8');
      console.log(`✅ Analysis saved to ${jsonPath}`);

      // Extract basic info for AnalysisResult
      const summary = analysisData.next_best_action || 'Analysis completed';
      const keyPoints = analysisData.todo || [];
      const sentiment = analysisData.sentiment;

      return {
        summary,
        keyPoints,
        sentiment,
        metadata: analysisData
      };

    } catch (error: unknown) {
      console.error(`❌ Failed to analyze ${transcriptionPath} with Gemini`);
      console.error('🔍 Error details:');

      if (error instanceof Error) {
        console.error(`   Message: ${error.message}`);
      } else {
        console.error(`   Unknown error: ${String(error)}`);
      }

      // Try to create a basic error analysis file
      try {
        const errorData = { error: error instanceof Error ? error.message : 'Unknown error' };
        const jsonPath = path.join(path.dirname(transcriptionPath), path.basename(transcriptionPath, path.extname(transcriptionPath)) + '_analysis.json');
        await fs.writeFile(jsonPath, JSON.stringify(errorData, null, 2), 'utf8');
        console.log(`💾 Saved error analysis to: ${jsonPath}`);
      } catch (writeError) {
        console.error('❌ Could not write error analysis to file');
      }

      return {
        summary: 'Analysis failed',
        keyPoints: [],
        sentiment: 'neutral'
      };
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.amr': 'audio/amr'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
