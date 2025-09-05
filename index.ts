#!/usr/bin/env node

import { config } from 'dotenv';
import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import OpenAI from 'openai';
import ffmpeg from 'ffmpeg-static';

// Load environment variables from .env file
config();

interface TranscribeOptions {
  model?: string;
  apiKey?: string;
}

const program = new Command();

program
  .name('transcribe')
  .description('Transcribe audio/video files in a folder using OpenAI Whisper')
  .version('1.0.0')
  .argument('[folder]', 'Folder path to process', './input')
  .option('-m, --model <model>', 'Whisper model to use', 'whisper-1')
  .option('-k, --api-key <key>', 'OpenAI API key')
  .action(async (folder: string, options: TranscribeOptions) => {
    try {
      await main(folder, options);
    } catch (error: unknown) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function main(folder: string, options: TranscribeOptions): Promise<void> {
  console.log('🚀 Starting transcription process...');
  console.log(`📁 Target folder: ${folder}`);
  console.log(`🤖 Model: ${options.model || 'whisper-1'}`);

  const { model = 'whisper-1', apiKey } = options;

  // Get OpenAI API key
  const openaiApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not provided. Use --api-key option or set OPENAI_API_KEY environment variable');
  }
  console.log('✅ OpenAI API key configured');

  // Check if folder exists
  console.log('🔍 Checking if folder exists...');
  try {
    await fs.access(folder);
    console.log('✅ Folder exists');
  } catch {
    throw new Error(`Folder does not exist: ${folder}`);
  }

  // Initialize OpenAI
  console.log('🔧 Initializing OpenAI client...');
  const openai = new OpenAI({
    apiKey: openaiApiKey,
  });
  console.log('✅ OpenAI client initialized successfully');

  // Supported audio/video extensions (Whisper API compatible + .amr with conversion)
  const supportedExtensions = ['.mp3', '.wav', '.mp4', '.m4a', '.flac', '.ogg', '.amr'];
  console.log(`🎵 Supported file extensions: ${supportedExtensions.join(', ')}`);

  // Recursively process files
  console.log('🔄 Starting recursive file processing...');
  await processFolder(folder, openai, model, supportedExtensions);
  console.log('✅ File processing completed');
}

async function processFolder(folder: string, openai: OpenAI, model: string, extensions: string[]): Promise<void> {
  console.log(`📂 Scanning directory: ${folder}`);
  const items = await fs.readdir(folder, { withFileTypes: true });
  console.log(`📋 Found ${items.length} items in ${folder}`);

  let processedCount = 0;
  let skippedCount = 0;
  let dirCount = 0;

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      console.log(`📁 Entering subdirectory: ${fullPath}`);
      dirCount++;
      await processFolder(fullPath, openai, model, extensions);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.includes(ext)) {
        console.log(`🎵 Found supported file: ${fullPath}`);
        const txtPath = path.join(folder, path.basename(item.name, ext) + '.txt');
        try {
          await fs.access(txtPath);
          console.log(`⏭️  Skipping ${fullPath} - transcription already exists at ${txtPath}`);
          skippedCount++;
        } catch {
          console.log(`🎙️  Starting transcription for: ${fullPath}`);
          await transcribeFile(fullPath, txtPath, openai, model);
          processedCount++;
        }
      } else {
        console.log(`❌ Skipping unsupported file: ${fullPath} (extension: ${ext})`);
      }
    }
  }

  console.log(`📊 Directory ${folder} summary: ${processedCount} processed, ${skippedCount} skipped, ${dirCount} subdirectories`);
}

async function transcribeFile(filePath: string, txtPath: string, openai: OpenAI, model: string): Promise<void> {
  let tempWavPath: string | null = null;

  try {
    const fileExt = path.extname(filePath).toLowerCase();
    let audioFilePath = filePath;
    let audioFileBuffer: Buffer;

    if (fileExt === '.amr') {
      console.log(`🔄 Converting .amr file to WAV: ${filePath}`);
      // Convert AMR to WAV
      const conversionResult = await convertAmrToWav(filePath);
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

    // Create a file-like object for OpenAI
    const file = new File([audioFileBuffer], path.basename(audioFilePath), {
      type: getMimeType(path.extname(audioFilePath))
    });

    console.log('🤖 Sending request to OpenAI Whisper API...');
    // Generate transcription using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: model,
    });
    console.log('✅ Received response from OpenAI Whisper API');

    const transcriptionText = transcription.text;
    const transcriptionLength = transcriptionText.length;
    console.log(`📝 Transcription length: ${transcriptionLength} characters`);

    console.log(`💾 Saving transcription to: ${txtPath}`);
    // Save to text file
    await fs.writeFile(txtPath, transcriptionText, 'utf8');
    console.log(`✅ Successfully saved transcription to ${txtPath}`);
  } catch (error: unknown) {
    console.error(`❌ Failed to transcribe ${filePath}:`, error instanceof Error ? error.message : String(error));
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

async function convertAmrToWav(amrPath: string): Promise<{ wavPath: string; buffer: Buffer }> {
  const execAsync = promisify(exec);
  const tempDir = require('os').tmpdir();
  const wavPath = path.join(tempDir, `converted_${Date.now()}_${path.basename(amrPath, '.amr')}.wav`);

  try {
    // FFmpeg command to convert AMR to WAV (16kHz, mono, PCM)
    const ffmpegCommand = `"${ffmpeg}" -i "${amrPath}" -acodec pcm_s16le -ar 16000 -ac 1 -y "${wavPath}"`;

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

function getMimeType(ext: string): string {
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

program.parse();
