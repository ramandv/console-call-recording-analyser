import { GoogleGenerativeAI } from '@google/generative-ai';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TranscriptionProvider, TranscriptionResult } from './base-provider';

export interface GeminiConfig {
  model?: string; // Default: 'gemini-2.0-flash-lite'
}

export class GeminiProvider implements TranscriptionProvider {
  name = 'gemini';
  private config: Required<GeminiConfig>;

  constructor(config: GeminiConfig = {}) {
    this.config = {
      model: config.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite'
    };
  }

  async transcribeFile(filePath: string, txtPath: string): Promise<TranscriptionResult> {
    console.log('🚀 GEMINI TRANSCRIPTION STARTED');
    console.log(`📁 File: ${path.basename(filePath)}`);
    console.log(`📂 Output: ${path.basename(txtPath)}`);

    try {
      console.log('🔄 Preparing Gemini transcription request...');

      // Get Gemini API key
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error('Gemini API key not provided. Set GEMINI_API_KEY environment variable');
      }

      const fileExt = path.extname(filePath).toLowerCase();
      console.log(`📁 Processing file: ${path.basename(filePath)}`);
      console.log(`🎵 File format: ${fileExt}`);

      // Read the audio file
      console.log(`📖 Reading audio file...`);
      const audioBuffer = await fs.readFile(filePath);
      console.log(`✅ File read successfully, size: ${audioBuffer.length} bytes`);

      const fileSize = (audioBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`📏 File size: ${fileSize} MB`);

      // Initialize Gemini
      console.log('💎 Initializing Gemini client...');
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: this.config.model });
      console.log(`✅ Gemini ${this.config.model} initialized`);

      // Convert audio buffer to base64
      const audioBase64 = audioBuffer.toString('base64');
      const mimeType = this.getMimeType(fileExt);

      console.log('🎙️ Sending request to Gemini API...');
      console.log('⏳ Processing audio file...');

      // Create the prompt for both transcription and summary in one request
      const prompt = `This is a phone call recording between a customer care representative and a customer. Please transcribe this audio file and provide a summary. Identify speakers as "Speaker 1" (customer care representative) and "Speaker 2" (customer). Format your response as follows:

SUMMARY:
[Provide a concise summary of the key points, decisions, and important information from the conversation]

TRANSCRIPTION:
[Provide the full transcription with speaker identification (Speaker 1/Speaker 2), proper punctuation and formatting]`;

      // Generate content with audio
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: audioBase64
          }
        },
        prompt
      ]);

      console.log('✅ Received response from Gemini API');

      const response = await result.response;
      const fullResponse = response.text();

      if (!fullResponse.trim()) {
        console.warn('⚠️  No response received from Gemini');
        console.log('💡 This could mean:');
        console.log('   - No speech detected in the audio');
        console.log('   - Audio quality is too low');
        console.log('   - Unsupported audio format');
        await fs.writeFile(txtPath, '[No speech detected]', 'utf8');
      } else {
        console.log(`💾 Saving transcription to: ${txtPath}`);

        // Parse the response to extract summary and transcription
        const summaryMatch = fullResponse.match(/SUMMARY:\s*(.*?)(?=TRANSCRIPTION:|$)/s);
        const transcriptionMatch = fullResponse.match(/TRANSCRIPTION:\s*(.*)/s);

        let summary = summaryMatch ? summaryMatch[1].trim() : 'Summary not available';
        let transcription = transcriptionMatch ? transcriptionMatch[1].trim() : fullResponse.trim();

        // If no clear sections found, treat the whole response as transcription
        if (!summaryMatch && !transcriptionMatch) {
          transcription = fullResponse.trim();
          summary = 'Summary not available - response format unclear';
        }

        // Format the final content
        const finalContent = `📋 SUMMARY:\n${summary}\n\n${'='.repeat(80)}\n\n🎙️ FULL TRANSCRIPTION:\n${transcription}`;

        console.log(`📄 Response preview: ${fullResponse.substring(0, 200)}${fullResponse.length > 200 ? '...' : ''}`);
        await fs.writeFile(txtPath, finalContent, 'utf8');
        console.log(`✅ Successfully saved transcription with summary to ${txtPath}`);
      }

      // Get duration for return value
      const duration = await this.getAudioDuration(filePath);
      console.log(`⏱️  Audio duration: ${duration || 'N/A'}`);
      return { duration: duration || 'N/A' };

    } catch (error: unknown) {
      console.error(`❌ Failed to transcribe ${filePath} with Gemini`);
      console.error('🔍 Error details:');

      if (error instanceof Error) {
        console.error(`   Message: ${error.message}`);

        // Provide specific guidance based on error type
        if (error.message.includes('API_KEY_INVALID') || error.message.includes('PERMISSION_DENIED')) {
          console.error('   💡 Solution: Check your Gemini API key');
          console.error('   💡 Make sure GEMINI_API_KEY is set correctly');
        } else if (error.message.includes('FILE_TOO_LARGE')) {
          console.error('   💡 Solution: Audio file is too large for Gemini');
          console.error('   💡 Try a smaller file or use another service');
        } else if (error.message.includes('UNSUPPORTED_FORMAT')) {
          console.error('   💡 Solution: Check audio format');
          console.error('   💡 Gemini supports: MP3, WAV, MP4, M4A, FLAC, OGG, AMR');
        } else if (error.message.includes('QUOTA_EXCEEDED')) {
          console.error('   💡 Solution: You may have exceeded your quota limits');
        }
      } else {
        console.error(`   Unknown error: ${String(error)}`);
      }

      // Try to create a basic error transcription file
      try {
        const errorMessage = `[Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}]`;
        await fs.writeFile(txtPath, errorMessage, 'utf8');
        console.log(`💾 Saved error message to: ${txtPath}`);
      } catch (writeError) {
        console.error('❌ Could not write error message to file');
        console.error(`   Write error: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
      }

      return { duration: 'N/A' };
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

  private async getAudioDuration(filePath: string): Promise<string | null> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      // Use FFmpeg to get duration
      const ffmpegCommand = `"${require('ffmpeg-static')}" -i "${filePath}" 2>&1 | grep "Duration" | cut -d ' ' -f 4 | sed s/,//`;

      const { stdout } = await execAsync(ffmpegCommand);
      const duration = stdout.trim();

      if (duration) {
        // Convert HH:MM:SS.ms format to just HH:MM:SS
        return duration.split('.')[0];
      }

      return null;
    } catch (error) {
      console.warn(`⚠️  Could not get duration for ${filePath}`);
      return null;
    }
  }
}
