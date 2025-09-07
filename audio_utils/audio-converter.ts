import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

export interface ConversionResult {
  wavPath: string;
  buffer: Buffer;
}

export interface AudioConverterConfig {
  sampleRate?: number; // Default: 16000 (16kHz)
}

export class AudioConverter {
  private config: Required<AudioConverterConfig>;

  constructor(config: AudioConverterConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate ?? parseInt(process.env.AUDIO_SAMPLE_RATE || '16000')
    };
  }

  async convertAmrToWav(amrPath: string): Promise<ConversionResult> {
    const execAsync = promisify(exec);
    const tempDir = require('os').tmpdir();
    const wavPath = path.join(tempDir, `converted_${Date.now()}_${path.basename(amrPath, '.amr')}.wav`);

    try {
      // FFmpeg command to convert AMR to WAV with configurable sample rate
      const ffmpegCommand = `"${require('ffmpeg-static')}" -i "${amrPath}" -acodec pcm_s16le -ar ${this.config.sampleRate} -ac 1 -y "${wavPath}"`;

      console.log(`🎵 Running FFmpeg conversion (${this.config.sampleRate}Hz): ${ffmpegCommand}`);

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

  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      console.log(`🧹 Cleaned up temporary file: ${filePath}`);
    } catch (cleanupError) {
      console.warn(`⚠️  Failed to clean up temporary file: ${filePath}`);
    }
  }
}
