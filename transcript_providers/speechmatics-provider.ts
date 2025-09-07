import { promises as fs } from 'fs';
import * as path from 'path';
import { TranscriptionProvider, TranscriptionResult } from './base-provider';

export class SpeechmaticsProvider implements TranscriptionProvider {
  name = 'speechmatics';

  async transcribeFile(filePath: string, txtPath: string): Promise<TranscriptionResult> {
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
      formData.append('data_file', new Blob([new Uint8Array(audioBuffer)]), `audio${fileExt}`);

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
      let transcriptionResult: {
        results?: Array<{
          alternatives?: Array<{
            content?: string;
            speaker?: string;
          }>;
        }>;
      } | null = null;
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

          transcriptionResult = await resultResponse.json() as {
            results?: Array<{
              alternatives?: Array<{
                content?: string;
                speaker?: string;
              }>;
            }>;
          };
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
      const duration = await this.getAudioDuration(filePath);
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
