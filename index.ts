#!/usr/bin/env node

import { config } from 'dotenv';
import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TranscriptionProvider } from './transcript_providers/base-provider';
import { GeminiProvider } from './transcript_providers/gemini-provider';
import { SpeechmaticsProvider } from './transcript_providers/speechmatics-provider';
import { GoogleProvider } from './transcript_providers/google-provider';
import { WhisperProvider } from './transcript_providers/whisper-provider';
import { AudioConverter } from './audio_utils/audio-converter';
import { AnalysisProvider } from './analysis_providers/base-analysis';
import { GeminiAnalysisProvider } from './analysis_providers/gemini-analysis';
import { FilenameParserFactory } from './filename_parsers/filename-parser-factory';

// Load environment variables from .env file
config();

// Create global filename parser factory instance
const filenameParserFactory = new FilenameParserFactory();

interface TranscribeOptions {
  model?: string;
  apiKey?: string;
  transcribeOnly?: boolean;
  summaryOnly?: boolean;
  analyseOnly?: boolean;
  overviewOnly?: boolean;
  service?: string;
  analysisService?: string;
  analysisMaxMb?: number | string;
  analysisMinSeconds?: number | string;
  parser?: string;
}

const program = new Command();

program
  .name('transcribe')
  .description('Transcribe audio/video files, generate summaries, and analyze audio files using various AI services')
  .version('1.0.0')
  .argument('[folder]', 'Folder path to process', './input')
  .option('-m, --model <model>', 'Whisper model to use', 'whisper-1')
  .option('-k, --api-key <key>', 'OpenAI API key')
  .option('-t, --transcribe-only', 'Only perform transcription, skip CSV generation')
  .option('-s, --summary-only', 'Only generate CSV summary from existing transcripts')
  .option('-a, --analyse-only', 'Only perform analysis on audio files')
  .option('-o, --overview-only', 'Only generate overview stats from existing summary.csv files')
  .option('-S, --service <service>', 'Transcription service to use: whisper, google, speechmatics, or gemini', 'whisper')
  .option('-A, --analysis-service <service>', 'Analysis service to use: gemini', 'gemini')
  .option('-M, --analysis-max-mb <mb>', 'Maximum file size (MB) for analysis', '2')
  .option('-N, --analysis-min-seconds <seconds>', 'Minimum duration (seconds) for analysis', '60')
  .option('-P, --parser <parser>', 'Filename parser to use: arex, simple, call-recording (auto if not specified)')
  .action(async (folder: string, options: TranscribeOptions) => {
    try {
      await main(folder, options);
    } catch (error: unknown) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function main(folder: string, options: TranscribeOptions): Promise<void> {
  const { transcribeOnly, summaryOnly, analyseOnly, overviewOnly, model = 'whisper-1', apiKey, service = 'whisper', analysisService = 'gemini' } = options;

  // Determine operation mode
  let mode: string;
  if (transcribeOnly) {
    mode = 'transcribe';
  } else if (summaryOnly) {
    mode = 'summary';
  } else if (analyseOnly) {
    mode = 'analyse';
  } else if (overviewOnly) {
    mode = 'overview';
  } else {
    // Default behavior: analysis + summary + overview (no transcription by default)
    mode = 'default';
  }

  console.log(`🚀 Starting ${mode} process...`);
  console.log(`📁 Target folder: ${folder}`);

  // Check and set filename parser override
  if (options.parser) {
    const parsers = filenameParserFactory.getParsers();
    const p = parsers.find(parser => parser.name === options.parser);
    if (!p) {
      console.error(`Error: Parser "${options.parser}" not found. Available parsers: ${parsers.map(parser => parser.name).join(', ')}`);
      process.exit(1);
    }
    filenameParserFactory.setOverrideParser(p);
    console.log(`📋 Filename parser override set to: ${p.name}`);
  }

  if (mode === 'transcribe' || mode === 'both') {
    console.log(`🔊 Transcription service: ${service}`);
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

  if (mode === 'analyse' || mode === 'both' || mode === 'default') {
    console.log(`🔍 Analysis service: ${analysisService}`);
    if (analysisService === 'gemini') {
      console.log('💎 Gemini analysis service selected');
      const cfgMb = parseFloat(String(options.analysisMaxMb ?? process.env.ANALYSIS_MAX_MB ?? '2'));
      const effectiveMb = isNaN(cfgMb) || cfgMb <= 0 ? 2 : cfgMb;
      console.log(`📏 Max analysis file size: ${effectiveMb} MB`);
      const cfgMinSec = parseFloat(String(options.analysisMinSeconds ?? process.env.ANALYSIS_MIN_SECONDS ?? '60'));
      const effectiveMinSec = isNaN(cfgMinSec) || cfgMinSec < 0 ? 60 : Math.floor(cfgMinSec);
      console.log(`⏱️  Min analysis duration: ${effectiveMinSec} seconds`);
    } else {
      throw new Error(`Unsupported analysis service: ${analysisService}. Use 'gemini'`);
    }
  }

  if (mode === 'overview') {
    console.log('🔄 Starting overview generation...');
    await processOverviewAtBase(folder);
    console.log('✅ Overview generation completed');
    console.log(`✅ ${mode.charAt(0).toUpperCase() + mode.slice(1)} process completed successfully`);
    return;
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
  if (mode === 'default') {
    // Default pipeline: analyse -> summary -> overview
    console.log('🔄 Starting analysis process...');
    await processAnalysis(folder, options);
    console.log('✅ Analysis completed');

    console.log('🔄 Starting summary generation...');
    await processSummary(folder, supportedExtensions);
    console.log('✅ Summary generation completed');

    console.log('🔄 Starting overview generation...');
    await processOverviewAtBase(folder);
    console.log('✅ Overview generation completed');

    console.log(`✅ Default process completed successfully`);
    return;
  }
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

  if (mode === 'analyse' || mode === 'both') {
    console.log('🔄 Starting analysis process...');
    await processAnalysis(folder, options);
    console.log('✅ Analysis completed');
  }

  console.log(`✅ ${mode.charAt(0).toUpperCase() + mode.slice(1)} process completed successfully`);
}

async function processTranscription(folder: string, options: TranscribeOptions, extensions: string[]): Promise<void> {
  const { model = 'whisper-1', apiKey, service = 'whisper' } = options;

  // Create provider instance based on service
  let provider: TranscriptionProvider;

  // Only create AudioConverter for providers that need it
  const converter = new AudioConverter();

  switch (service) {
    case 'whisper':
      provider = new WhisperProvider(converter);
      break;
    case 'google':
      provider = new GoogleProvider(converter);
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
  // Collect rows across all subfolders and write a concatenated CSV
  // into the same folder the user invoked (e.g., input/summary.csv).
  const aggregate: any[] = [];
  await processFolderForSummary(folder, extensions, aggregate);

  try {
    if (aggregate.length > 0) {
      await generateCsvFile(folder, aggregate);
      console.log(`📊 Concatenated CSV generated: ${path.join(folder, 'summary.csv')}`);
    }
  } catch (error) {
    console.error(`❌ Failed to generate concatenated CSV: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function processAnalysis(folder: string, options: TranscribeOptions): Promise<void> {
  const { analysisService = 'gemini' } = options;

  // Create provider instance based on service
  let provider: AnalysisProvider;

  switch (analysisService) {
    case 'gemini':
      provider = new GeminiAnalysisProvider();
      break;
    default:
      throw new Error(`Unsupported analysis service: ${analysisService}. Use 'gemini'`);
  }

  await processFolderForAnalysis(folder, provider, options);
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

async function processFolderForSummary(folder: string, extensions: string[], aggregate?: any[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 SUMMARY - SCANNING DIRECTORY: ${folder}`);
  console.log(`${'='.repeat(80)}`);

  const items = await fs.readdir(folder, { withFileTypes: true });
  console.log(`📋 Found ${items.length} items in ${folder}\n`);

  let processedCount = 0;
  let dirCount = 0;
  const csvData: any[] = [];
  const outgoingAnalyses: any[] = [];
  const incomingAnalyses: any[] = [];
  const deactivationAnalyses: any[] = [];

  for (const item of items) {
    const fullPath = path.join(folder, item.name);

    if (item.isDirectory()) {
      console.log(`📁 Entering subdirectory: ${fullPath}`);
      dirCount++;
      await processFolderForSummary(fullPath, extensions, aggregate);
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
        const metadata = filenameParserFactory.parseFilenameMetadata(item.name);
        const duration = await getAudioDuration(fullPath);

        // Try to read analysis JSON if present
        const analysisJsonPath = path.join(folder, path.basename(item.name, ext) + '_analysis.json');
        let analysis: any | null = null;
        try {
          const analysisContent = await fs.readFile(analysisJsonPath, 'utf8');
          analysis = JSON.parse(analysisContent);
          console.log(`✅ Found analysis file: ${analysisJsonPath}`);
        } catch {
          // No analysis available
          analysis = null;
          console.log(`ℹ️  No analysis found for: ${item.name}`);
        }

        const row: any = {
          filename: item.name,
          duration: duration || 'N/A',
          hasTranscription: hasTranscription,
          hasAnalysis: Boolean(analysis),
          ...metadata
        };

        if (analysis) {
          // Map selected analysis fields into flat CSV-friendly values
          row.gender = analysis.gender ?? '';
          row.sentiment = analysis.sentiment ?? '';
          row.confidence = analysis.confidence ?? '';
          row.paymentIntent = analysis.payment_intent ?? '';
          row.nextBestAction = analysis.next_best_action ?? '';
          row.todo = Array.isArray(analysis.todo) ? analysis.todo.join(' | ') : '';
          if (Array.isArray(analysis.call_tags)) {
            const tagNames: string[] = analysis.call_tags
              .map((t: any) => (t?.tag ?? '').toString().trim())
              .filter((v: string) => v.length > 0);
            const seen = new Set<string>();
            const uniqueTags: string[] = [];
            for (const name of tagNames) {
              const key = name.toLowerCase();
              if (!seen.has(key)) {
                seen.add(key);
                uniqueTags.push(name);
              }
            }
            row.callTagsCount = uniqueTags.length;
            row.callTags = uniqueTags.join(' | ');
          } else {
            row.callTagsCount = '';
            row.callTags = '';
          }
          row.concernsCount = Array.isArray(analysis.concerns) ? analysis.concerns.length : '';

          const insights = analysis.advanced_insights || {};
          row.emotionalState = insights.emotional_state ?? '';
          row.conversionProbability = insights.conversion_probability ?? '';
          row.urgencyLevel = insights.urgency_level ?? '';
          const agentFeedback = insights.agent_feedback || {};
          row.rapportScore = agentFeedback.rapport_score ?? '';
          row.missedOpportunity = agentFeedback.missed_opportunity ?? '';

          // Classify this analysis JSON into grouped arrays for this folder
          try {
            const isDeactivation = Array.isArray(analysis.call_tags) && analysis.call_tags.some((t: any) => String(t?.tag ?? '').toLowerCase() === 'deactivation');
            const analysisWithMeta = {
              filename: item.name,
              callType: metadata.callType,
              timestamp: metadata.timestamp,
              phoneNumber: metadata.phoneNumber,
              duration: row.duration,
              ...analysis
            };
            const callTypeLower = (metadata.callType || '').toLowerCase();
            if (isDeactivation) {
              deactivationAnalyses.push(analysisWithMeta);
            } else if (callTypeLower.includes('outgoing')) {
              outgoingAnalyses.push(analysisWithMeta);
            } else if (callTypeLower.includes('incoming') || callTypeLower.includes('incomming')) {
              incomingAnalyses.push(analysisWithMeta);
            }
          } catch {}
        }

        csvData.push(row);
        if (aggregate) aggregate.push(row);
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

  // Write grouped analysis arrays in this folder
  try {
    await fs.writeFile(path.join(folder, 'outgoing_calls.json'), JSON.stringify(outgoingAnalyses, null, 2), 'utf8');
    await fs.writeFile(path.join(folder, 'incoming_calls.json'), JSON.stringify(incomingAnalyses, null, 2), 'utf8');
    await fs.writeFile(path.join(folder, 'deactivation_calls.json'), JSON.stringify(deactivationAnalyses, null, 2), 'utf8');
    console.log('📦 Grouped JSON written (outgoing_calls.json, incoming_calls.json, deactivation_calls.json)');
  } catch (e) {
    console.warn(`⚠️  Failed writing grouped JSON in ${folder}`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY GENERATION: ${folder}`);
  console.log(`   • Processed: ${processedCount} files`);
  console.log(`   • Subdirectories: ${dirCount}`);
  console.log(`   • CSV generated: summary.csv`);
  console.log(`${'='.repeat(80)}\n`);
}

async function processOverview(folder: string): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 OVERVIEW - SCANNING DIRECTORY: ${folder}`);
  console.log(`${'='.repeat(80)}`);

  const items = await fs.readdir(folder, { withFileTypes: true });
  let summaryFoundHere = false;
  let dirCount = 0;

  // If current folder has a summary.csv, compute overview and write overview.csv
  const summaryPath = path.join(folder, 'summary.csv');
  try {
    await fs.access(summaryPath);
    summaryFoundHere = true;
  } catch {}

  if (summaryFoundHere) {
    try {
      const content = await fs.readFile(summaryPath, 'utf8');
      const parsed = parseCsv(content);
      const headers = parsed.headers;
      const rows = parsed.rows;

      const idxDuration = headers.findIndex(h => h.toLowerCase() === 'duration');
      const idxPhone = headers.findIndex(h => h.toLowerCase() === 'phone number');
      const idxCallType = headers.findIndex(h => h.toLowerCase() === 'call type');

      let total = 0;
      let overMinute = 0;
      let incoming = 0;
      let outgoing = 0;
      const uniquePhones = new Set<string>();

      for (const r of rows) {
        if (!r || r.length === 0) continue;
        total++;
        const phone = idxPhone >= 0 ? (r[idxPhone] || '').trim() : '';
        if (phone) uniquePhones.add(phone);
        const durationStr = idxDuration >= 0 ? (r[idxDuration] || '').trim() : '';
        if (durationStr) {
          const sec = hmsToSeconds(durationStr);
          if (sec > 60) overMinute++;
        }
        const callType = (idxCallType >= 0 ? (r[idxCallType] || '') : '').toLowerCase();
        if (callType.includes('outgoing')) outgoing++;
        else if (callType.includes('incoming') || callType.includes('incomming')) incoming++;
      }

      const overviewHeaders = [
        'Folder',
        'Total Calls',
        'Unique Phone Numbers',
        'Calls > 1:00',
        'Incoming',
        'Outgoing'
      ];
      const csvEscape = (val: unknown): string => {
        const s = String(val ?? '');
        const escaped = s.replace(/"/g, '""');
        return `"${escaped}"`;
      };
      let out = overviewHeaders.join(',') + '\n';
      out += [
        csvEscape(folder),
        csvEscape(total),
        csvEscape(uniquePhones.size),
        csvEscape(overMinute),
        csvEscape(incoming),
        csvEscape(outgoing)
      ].join(',') + '\n';

      const overviewPath = path.join(folder, 'overview.csv');
      await fs.writeFile(overviewPath, out, 'utf8');
      console.log(`📊 Overview generated: ${overviewPath}`);
    } catch (e) {
      console.error(`❌ Failed computing overview for ${folder}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Recurse into subdirectories
  for (const item of items) {
    if (item.isDirectory()) {
      dirCount++;
      await processOverview(path.join(folder, item.name));
    }
  }

  console.log(`📁 Directories scanned: ${dirCount}`);
}

function hmsToSeconds(hms: string): number {
  const parts = hms.split(':');
  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    const s = parseInt(ss || '0', 10);
    const m = parseInt(mm || '0', 10);
    const h = parseInt(hh || '0', 10);
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [mm, ss] = parts;
    const s = parseInt(ss || '0', 10);
    const m = parseInt(mm || '0', 10);
    return m * 60 + s;
  }
  const n = parseInt(hms, 10);
  return isNaN(n) ? 0 : n;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length === 1 && row[0] === '') continue; // skip blank
    rows.push(row);
  }
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur);
  return result;
}

async function processOverviewAtBase(baseFolder: string): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 OVERVIEW - SCANNING DIRECTORY TREE: ${baseFolder}`);
  console.log(`${'='.repeat(80)}`);

  const summaryFiles: { folder: string; path: string }[] = [];

  async function walk(folder: string) {
    const items = await fs.readdir(folder, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(folder, item.name);
      if (item.isDirectory()) {
        const summaryPath = path.join(fullPath, 'summary.csv');
        try {
          await fs.access(summaryPath);
          summaryFiles.push({ folder: fullPath, path: summaryPath });
        } catch {}
        await walk(fullPath);
      }
    }
  }

  await walk(baseFolder);

  // Also ensure concatenated summary.csv exists at base by merging subfolder summaries
  try {
    if (summaryFiles.length > 0) {
      const first = await fs.readFile(summaryFiles[0].path, 'utf8');
      const { headers: aggHeaders } = parseCsv(first);
      let aggOut = aggHeaders.join(',') + '\n';
      for (const s of summaryFiles) {
        const content = await fs.readFile(s.path, 'utf8');
        const lines = content.split(/\r?\n/);
        // skip header line for each file
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().length === 0) continue;
          aggOut += line + '\n';
        }
      }
      await fs.writeFile(path.join(baseFolder, 'summary.csv'), aggOut, 'utf8');
      console.log(`📊 Concatenated CSV ensured at base: ${path.join(baseFolder, 'summary.csv')}`);
    }
  } catch (e) {
    console.warn(`⚠️  Could not generate base concatenated summary: ${e instanceof Error ? e.message : String(e)}`);
  }

  const rowsOut: string[][] = [];
  let overallTotal = 0;
  let overallOverMinute = 0;
  let overallIncoming = 0;
  let overallOutgoing = 0;
  let overallTalkSeconds = 0;
  const overallPhones = new Set<string>();
  const hourBuckets: { totalSeconds: number; calls: number }[] = Array.from({ length: 24 }, () => ({ totalSeconds: 0, calls: 0 }));

  const overviewHeaders = [
    'Folder',
    'Total Calls',
    'Unique Phone Numbers',
    'Calls > 1:00',
    'Incoming',
    'Outgoing',
    'Unique Outgoing >1:00',
    'Total Talk Time'
  ];
  const csvEscape = (val: unknown): string => {
    const s = String(val ?? '');
    const escaped = s.replace(/\"/g, '""');
    return `"${escaped}"`;
  };

  // Track overall unique outgoing >1:00 across all folders
  const overallOutgoingLongPhones = new Set<string>();

  for (const s of summaryFiles) {
    try {
      const content = await fs.readFile(s.path, 'utf8');
      const { headers, rows } = parseCsv(content);
      const idxDuration = headers.findIndex(h => h.toLowerCase() === 'duration');
      const idxPhone = headers.findIndex(h => h.toLowerCase() === 'phone number');
      const idxCallType = headers.findIndex(h => h.toLowerCase() === 'call type');
      const idxTimestamp = headers.findIndex(h => h.toLowerCase() === 'timestamp');

      let total = 0;
      let overMinute = 0;
      let incoming = 0;
      let outgoing = 0;
      let talkSeconds = 0;
      const phones = new Set<string>();
      const outgoingLongPhones = new Set<string>();

      for (const r of rows) {
        if (!r || r.length === 0) continue;
        total++;
        const phone = idxPhone >= 0 ? (r[idxPhone] || '').trim() : '';
        if (phone) phones.add(phone);
        const durationStr = idxDuration >= 0 ? (r[idxDuration] || '').trim() : '';
        if (durationStr) {
          const sec = hmsToSeconds(durationStr);
          talkSeconds += sec;
          if (sec > 60) overMinute++;
        }
        const callType = (idxCallType >= 0 ? (r[idxCallType] || '') : '').toLowerCase();
        if (callType.includes('outgoing')) {
          outgoing++;
          if (durationStr) {
            const sec = hmsToSeconds(durationStr);
            if (sec > 60 && phone) outgoingLongPhones.add(phone);
          }
        }
        else if (callType.includes('incoming') || callType.includes('incomming')) incoming++;

        // Hourly aggregation
        try {
          if (idxTimestamp >= 0 && durationStr) {
            const ts = (r[idxTimestamp] || '').trim();
            const hour = extractHour(ts);
            if (hour !== null) {
              hourBuckets[hour].totalSeconds += hmsToSeconds(durationStr);
              hourBuckets[hour].calls += 1;
            }
          }
        } catch {}
      }

      overallTotal += total;
      overallOverMinute += overMinute;
      overallIncoming += incoming;
      overallOutgoing += outgoing;
      overallTalkSeconds += talkSeconds;
      for (const p of phones) overallPhones.add(p);
      for (const p of outgoingLongPhones) overallOutgoingLongPhones.add(p);

      const rel = path.relative(baseFolder, s.folder) || '.';
      rowsOut.push([
        csvEscape(rel),
        csvEscape(total),
        csvEscape(phones.size),
        csvEscape(overMinute),
        csvEscape(incoming),
        csvEscape(outgoing),
        csvEscape(outgoingLongPhones.size),
        csvEscape(secondsToHms(talkSeconds))
      ]);
    } catch (e) {
      console.error(`❌ Failed computing overview for ${s.folder}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  rowsOut.push([
    csvEscape('OVERALL'),
    csvEscape(overallTotal),
    csvEscape(overallPhones.size),
    csvEscape(overallOverMinute),
    csvEscape(overallIncoming),
    csvEscape(overallOutgoing),
    csvEscape(overallOutgoingLongPhones.size),
    csvEscape(secondsToHms(overallTalkSeconds))
  ]);

  let out = overviewHeaders.join(',') + '\n';
  out += rowsOut.map(r => r.join(',')).join('\n') + (rowsOut.length ? '\n' : '');

  const overviewPath = path.join(baseFolder, 'overview.csv');
  await fs.writeFile(overviewPath, out, 'utf8');
  console.log(`📊 Overview generated: ${overviewPath}`);

  // Print a readable overview table to console
  try {
    printTableToConsole(overviewHeaders, rowsOut);
  } catch {}
  // Write and print hourly overview
  try {
    const hourHeaders = ['Hour', 'Total Minutes', 'Calls'];
    const hourRows: string[][] = [];
    for (let h = 0; h < 24; h++) {
      const label = `${String(h).padStart(2, '0')}:00-${String((h + 1) % 24).padStart(2, '0')}:00`;
      const minutes = (hourBuckets[h].totalSeconds / 60).toFixed(2);
      hourRows.push([
        `"${label}"`,
        `"${minutes}"`,
        `"${hourBuckets[h].calls}"`
      ]);
    }
    const hourPath = path.join(baseFolder, 'overview-by-hour.csv');
    let hourCsv = hourHeaders.join(',') + '\n' + hourRows.map(r => r.join(',')).join('\n') + '\n';
    await fs.writeFile(hourPath, hourCsv, 'utf8');
    console.log(`📊 Hourly overview generated: ${hourPath}`);
    printTableToConsole(hourHeaders, hourRows);
  } catch (e) {
    console.warn(`⚠️  Could not generate hourly overview: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Build grouped analysis JSON arrays across subfolders and write at base
  try {
    const outgoingAll: any[] = [];
    const incomingAll: any[] = [];
    const deactivationAll: any[] = [];

    for (const s of summaryFiles) {
      try {
        const items = await fs.readdir(s.folder, { withFileTypes: true });
        for (const it of items) {
          if (it.isFile() && it.name.endsWith('_analysis.json')) {
            const p = path.join(s.folder, it.name);
            try {
              const content = await fs.readFile(p, 'utf8');
              const obj = JSON.parse(content);
              const baseName = it.name.replace(/_analysis\.json$/i, '');
              const meta = filenameParserFactory.parseFilenameMetadata(baseName);
              const isDeactivation = Array.isArray(obj.call_tags) && obj.call_tags.some((t: any) => String(t?.tag ?? '').toLowerCase() === 'deactivation');
              const withMeta = { filename: baseName, callType: meta.callType, timestamp: meta.timestamp, phoneNumber: meta.phoneNumber, ...obj };
              const ctLower = (meta.callType || '').toLowerCase();
              if (isDeactivation) {
                deactivationAll.push(withMeta);
              } else if (ctLower.includes('outgoing')) {
                outgoingAll.push(withMeta);
              } else if (ctLower.includes('incoming') || ctLower.includes('incomming')) {
                incomingAll.push(withMeta);
              }
            } catch {}
          }
        }
      } catch {}
    }

    await fs.writeFile(path.join(baseFolder, 'outgoing_calls.json'), JSON.stringify(outgoingAll, null, 2), 'utf8');
    await fs.writeFile(path.join(baseFolder, 'incoming_calls.json'), JSON.stringify(incomingAll, null, 2), 'utf8');
    await fs.writeFile(path.join(baseFolder, 'deactivation_calls.json'), JSON.stringify(deactivationAll, null, 2), 'utf8');
    console.log('📦 Grouped JSON written at base (outgoing_calls.json, incoming_calls.json, deactivation_calls.json)');
  } catch (e) {
    console.warn(`⚠️  Could not build grouped analysis JSON at base: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function secondsToHms(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function printTableToConsole(headers: string[], rows: string[][]): void {
  // Compute column widths
  const widths = headers.map((h, i) => {
    const colVals = rows.map(r => (r[i] ?? '').replace(/^"|"$/g, ''));
    return Math.max(h.length, ...colVals.map(v => v.length));
  });

  const fmtRow = (cols: string[]) =>
    cols
      .map((c, i) => (c.replace(/^"|"$/g, '')).padEnd(widths[i]))
      .join('  ');

  console.log('\nOverview');
  console.log(fmtRow(headers));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log(fmtRow(r));
  }
}

function extractHour(ts: string): number | null {
  // Timestamp format expected: YYYY-MM-DD HH:MM:SS (UTC-based from toISOString())
  // Safely parse hour component
  try {
    if (!ts || ts.length < 13) return null;
    const hourStr = ts.substring(11, 13);
    const hr = parseInt(hourStr, 10);
    if (isNaN(hr) || hr < 0 || hr > 23) return null;
    return hr;
  } catch {
    return null;
  }
}

async function processFolderForAnalysis(folder: string, provider: AnalysisProvider, options: TranscribeOptions): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📂 ANALYSIS - SCANNING DIRECTORY: ${folder}`);
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
      await processFolderForAnalysis(fullPath, provider, options);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (['.mp3', '.wav', '.mp4', '.m4a', '.flac', '.ogg', '.amr'].includes(ext)) {
        console.log(`\n${'-'.repeat(60)}`);
        console.log(`🔍 ANALYZING FILE: ${item.name}`);
        console.log(`${'-'.repeat(60)}`);

        // Enforce max file size for analysis (default 2 MB, configurable)
        try {
          const cfgMb = parseFloat(String(options.analysisMaxMb ?? process.env.ANALYSIS_MAX_MB ?? '2'));
          const effectiveMb = isNaN(cfgMb) || cfgMb <= 0 ? 2 : cfgMb;
          const maxBytes = Math.floor(effectiveMb * 1024 * 1024);
          const stat = await fs.stat(fullPath);
          if (stat.size > maxBytes) {
            console.log(`⏭️  SKIPPING: File size ${(stat.size / (1024 * 1024)).toFixed(2)} MB exceeds analysis limit of ${effectiveMb} MB`);
            skippedCount++;
            continue;
          }
        } catch (e) {
          console.warn('⚠️  Could not determine file size; proceeding with analysis');
        }

        // Enforce minimum duration for analysis (default 60s, configurable)
        try {
          const cfgMinSec = parseFloat(String(options.analysisMinSeconds ?? process.env.ANALYSIS_MIN_SECONDS ?? '60'));
          const effectiveMinSec = isNaN(cfgMinSec) || cfgMinSec < 0 ? 60 : Math.floor(cfgMinSec);
          const durationStr = await getAudioDuration(fullPath);
          if (durationStr) {
            const [hh, mm, ss] = durationStr.split(':');
            const seconds = (parseInt(hh || '0') * 3600) + (parseInt(mm || '0') * 60) + parseInt(ss || '0');
            if (seconds < effectiveMinSec) {
              console.log(`⏭️  SKIPPING: Duration ${durationStr} is under ${effectiveMinSec} seconds`);
              skippedCount++;
              continue;
            }
          } else {
            console.warn('⚠️  Duration unknown; proceeding with analysis');
          }
        } catch (e) {
          console.warn('⚠️  Could not determine duration; proceeding with analysis');
        }

        const jsonPath = path.join(folder, path.basename(item.name, ext) + '_analysis.json');
        try {
          await fs.access(jsonPath);
          console.log(`⏭️  SKIPPING: Analysis already exists`);
          skippedCount++;
        } catch {
          console.log(`🔍 STARTING ANALYSIS...`);
          console.log(`🔧 Service: ${provider.name}`);
          await provider.analyzeTranscription(fullPath);
          processedCount++;
        }
      } else {
        console.log(`❌ SKIPPING: ${item.name} (unsupported format: ${ext})`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ANALYSIS SUMMARY: ${folder}`);
  console.log(`   • Processed: ${processedCount} files`);
  console.log(`   • Skipped: ${skippedCount} files`);
  console.log(`   • Subdirectories: ${dirCount}`);
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


async function generateCsvFile(folder: string, csvData: any[]): Promise<void> {
  const csvPath = path.join(folder, 'summary.csv');

  try {
    // CSV header (includes analysis fields when available)
    const headers = [
      'Filename',
      'Duration',
      'Has Transcription',
      'Has Analysis',
      'Timestamp',
      'Phone Number',
      'Call Type',
      'Gender',
      'Sentiment',
      'Confidence',
      'Emotional State',
      'Rapport Score',
      'Call Tags',
      'Call Tags Count',
      'Payment Intent',
      'Next Best Action',
      'To-Do',
      'Concerns Count',
      'Conversion Probability',
      'Urgency Level',
      'Missed Opportunity'
    ];

    const csvEscape = (val: unknown): string => {
      const s = String(val ?? '');
      const escaped = s.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    let csvContent = headers.join(',') + '\n';

    // Add data rows
    for (const row of csvData) {
      const values = [
        csvEscape(row.filename),
        csvEscape(row.duration),
        csvEscape(row.hasTranscription ? 'Yes' : 'No'),
        csvEscape(row.hasAnalysis ? 'Yes' : 'No'),
        csvEscape(row.timestamp),
        csvEscape(row.phoneNumber),
        csvEscape(row.callType),
        csvEscape(row.gender),
        csvEscape(row.sentiment),
        csvEscape(row.confidence),
        csvEscape(row.emotionalState),
        csvEscape(row.rapportScore),
        csvEscape(row.callTags),
        csvEscape(row.callTagsCount),
        csvEscape(row.paymentIntent),
        csvEscape(row.nextBestAction),
        csvEscape(row.todo),
        csvEscape(row.concernsCount),
        csvEscape(row.conversionProbability),
        csvEscape(row.urgencyLevel),
        csvEscape(row.missedOpportunity)
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
