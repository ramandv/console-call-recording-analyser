#!/usr/bin/env node

import { config } from 'dotenv';
import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TranscriptionProvider } from './api_providers/base-provider';
import { GeminiProvider } from './api_providers/gemini-provider';
import { SpeechmaticsProvider } from './api_providers/speechmatics-provider';
import { GoogleProvider } from './api_providers/google-provider';
import { WhisperProvider } from './api_providers/whisper-provider';

// Load environment variables from .env file
config();

interface TranscribeOptions {
  model?: string;
  apiKey?: string;
  transcribeOnly?: boolean;
  summaryOnly?: boolean;
  service?: string;
}

const program = new Command();

program
  .name('transcribe')
  .description('Transcribe audio/video files and generate summaries using various AI services')
  .version('1.0.0')
  .argument('[folder]', 'Folder path to process', './input')
  .option('-m, --model <model>', 'Whisper model to use', 'whisper-1')
  .option('-k, --api-key <key>', 'OpenAI API key')
  .option('-t, --transcribe-only', 'Only perform transcription, skip CSV generation')
  .option('-s, --summary-only', 'Only generate CSV summary from existing transcripts')
  .option('-S, --service <service>', 'Transcription service to use: whisper, google, speechmatics, or gemini', 'whisper')
  .action(async (folder: string, options: TranscribeOptions) => {
    try {
      await main(folder, options);
    } catch (error: unknown) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function main(folder: string, options: TranscribeOptions): Promise<void> {
  const { transcribeOnly, summaryOnly, model = 'whisper-1', apiKey, service = 'whisper' } = options;

  // Determine operation mode
  const mode = transcribeOnly ? 'transcribe' : summaryOnly ? 'summary' : 'both';

  console.log(`🚀 Starting ${mode} process...`);
  console.log(`📁 Target folder: ${folder}`);
  console.log(`🔊 Transcription service: ${service}`);

  if (mode === 'transcribe' || mode === 'both') {
    if (service === 'whisper') {
      console.log(`🤖 Model: ${model}`);
      // Get OpenAI API key
      const openaiApiKey = apiKey || process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OpenAI API key not provided. Use --api-key option or set OPENAI_API_KEY environment variable');
      }
      console.log('✅ OpenAI API key configured');
    } else if (service === 'google') {
      console.log('🔧 Google Speech-to-Text service selected');
    } else if (service === 'speechmatics') {
      console.log('🎙️ Speechmatics service selected');
    } else if (service === 'gemini') {
      console.log('💎 Gemini service selected');
    } else {
      throw new Error(`Unsupported transcription service: ${service}. Use 'whisper', 'google', 'speechmatics', or 'gemini'`);
    }
  }

  // Check if folder exists
  console.log('🔍 Checking if folder exists...');
  try {
    await fs.access(folder);
    console.log('✅ Folder exists');
  } catch {
    throw new Error(`Folder does not exist: ${folder}`);
  }

  // Supported audio/video extensions
  const supportedExtensions = ['.mp3', '.wav', '.mp4', '.m4a', '.flac', '.ogg', '.amr'];

  // Execute based on mode
  if (mode === 'transcribe' || mode === 'both') {
    console.log(`🎵 Supported file extensions: ${supportedExtensions.join(', ')}`);
    console.log('🔄 Starting transcription process...');
    await processTranscription(folder, options, supportedExtensions);
    console.log('✅ Transcription completed');
  }

  if (mode === 'summary' || mode === 'both') {
    console.log('🔄 Starting summary generation...');
    await processSummary(folder, supportedExtensions);
    console.log('✅ Summary generation completed');
  }

  console.log(`✅ ${mode.charAt(0).toUpperCase() + mode.slice(1)} process completed successfully`);
}

async function processTranscription(folder: string, options: TranscribeOptions, extensions: string[]): Promise<void> {
  const { model = 'whisper-1', apiKey, service = 'whisper' } = options;

  // Create provider instance based on service
  let provider: TranscriptionProvider;

  switch (service) {
    case 'whisper':
      provider = new WhisperProvider();
      break;
    case 'google':
      provider = new GoogleProvider();
      break;
    case 'speechmatics':
      provider = new SpeechmaticsProvider();
      break;
    case 'gemini':
      provider = new GeminiProvider();
      break;
    default:
      throw new Error(`Unsupported transcription service: ${service}`);
  }

  await processFolderForTranscription(folder, provider, options);
}

async function processSummary(folder: string, extensions: string[]): Promise<void> {
  await processFolderForSummary(folder, extensions);
}

async function processFolderForTranscription(folder: string, provider: TranscriptionProvider, options: TranscribeOptions): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 TRANSCRIPTION - SCANNING DIRECTORY: ${folder}`);
  console.log(`${'='.repeat(80)}`);

  const items = await fs.readdir(folder, { withFileTypes: true });
  console.log(`📋 Found ${items.length} items in ${folder}\n`);

  let processedCount = 0;
  let skippedCount = 0;
  let dirCount = 0;

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      console.log(`📁 Entering subdirectory: ${fullPath}`);
      dirCount++;
      await processFolderForTranscription(fullPath, provider, options);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (['.mp3', '.wav', '.mp4', '.m4a', '.flac', '.ogg', '.amr'].includes(ext)) {
        console.log(`\n${'-'.repeat(60)}`);
        console.log(`🎵 TRANSCRIBING FILE: ${item.name}`);
        console.log(`${'-'.repeat(60)}`);

        const txtPath = path.join(folder, path.basename(item.name, ext) + '.txt');
        try {
          await fs.access(txtPath);
          console.log(`⏭️  SKIPPING: Transcription already exists`);
          skippedCount++;
        } catch {
          console.log(`🎙️  STARTING TRANSCRIPTION...`);
          console.log(`🔧 Service: ${provider.name}`);
          await provider.transcribeFile(fullPath, txtPath);
          processedCount++;
        }
      } else {
        console.log(`❌ SKIPPING: ${item.name} (unsupported format: ${ext})`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 TRANSCRIPTION SUMMARY: ${folder}`);
  console.log(`   • Processed: ${processedCount} files`);
  console.log(`   • Skipped: ${skippedCount} files`);
  console.log(`   • Subdirectories: ${dirCount}`);
  console.log(`${'='.repeat(80)}\n`);
}

