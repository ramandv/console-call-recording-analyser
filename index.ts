#!/usr/bin/env node

import { config } from 'dotenv';
import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import OpenAI from 'openai';
import ffmpeg from 'ffmpeg-static';
import speech from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
  .description('Transcribe audio/video files and generate summaries using OpenAI Whisper or Google Speech-to-Text')
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
      // Google credentials will be handled in the transcription function
    } else if (service === 'speechmatics') {
      console.log('🎙️ Speechmatics service selected');
      // Speechmatics credentials will be handled in the transcription function
    } else if (service === 'gemini') {
      console.log('💎 Gemini service selected');
      // Gemini credentials will be handled in the transcription function
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

  if (service === 'whisper') {
    // Get OpenAI API key
    const openaiApiKey = apiKey || process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not provided');
    }

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    await processFolderForTranscription(folder, openai, model, extensions, service);
  } else if (service === 'google') {
    await processFolderForTranscription(folder, null, model, extensions, service);
  } else if (service === 'speechmatics') {
    await processFolderForTranscription(folder, null, model, extensions, service);
  } else if (service === 'gemini') {
    await processFolderForTranscription(folder, null, model, extensions, service);
  } else {
    throw new Error(`Unsupported transcription service: ${service}`);
  }
}

async function processSummary(folder: string, extensions: string[]): Promise<void> {
  await processFolderForSummary(folder, extensions);
}

