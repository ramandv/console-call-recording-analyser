import { promises as fs } from 'fs';
import * as path from 'path';
import speech from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';
import { TranscriptionProvider, TranscriptionResult } from './base-provider';
import { AudioConverter } from '../audio_utils/audio-converter';

export class GoogleProvider implements TranscriptionProvider {
  name = 'google';
  private converter: AudioConverter;

  constructor(converter: AudioConverter) {
    this.converter = converter;
  }

  async transcribeFile(filePath: string, txtPath: string): Promise<TranscriptionResult> {
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
        const conversionResult = await this.converter.convertAmrToWav(filePath);
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
      const audioDuration = await this.getAudioDuration(filePath);
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

      if (audioDuration && this.isLongerThanOneMinute(audioDuration)) {
        console.log('🎙️ Audio longer than 1 minute, using LongRunningRecognize with GCS...');
        console.log('☁️  Uploading to Google Cloud Storage first...');

        // Upload to GCS for long files
        const bucketName = process.env.GOOGLE_CLOUD_STORAGE_BUCKET || 'your-transcription-bucket';
        const gcsFileName = `transcriptions/${Date.now()}_${path.basename(audioFilePath)}`;
        gcsUri = await this.uploadToGCS(audioFilePath, bucketName, gcsFileName);

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
      if (audioDuration && this.isLongerThanOneMinute(audioDuration)) {
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
      const duration = await this.getAudioDuration(filePath);
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

  private async uploadToGCS(filePath: string, bucketName: string, fileName: string): Promise<string> {
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
        contentType: this.getMimeType(path.extname(filePath)),
      },
    });

    const gcsUri = `gs://${bucketName}/${fileName}`;
    console.log(`✅ File uploaded to: ${gcsUri}`);

    return gcsUri;
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

  private isLongerThanOneMinute(duration: string): boolean {
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
}