async function processFolderForSummary(folder: string, extensions: string[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 SUMMARY - SCANNING DIRECTORY: ${folder}`);
  console.log(`${'='.repeat(80)}`);

  const items = await fs.readdir(folder, { withFileTypes: true });
  console.log(`📋 Found ${items.length} items in ${folder}\n`);

  let processedCount = 0;
  let dirCount = 0;
  const csvData: any[] = [];

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      console.log(`📁 Entering subdirectory: ${fullPath}`);
      dirCount++;
      await processFolderForSummary(fullPath, extensions);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.includes(ext)) {
        console.log(`\n${'-'.repeat(60)}`);
        console.log(`📊 PROCESSING FILE: ${item.name}`);
        console.log(`${'-'.repeat(60)}`);

        // Check if transcription exists
        const txtPath = path.join(folder, path.basename(item.name, ext) + '.txt');
        let hasTranscription = false;
        try {
          await fs.access(txtPath);
          hasTranscription = true;
          console.log(`✅ Found transcription file: ${txtPath}`);
        } catch {
          console.log(`ℹ️  No transcription found for: ${item.name}`);
        }

        // Add to CSV regardless of transcription status
        const metadata = parseFilenameMetadata(item.name);
        const duration = await getAudioDuration(fullPath);
        csvData.push({
          filename: item.name,
          duration: duration || 'N/A',
          hasTranscription: hasTranscription,
          ...metadata
        });
        processedCount++;
      } else {
        console.log(`❌ SKIPPING: ${item.name} (unsupported format: ${ext})`);
      }
    }
  }

  // Generate CSV file
  if (csvData.length > 0) {
    await generateCsvFile(folder, csvData);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY GENERATION: ${folder}`);
  console.log(`   • Processed: ${processedCount} files`);
  console.log(`   • Subdirectories: ${dirCount}`);
  console.log(`   • CSV generated: summary.csv`);
  console.log(`${'='.repeat(80)}\n`);
}

async function getAudioDuration(filePath: string): Promise<string | null> {
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

function parseFilenameMetadata(filename: string): { timestamp: string; phoneNumber: string; callType: string } {
  // Default values
  let timestamp = 'N/A';
  let phoneNumber = 'N/A';
  let callType = 'N/A';

  try {
    // Extract TP tokens from filename
    const tp1Match = filename.match(/TP1(\d+)/);
    const tp3Match = filename.match(/TP3([+\d]+)/);
    const tp4Match = filename.match(/TP4(\w+)/);

    // Parse timestamp (TP1) - assuming it's a Unix timestamp in milliseconds
    if (tp1Match) {
      const ts = parseInt(tp1Match[1]);
      if (!isNaN(ts)) {
        // Convert Unix timestamp to readable format
        const date = new Date(ts);
        timestamp = date.toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    // Parse phone number (TP3) - handle numbers with + prefix
    if (tp3Match) {
      const phoneStr = tp3Match[1];
      // Remove + prefix if present and extract the actual number
      phoneNumber = phoneStr.startsWith('+') ? phoneStr.substring(1) : phoneStr;
    }

    // Parse call type (TP4) - extract only the word after TP4 until next TP
    if (tp4Match) {
      const afterTP4 = filename.substring(filename.indexOf('TP4') + 3);
      const nextTPMatch = afterTP4.match(/TP\d/);
      if (nextTPMatch) {
        callType = afterTP4.substring(0, nextTPMatch.index);
      } else {
        callType = afterTP4;
      }
    }
  } catch (error) {
    console.warn(`⚠️  Could not parse metadata from filename: ${filename}`);
  }

  return { timestamp, phoneNumber, callType };
}

async function generateCsvFile(folder: string, csvData: any[]): Promise<void> {
  const csvPath = path.join(folder, 'summary.csv');

  try {
    // CSV header
    const headers = ['Filename', 'Duration', 'Has Transcription', 'Timestamp', 'Phone Number', 'Call Type'];
    let csvContent = headers.join(',') + '\n';

    // Add data rows
    for (const row of csvData) {
      const values = [
        `"${row.filename}"`,
        `"${row.duration}"`,
        `"${row.hasTranscription ? 'Yes' : 'No'}"`,
        `"${row.timestamp}"`,
        `"${row.phoneNumber}"`,
        `"${row.callType}"`
      ];
      csvContent += values.join(',') + '\n';
    }

    // Write CSV file
    await fs.writeFile(csvPath, csvContent, 'utf8');
    console.log(`📊 CSV file generated: ${csvPath}`);
  } catch (error) {
    console.error(`❌ Failed to generate CSV file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

program.parse();
