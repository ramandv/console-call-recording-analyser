import { promises as fs } from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { TranscriptionProvider, TranscriptionResult } from './base-provider';

export class WhisperProvider implements TranscriptionProvider {
  name = 'whisper';

  async transcribeFile(filePath: string, txtPath: string, model: string = 'whisper-1', apiKey?: string): Promise<TranscriptionResult> {
    let tempWavPath: string | null = null;

    try {
      const fileExt = path.extname(filePath).toLowerCase();
      let audioFilePath = filePath;
      let audioFileBuffer: Buffer;

      if (fileExt === '.amr') {
        console.log(`🔄 Converting .amr file to WAV: ${filePath}`);
        // Convert AMR to WAV
        const conversionResult = await this.convertAmrToWav(filePath);
        tempWavPath = conversionResult.wavPath;
        audioFilePath = tempWavPath;
        audioFileBuffer = conversionResult.buffer;
        console.log(`✅ Conversion completed: ${tempWavPath}`);
      } else {
        console.log(`📖 Reading file: ${filePath}`);
        audioFileBuffer = await fs.readFile(filePath);
      }

      const fileSize = (audioFileBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`📏 File size: ${fileSize} MB`);

      console.log('🔄 Preparing Whisper transcription request...');

      // Get OpenAI API key
      const openaiApiKey = apiKey || process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OpenAI API key not provided. Use --api-key option or set OPENAI_API_KEY environment variable');
      }

      // Initialize OpenAI
      const openai = new OpenAI({
        apiKey: openaiApiKey,
      });

      // Create a file-like object for OpenAI
      const file = new File([new Uint8Array(audioFileBuffer)], path.basename(audioFilePath), {
        type: this.getMimeType(path.extname(audioFilePath))
      });

      console.log('🤖 Sending request to OpenAI Whisper API...');
      // Generate transcription using Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: model as any,
      });
      console.log('✅ Received response from OpenAI Whisper API');

      const transcriptionText = transcription.text;
      const transcriptionLength = transcriptionText.length;
      console.log(`📝 Transcription length: ${transcriptionLength} characters`);

      console.log(`💾 Saving transcription to: ${txtPath}`);
      await fs.writeFile(txtPath, transcriptionText, 'utf8');
      console.log(`✅ Successfully saved transcription to ${txtPath}`);

      // Get duration for return value
      const duration = await this.getAudioDuration(filePath);
      return { duration: duration || 'N/A' };
    } catch (error: unknown) {
      console.error(`❌ Failed to transcribe ${filePath}:`, error instanceof Error ? error.message : String(error));
      return { duration: 'N/A' };
    } finally {
      // Clean up temporary WAV file
      if (tempWavPath) {
        try {
          await fs.unlink(tempWavPath);
          console.log(`🧹 Cleaned up temporary file: ${tempWavPath}`);
        } catch (cleanupError) {
          console.warn(`⚠️  Failed to clean up temporary file: ${tempWavPath}`);
        }
      }
    }
  }

  private async convertAmrToWav(amrPath: string): Promise<{ wavPath: string; buffer: Buffer }> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const tempDir = require('os').tmpdir();
    const wavPath = path.join(tempDir, `converted_${Date.now()}_${path.basename(amrPath, '.amr')}.wav`);

    try {
      // FFmpeg command to convert AMR to WAV (16kHz, mono, PCM)
      const ffmpegCommand = `"${require('ffmpeg-static')}" -i "${amrPath}" -acodec pcm_s16le -ar 16000 -ac 1 -y "${wavPath}"`;

      console.log(`🎵 Running FFmpeg conversion: ${ffmpegCommand}`);

      const { stdout, stderr } = await execAsync(ffmpegCommand);

      if (stderr) {
        console.log(`ℹ️  FFmpeg output: ${stderr}`);
      }

      // Read the converted WAV file
      const wavBuffer = await fs.readFile(wavPath);

      return {
        wavPath,
        buffer: wavBuffer
      };
    } catch (error) {
      console.error(`❌ FFmpeg conversion failed:`, error);
      throw new Error(`Failed to convert AMR to WAV: ${error instanceof Error ? error.message : String(error)}`);
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