async function processFolderForTranscription(folder: string, openai: OpenAI | null, model: string, extensions: string[], service: string = 'whisper'): Promise<void> {
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
      await processFolderForTranscription(fullPath, openai, model, extensions, service);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.includes(ext)) {
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
          console.log(`🔧 Service: ${service}`);
          if (service === 'whisper' && openai) {
            console.log('🤖 Using OpenAI Whisper');
            await transcribeFile(fullPath, txtPath, openai, model);
          } else if (service === 'google') {
            console.log('🎙️ Using Google Speech-to-Text');
            await transcribeFileGoogle(fullPath, txtPath);
          } else if (service === 'speechmatics') {
            console.log('🎙️ Using Speechmatics');
            await transcribeFileSpeechmatics(fullPath, txtPath);
          } else if (service === 'gemini') {
            console.log('💎 Using Gemini');
            await transcribeFileGemini(fullPath, txtPath);
          } else {
            console.log(`❌ Unknown service: ${service}`);
          }
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

async function processFolder(folder: string, openai: OpenAI, model: string, extensions: string[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 SCANNING DIRECTORY: ${folder}`);
  console.log(`${'='.repeat(80)}`);

  const items = await fs.readdir(folder, { withFileTypes: true });
  console.log(`📋 Found ${items.length} items in ${folder}\n`);

  let processedCount = 0;
  let skippedCount = 0;
  let dirCount = 0;
  const csvData: any[] = [];

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      console.log(`📁 Entering subdirectory: ${fullPath}`);
      dirCount++;
      await processFolder(fullPath, openai, model, extensions);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.includes(ext)) {
        console.log(`\n${'-'.repeat(60)}`);
        console.log(`🎵 FILE: ${item.name}`);
        console.log(`${'-'.repeat(60)}`);

        const txtPath = path.join(folder, path.basename(item.name, ext) + '.txt');
        try {
          await fs.access(txtPath);
          console.log(`⏭️  SKIPPING: Transcription already exists`);
          skippedCount++;

          // Still add to CSV even if skipped
          const metadata = parseFilenameMetadata(item.name);
          const duration = await getAudioDuration(fullPath);
          csvData.push({
            filename: item.name,
            duration: duration || 'N/A',
            ...metadata
          });
        } catch {
          console.log(`🎙️  STARTING TRANSCRIPTION...`);
          const result = await transcribeFile(fullPath, txtPath, openai, model);
          processedCount++;

          // Add to CSV
          const metadata = parseFilenameMetadata(item.name);
          csvData.push({
            filename: item.name,
            duration: result.duration || 'N/A',
            ...metadata
          });
        }
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
  console.log(`📊 DIRECTORY SUMMARY: ${folder}`);
  console.log(`   • Processed: ${processedCount} files`);
  console.log(`   • Skipped: ${skippedCount} files`);
  console.log(`   • Subdirectories: ${dirCount}`);
  console.log(`   • CSV generated: summary.csv`);
  console.log(`${'='.repeat(80)}\n`);
}

async function uploadToGCS(filePath: string, bucketName: string, fileName: string): Promise<string> {
  console.log('☁️  Uploading file to Google Cloud Storage...');
  console.log(`📤 Source: ${filePath}`);
  console.log(`📦 Bucket: ${bucketName}`);
  console.log(`📄 Destination: ${fileName}`);

  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);

  // Upload file
  await bucket.upload(filePath, {
    destination: fileName,
    metadata: {
      contentType: getMimeType(path.extname(filePath)),
    },
  });

  const gcsUri = `gs://${bucketName}/${fileName}`;
  console.log(`✅ File uploaded to: ${gcsUri}`);

  return gcsUri;
}

async function transcribeFileGoogle(filePath: string, txtPath: string): Promise<{ duration: string }> {
  console.log('🚀 GOOGLE TRANSCRIPTION STARTED');
  console.log(`📁 File: ${path.basename(filePath)}`);
  console.log(`📂 Output: ${path.basename(txtPath)}`);

  let tempWavPath: string | null = null;
  let gcsUri: string | null = null;

  try {
    console.log('🔄 Preparing Google Speech-to-Text transcription request...');
    console.log(`📁 Processing file: ${path.basename(filePath)}`);

    const fileExt = path.extname(filePath).toLowerCase();
    let audioFilePath = filePath;
    let audioFileBuffer: Buffer;

    if (fileExt === '.amr') {
      console.log(`🔄 Converting .amr file to WAV: ${filePath}`);
      // Convert AMR to WAV for Google Speech-to-Text
      const conversionResult = await convertAmrToWav(filePath);
      tempWavPath = conversionResult.wavPath;
      audioFilePath = tempWavPath;
      audioFileBuffer = conversionResult.buffer;
      console.log(`✅ Conversion completed: ${tempWavPath}`);
    } else {
      console.log(`📖 Reading file: ${filePath}`);
      audioFileBuffer = await fs.readFile(filePath);
      console.log(`✅ File read successfully, size: ${audioFileBuffer.length} bytes`);
    }

    const fileSize = (audioFileBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`📏 File size: ${fileSize} MB`);

    // Check if file size is within Google limits (10MB for synchronous)
    if (audioFileBuffer.length > 10 * 1024 * 1024) {
      throw new Error(`File size (${fileSize} MB) exceeds Google Speech-to-Text limit of 10MB for synchronous requests`);
    }

    // Initialize Google Speech-to-Text client
    console.log('🔧 Initializing Google Speech-to-Text client...');
    const client = new speech.SpeechClient();
    console.log('✅ Google Speech-to-Text client initialized');

    // Check audio duration to decide between sync and async API
    console.log('⏱️  Checking audio duration...');
    const audioDuration = await getAudioDuration(filePath);
    console.log(`⏱️  Audio duration: ${audioDuration || 'Unknown'}`);

    let request;
    const encoding = fileExt === '.amr' || fileExt === '.wav' ? 'LINEAR16' : 'MP3';
    console.log(`🎵 Audio encoding: ${encoding}`);

    const config = {
      encoding: encoding as 'LINEAR16' | 'MP3',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: false,
    };

    if (audioDuration && isLongerThanOneMinute(audioDuration)) {
      console.log('🎙️ Audio longer than 1 minute, using LongRunningRecognize with GCS...');
      console.log('☁️  Uploading to Google Cloud Storage first...');

      // Upload to GCS for long files
      const bucketName = process.env.GOOGLE_CLOUD_STORAGE_BUCKET || 'your-transcription-bucket';
      const gcsFileName = `transcriptions/${Date.now()}_${path.basename(audioFilePath)}`;
      gcsUri = await uploadToGCS(audioFilePath, bucketName, gcsFileName);

      // Configure request with GCS URI
      request = {
        audio: {
          uri: gcsUri,
        },
        config: config,
      };

      console.log('⏳ Starting LongRunningRecognize with GCS URI...');
    } else {
      console.log('🎙️ Audio 1 minute or shorter, using synchronous recognize API...');
      console.log('⚙️  Configuring audio settings...');

      // Configure request with inline content for short files
      request = {
        audio: {
          content: audioFileBuffer.toString('base64'),
        },
        config: config,
      };
    }

    let response;
    if (audioDuration && isLongerThanOneMinute(audioDuration)) {
      console.log('⏳ This will take longer as it processes asynchronously...');

      // Use LongRunningRecognize for files longer than 1 minute
      const [operation] = await client.longRunningRecognize(request);
      console.log('✅ Long-running operation started, waiting for completion...');

      // Wait for the operation to complete
      const [operationResponse] = await operation.promise();
      response = operationResponse;
      console.log('✅ Long-running operation completed');
    } else {
      console.log('⏳ This may take a few moments depending on file size...');

      // Use synchronous API for files 1 minute or shorter
      [response] = await client.recognize(request);
      console.log('✅ Received response from Google Speech-to-Text API');
    }

    // Extract transcription text
    const transcription = response.results
      ?.map((result: any) => result.alternatives?.[0]?.transcript || '')
      .join('\n') || '';

    const transcriptionLength = transcription.length;
    console.log(`📝 Transcription length: ${transcriptionLength} characters`);

    if (!transcription.trim()) {
      console.warn('⚠️  No transcription text received from Google Speech-to-Text');
      console.log('💡 This could mean:');
      console.log('   - No speech detected in the audio');
      console.log('   - Audio quality is too low');
      console.log('   - Unsupported audio format');
      await fs.writeFile(txtPath, '[No speech detected]', 'utf8');
    } else {
      console.log(`💾 Saving transcription to: ${txtPath}`);
      console.log(`📄 Transcription preview: ${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}`);
      await fs.writeFile(txtPath, transcription, 'utf8');
      console.log(`✅ Successfully saved transcription to ${txtPath}`);
    }

    // Get duration for return value
    const duration = await getAudioDuration(filePath);
    console.log(`⏱️  Audio duration: ${duration || 'N/A'}`);
    return { duration: duration || 'N/A' };

  } catch (error: unknown) {
    // Clean up GCS file if it was uploaded
    if (gcsUri) {
      try {
        console.log('🧹 Cleaning up GCS file...');
        const storage = new Storage();
        const bucketName = process.env.GOOGLE_CLOUD_STORAGE_BUCKET || 'your-transcription-bucket';
        const fileName = gcsUri.replace(`gs://${bucketName}/`, '');
        await storage.bucket(bucketName).file(fileName).delete();
        console.log(`✅ Cleaned up GCS file: ${gcsUri}`);
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to clean up GCS file: ${gcsUri}`);
      }
    }
    console.error(`❌ Failed to transcribe ${filePath} with Google Speech-to-Text`);
    console.error('🔍 Error details:');

    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);

      // Provide specific guidance based on error type
      if (error.message.includes('PERMISSION_DENIED')) {
        console.error('   💡 Solution: Check your Google Cloud credentials and permissions');
        console.error('   💡 Make sure GOOGLE_APPLICATION_CREDENTIALS is set correctly');
      } else if (error.message.includes('exceeds duration limit')) {
        console.error('   💡 Solution: For audio longer than 1 minute with LongRunningRecognize:');
        console.error('      1. Upload audio file to Google Cloud Storage');
        console.error('      2. Use gs:// URI instead of inline content');
        console.error('      3. Or use OpenAI Whisper which supports longer files');
      } else if (error.message.includes('INVALID_ARGUMENT')) {
        console.error('   💡 Solution: Check audio format and encoding settings');
      } else if (error.message.includes('RESOURCE_EXHAUSTED')) {
        console.error('   💡 Solution: You may have exceeded your quota limits');
      } else if (error.message.includes('UNAVAILABLE')) {
        console.error('   💡 Solution: Google API is temporarily unavailable, try again later');
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

async function transcribeFileSpeechmatics(filePath: string, txtPath: string): Promise<{ duration: string }> {
  console.log('🚀 SPEECHMATICS TRANSCRIPTION STARTED');
  console.log(`📁 File: ${path.basename(filePath)}`);
  console.log(`📂 Output: ${path.basename(txtPath)}`);

  try {
    console.log('🔄 Preparing Speechmatics transcription request...');

    // Get Speechmatics API key
    const speechmaticsApiKey = process.env.SPEECHMATICS_API_KEY;
    if (!speechmaticsApiKey) {
      throw new Error('Speechmatics API key not provided. Set SPEECHMATICS_API_KEY environment variable');
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

    // Speechmatics API configuration
    const config = {
      transcription_config: {
        audio_filtering_config: {
          volume_threshold: 0
        },
        diarization: "speaker",
        enable_entities: true,
        language: "en_ta",
        operating_point: "enhanced"
      },
      type: 'transcription'
    };

    console.log('🎙️ Sending request to Speechmatics API...');
    console.log('⏳ Processing audio file...');

    // Create multipart/form-data request
    const formData = new FormData();
    formData.append('config', JSON.stringify(config));
    formData.append('data_file', new Blob([audioBuffer]), `audio${fileExt}`);

    // Submit job to Speechmatics
    const submitResponse = await fetch('https://asr.api.speechmatics.com/v2/jobs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${speechmaticsApiKey}`
        // Don't set Content-Type for FormData - let browser set it automatically
      },
      body: formData
    });

    if (!submitResponse.ok) {
      const errorData = await submitResponse.text();
      throw new Error(`Speechmatics API error: ${submitResponse.status} - ${errorData}`);
    }

    const jobData = await submitResponse.json() as { id: string };
    const jobId = jobData.id;
    console.log(`✅ Job submitted successfully, Job ID: ${jobId}`);

    // Poll for job completion
    console.log('⏳ Waiting for transcription to complete...');
    let transcriptionResult = null;
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes with 1 second intervals (should be enough for 247KB file)

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

      const statusResponse = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${speechmaticsApiKey}`
        }
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        console.error(`❌ Status check failed: ${statusResponse.status} - ${errorText}`);
        throw new Error(`Failed to check job status: ${statusResponse.status} - ${errorText}`);
      }

      const statusData = await statusResponse.json() as any;
      console.log(`📊 Raw status response:`, JSON.stringify(statusData, null, 2));

      // Try different possible status field locations
      const jobStatus = statusData.status || statusData.job?.status || statusData.data?.status;
      console.log(`📊 Job status: ${jobStatus} (attempt ${attempts + 1}/${maxAttempts})`);

      if (jobStatus === 'done' || jobStatus === 'completed') {
        console.log('✅ Transcription completed successfully');

        // Get the transcription result
        const resultResponse = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${jobId}/transcript`, {
          headers: {
            'Authorization': `Bearer ${speechmaticsApiKey}`,
            'Accept': 'application/json'
          }
        });

        if (!resultResponse.ok) {
          const errorText = await resultResponse.text();
          console.error(`❌ Failed to get results: ${resultResponse.status} - ${errorText}`);
          throw new Error(`Failed to get transcription result: ${resultResponse.status} - ${errorText}`);
        }

        transcriptionResult = await resultResponse.json() as any;
        console.log('📄 Raw transcription response:', JSON.stringify(transcriptionResult, null, 2));
        console.log('📄 Transcription results retrieved successfully');
        break;
      } else if (jobStatus === 'failed' || jobStatus === 'error') {
        const errorMsg = statusData.error || statusData.message || statusData.job?.error || 'Unknown error';
        console.error(`❌ Job failed: ${errorMsg}`);
        throw new Error(`Transcription failed: ${errorMsg}`);
      } else if (jobStatus === 'running' || jobStatus === 'processing' || jobStatus === 'queued') {
        console.log(`🔄 Job is ${jobStatus}... (${attempts + 1}/${maxAttempts})`);
      } else {
        console.log(`❓ Unknown job status: ${jobStatus}`);
      }

      attempts++;
      if (attempts % 5 === 0) {
        console.log(`⏳ Still processing... (${attempts}/${maxAttempts})`);
      }
    }

    if (!transcriptionResult) {
      throw new Error('Transcription timed out');
    }

    // Extract transcription text with speaker information
    let transcription = '';
    let hasSpeakerInfo = false;

    if (transcriptionResult.results && Array.isArray(transcriptionResult.results)) {
      let currentSpeaker = '';
      let currentContent = '';

      transcriptionResult.results.forEach((result: any, index: number) => {
        if (result.alternatives && result.alternatives.length > 0) {
          const alternative = result.alternatives[0];
          const content = alternative.content || '';
          const speaker = alternative.speaker;

          if (speaker) {
            hasSpeakerInfo = true;

            // If speaker changed, write the previous speaker's content
            if (currentSpeaker && currentSpeaker !== speaker) {
              transcription += `${currentSpeaker}: ${currentContent.trim()}\n`;
              currentContent = '';
            }

            // Update current speaker and add content
            currentSpeaker = speaker;
            currentContent += content + ' ';
          } else {
            // No speaker info, just add content
            if (currentSpeaker) {
              currentContent += content + ' ';
            } else {
              transcription += content + ' ';
            }
          }
        }
      });

      // Add the last speaker's content
      if (currentSpeaker && currentContent.trim()) {
        transcription += `${currentSpeaker}: ${currentContent.trim()}\n`;
      }
    }

    // If no speaker info was found, fall back to regular format
    if (!hasSpeakerInfo && transcriptionResult.results) {
      transcription = transcriptionResult.results
        ?.map((result: any) => result.alternatives?.[0]?.content || '')
        .join(' ') || '';
    }

    const transcriptionLength = transcription.length;
    console.log(`📝 Transcription length: ${transcriptionLength} characters`);
    console.log(`🎙️  Speaker information included: ${hasSpeakerInfo ? 'Yes' : 'No'}`);

    if (!transcription.trim()) {
      console.warn('⚠️  No transcription text received from Speechmatics');
      console.log('💡 This could mean:');
      console.log('   - No speech detected in the audio');
      console.log('   - Audio quality is too low');
      console.log('   - Unsupported audio format');
      await fs.writeFile(txtPath, '[No speech detected]', 'utf8');
    } else {
      console.log(`💾 Saving transcription to: ${txtPath}`);
      console.log(`📄 Transcription preview: ${transcription.substring(0, 200)}${transcription.length > 200 ? '...' : ''}`);
      await fs.writeFile(txtPath, transcription, 'utf8');
      console.log(`✅ Successfully saved transcription to ${txtPath}`);
    }

    // Get duration for return value
    const duration = await getAudioDuration(filePath);
    console.log(`⏱️  Audio duration: ${duration || 'N/A'}`);
    return { duration: duration || 'N/A' };

  } catch (error: unknown) {
    console.error(`❌ Failed to transcribe ${filePath} with Speechmatics`);
    console.error('🔍 Error details:');

    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);

      // Provide specific guidance based on error type
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        console.error('   💡 Solution: Check your Speechmatics API key');
        console.error('   💡 Make sure SPEECHMATICS_API_KEY is set correctly');
      } else if (error.message.includes('400') || error.message.includes('Bad Request')) {
        console.error('   💡 Solution: Check audio format and file size');
        console.error('   💡 Speechmatics supports: MP3, WAV, FLAC, OGG, AMR, M4A');
      } else if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
        console.error('   💡 Solution: You may have exceeded your quota limits');
      } else if (error.message.includes('timed out')) {
        console.error('   💡 Solution: Audio file may be too long, try a shorter file');
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

async function transcribeFileGemini(filePath: string, txtPath: string): Promise<{ duration: string }> {
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
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    console.log('✅ Gemini Flash 1.5 initialized');

    // Convert audio buffer to base64
    const audioBase64 = audioBuffer.toString('base64');
    const mimeType = getMimeType(fileExt);

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
    const duration = await getAudioDuration(filePath);
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

async function transcribeFile(filePath: string, txtPath: string, openai: OpenAI, model: string): Promise<{ duration: string }> {
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
    await fs.writeFile(txtPath, transcriptionText, 'utf8');
    console.log(`✅ Successfully saved transcription to ${txtPath}`);

    // Get duration for return value
    const duration = await getAudioDuration(filePath);
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

async function getAudioDuration(filePath: string): Promise<string | null> {
  const execAsync = promisify(exec);

  try {
    // Use FFmpeg to get duration
    const ffmpegCommand = `"${ffmpeg}" -i "${filePath}" 2>&1 | grep "Duration" | cut -d ' ' -f 4 | sed s/,//`;

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

function isLongerThanOneMinute(duration: string): boolean {
  // Parse duration in HH:MM:SS format
  const parts = duration.split(':');
  if (parts.length !== 3) return false;

  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseInt(parts[2]) || 0;

  // Convert to total minutes
  const totalMinutes = hours * 60 + minutes + seconds / 60;

  return totalMinutes > 1;
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

async function generateSummaryWithGemini(transcriptionText: string, outputPath: string): Promise<void> {
  try {
    console.log('📝 Generating summary with Gemini...');

    // Get Gemini API key
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('Gemini API key not provided. Set GEMINI_API_KEY environment variable');
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Please provide a concise summary of the following conversation transcript. Focus on the key points, decisions made, and important information exchanged:

${transcriptionText}

Summary:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    console.log(`📄 Summary generated (${summary.length} characters)`);
    console.log(`💾 Saving summary to: ${outputPath}`);

    await fs.writeFile(outputPath, summary, 'utf8');
    console.log(`✅ Summary saved successfully`);

  } catch (error: unknown) {
    console.error(`❌ Failed to generate summary with Gemini:`, error instanceof Error ? error.message : String(error));
    throw error;
  }
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
