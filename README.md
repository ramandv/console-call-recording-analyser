# Call Recording Transcriber & Analyzer

A Node.js command-line application that recursively transcribes audio/video files in a folder and analyzes transcriptions using various AI services.

## Features

- **Recursive file processing**: Traverses all subfolders to find audio/video files
- **Supported formats**: mp3, wav, mp4, m4a, flac, ogg, amr (with FFmpeg conversion)
- **Default input folder**: `./input` (can be overridden)
- **Multiple Transcription Services**: OpenAI Whisper, Google Speech-to-Text, Speechmatics, and Gemini
- **Skip existing transcriptions**: If a `.txt` file already exists for an audio/video file, it skips processing
- **AI-Powered Analysis**: Analyze transcriptions using Gemini AI for comprehensive insights
- **Multiple Operation Modes**: Full process, transcription-only, summary-only, or analysis-only
- **OpenAI API authentication**: Supports API key via `--api-key` option or `OPENAI_API_KEY` environment variable
- **TypeScript**: Fully typed with TypeScript for better development experience
- **Comprehensive debug logging**: Detailed progress information and error reporting
- **CSV Summary Generation**: Creates `summary.csv` with filename, duration, timestamp, phone number, and call type
- **Filename Metadata Parsing**: Extracts TP1 (timestamp), TP3 (phone), TP4 (call type) from filenames
- **Enhanced Console Output**: Clear separators and file-specific progress indicators
- **AI-Powered Summaries**: Automatically generates concise summaries for Gemini transcriptions using single-prompt approach
- **Structured Output Format**: Gemini transcriptions include both summary and full text with clear formatting
- **Modular Provider Architecture**: Extensible design for adding new transcription and analysis services

## Installation

```bash
npm install
npm run build
```

## Usage

### Full Process (Transcription + CSV Generation)
```bash
# Basic usage with default folder (./input)
npm start

# Or directly with the compiled version
node dist/index.js

# Specify custom folder
npm start /path/to/folder

# Use OpenAI API key
npm start -- --api-key your-openai-api-key

# Set environment variable
export OPENAI_API_KEY=your-openai-api-key
npm start

# Combine options
npm start /custom/folder -- --api-key your-openai-api-key
```

### Choose Transcription Service
```bash
# Use OpenAI Whisper (default)
npm start -- --service whisper

# Use Google Speech-to-Text v2
npm start -- --service google

# Combine with other options
npm start /path/to/folder -- --service google --transcribe-only
```

### Separate Operations

#### Transcription Only
```bash
# Using npm start (requires -- to pass flags to the script)
npm start -- --transcribe-only
npm start -- -t

# Direct execution (no -- needed)
node dist/index.js --transcribe-only
node dist/index.js -t

# With custom folder
npm start /path/to/folder -- --transcribe-only
npm start /path/to/folder -- -t
node dist/index.js /path/to/folder --transcribe-only
node dist/index.js /path/to/folder -t
```

#### Summary Generation Only
```bash
# Using npm start (requires -- to pass flags to the script)
npm start -- --summary-only
npm start -- -s

# Direct execution (no -- needed)
node dist/index.js --summary-only
node dist/index.js -s

# With custom folder
npm start /path/to/folder -- --summary-only
npm start /path/to/folder -- -s
node dist/index.js /path/to/folder --summary-only
node dist/index.js /path/to/folder -s
```

#### Analysis Only
```bash
# Using npm start (requires -- to pass flags to the script)
npm start -- --analyse-only
npm start -- -a

# Direct execution (no -- needed)
node dist/index.js --analyse-only
node dist/index.js -a

# With custom folder
npm start /path/to/folder -- --analyse-only
npm start /path/to/folder -- -a
node dist/index.js /path/to/folder --analyse-only
node dist/index.js /path/to/folder -a
```

## Gemini Transcription Output Format

When using the Gemini service (`--service gemini`), each transcription file includes both a summary and the full transcription text in a structured format. Gemini uses a single-prompt approach that generates both the transcription and summary in one API call.

### 📋 SUMMARY:
```
[AI-generated concise summary of the conversation]
```

### 🎙️ FULL TRANSCRIPTION:
```
[Complete transcription text with proper formatting]
```

### Example Gemini Output:
```
📋 SUMMARY:
The customer called to inquire about their recent order status. The representative confirmed that the order has been shipped and provided the tracking number. The customer expressed satisfaction with the service and mentioned they would recommend the company to others.


🎙️ FULL TRANSCRIPTION:
Hello, thank you for calling our customer service line. How can I help you today?

Hi, I wanted to check on my order that I placed last week. The order number is 12345.

Let me look that up for you. Yes, I can see that your order has been processed and shipped. The tracking number is 1Z999AA1234567890. You should receive it within the next 2-3 business days.

Great! That's exactly what I was hoping to hear. Your service has been excellent throughout this process.

We're glad to hear that! Is there anything else I can help you with today?

No, that's all. Thank you very much for your assistance.

You're welcome! Have a great day!
```

### Other Services
When using Whisper, Google, or Speechmatics services, only the transcription is generated without summaries.

## CSV Output

The application generates a `summary.csv` file in each processed directory. It includes file metadata and, when available, key fields from the per-file analysis JSON (`*_analysis.json`).

- **Filename**: Original audio file name
- **Duration**: Audio duration in HH:MM:SS format
- **Has Transcription**: Yes/No if a `.txt` exists
- **Has Analysis**: Yes/No if an `_analysis.json` exists
- **Timestamp**: Parsed from TP1 token in filename (YYYY-MM-DD HH:MM:SS)
- **Phone Number**: Parsed from TP3 token in filename
- **Call Type**: Parsed from TP4 token in filename (e.g., "outgoing", "incoming")
- **Sentiment, Confidence, Payment Intent, Next Best Action, To-Do**: From analysis JSON
- **Call Tags Count, Concerns Count**: Counts from analysis arrays
- **Advanced Insights**: Emotional State, Conversion Probability, Urgency Level, Rapport Score, Missed Opportunity

Example CSV output (columns abbreviated for brevity):
```csv
Filename,Duration,Has Transcription,Has Analysis,Timestamp,Phone Number,Call Type,Sentiment,Confidence,Payment Intent,Next Best Action
"recording-TP11755659148284TP2TP37561074523TP4outgoing.amr","00:00:20","Yes","Yes","2025-08-20 03:05:48","7561074523","outgoing","neutral","0.80","not_discussed","Share 2 high-fit profiles..."
```

## Analysis Output

The application can analyze audio files directly and generate structured JSON analysis files. Each audio file gets a corresponding analysis file (`_analysis.json`).

### Analysis Services

#### Gemini Analysis
Uses Google's Gemini AI to provide comprehensive analysis including:
- Sentiment analysis
- Key conversation points extraction
- Call classification and tagging
- Next best action recommendations
- Structured JSON output following a predefined schema

### Analysis Output Format

Analysis results are saved as JSON files with the following structure:

```json
{
  "summary": "Brief summary of the analysis",
  "keyPoints": [
    "Key point 1",
    "Key point 2"
  ],
  "sentiment": "positive | negative | neutral",
  "metadata": {
    "wordCount": 150,
    "lineCount": 25,
    "positiveScore": 3,
    "negativeScore": 0,
    "fileName": "recording.txt"
  }
}
```

### Example Gemini Analysis Output:
```json
{
  "sentiment": "neutral",
  "confidence": 0.8,
  "call_tags": [
    {
      "tag": "introduction",
      "speaker": "agent",
      "quote": "We focus on verified, serious profiles for second marriages.",
      "quality_score": 0.9
    }
  ],
  "concerns": [
    {
      "concern": "User not getting quality matches",
      "quote": "Most suggestions so far aren't relevant to my preferences.",
      "quality_score": 0.8
    }
  ],
  "payment_intent": "not_discussed",
  "next_best_action": "Share 2 high-fit profiles and offer a short RM-facilitated video meet",
  "todo": ["Mark for profile improvement tips", "Schedule a follow-up call"]
}
```

## Development

```bash
# Run in development mode with ts-node
npm run dev /path/to/folder

# Build the project
npm run build
```

## Setup Requirements

### For OpenAI Whisper (Default)
1. **OpenAI API Key**: Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. **Configure Environment**: Copy `.env.example` to `.env` and add your API key
3. **Supported Audio Formats**: The app supports mp3, wav, mp4, m4a, flac, ogg, and amr files (.amr files are automatically converted to WAV using FFmpeg)

### For Google Speech-to-Text
1. **Google Cloud Project**: Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. **Enable APIs**: Enable both Speech-to-Text API and Cloud Storage API for your project
3. **Service Account Key**: Create a service account and download the JSON key file
4. **Set Environment Variables**:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json
   export GOOGLE_CLOUD_STORAGE_BUCKET=your-transcription-bucket-name
   ```
5. **Create Cloud Storage Bucket**: Create a bucket for storing audio files longer than 1 minute
6. **Supported Audio Formats**: Same as OpenAI (mp3, wav, mp4, m4a, flac, ogg, amr)

### For Speechmatics
1. **Speechmatics Account**: Sign up at [Speechmatics](https://speechmatics.com/)
2. **API Key**: Get your API key from the Speechmatics dashboard
3. **Set Environment Variable**:
   ```bash
   export SPEECHMATICS_API_KEY=your-speechmatics-api-key
   ```
4. **Supported Audio Formats**: MP3, WAV, FLAC, OGG, AMR, M4A (AMR files processed directly without conversion!)

### For Gemini
1. **Google AI Studio**: Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Set Environment Variable**:
   ```bash
   export GEMINI_API_KEY=your-gemini-api-key
   ```
3. **Supported Audio Formats**: MP3, WAV, MP4, M4A, FLAC, OGG, AMR
4. **Features**: Transcription and summarization capabilities

#### Google Cloud Storage Setup for Long Audio Files
For audio files longer than 1 minute, Google requires the audio to be stored in Google Cloud Storage:

1. **Create a Bucket**:
   ```bash
   gsutil mb gs://your-transcription-bucket-name
   ```

2. **Set Bucket Permissions** (grant your service account access):
   ```bash
   gsutil iam ch serviceAccount:your-service-account@your-project.iam.gserviceaccount.com:objectAdmin gs://your-transcription-bucket-name
   ```

3. **Environment Variable**:
   ```bash
   export GOOGLE_CLOUD_STORAGE_BUCKET=your-transcription-bucket-name
   ```

The application will automatically:
- ✅ Use synchronous API for files ≤ 1 minute
- ✅ Upload files > 1 minute to GCS and use LongRunningRecognize
- ✅ Clean up GCS files after transcription
- ✅ Handle all errors with detailed guidance

## Configuration

### Using .env file (Recommended)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API keys and configuration:
   ```bash
   OPENAI_API_KEY=your_actual_openai_api_key_here
   AUDIO_SAMPLE_RATE=8000  # For 8kHz phone call AMR files
   # AUDIO_SAMPLE_RATE=16000  # For higher quality (default)
   GEMINI_MODEL=gemini-2.0-flash-lite  # Default Gemini model
   ```

3. Run the application:
   ```bash
   npm start
   ```

### Alternative Methods

You can also set the API key via environment variable or command line:

```bash
# Environment variable
export OPENAI_API_KEY=your_api_key
npm start

# Command line option
npm start -- --api-key your_api_key
```

## Project Structure

```
transcript_providers/
├── base-provider.ts          # Interface definition for all transcription providers
├── gemini-provider.ts        # Gemini AI transcription with speaker ID & summaries
├── speechmatics-provider.ts  # Speechmatics transcription with diarization
├── google-provider.ts        # Google Speech-to-Text with GCS support
└── whisper-provider.ts       # OpenAI Whisper transcription

audio_utils/
└── audio-converter.ts        # Audio conversion utility (AMR to WAV with configurable sample rate)

analysis_providers/
├── base-analysis.ts          # Interface definition for analysis providers
└── gemini-analysis.ts        # Gemini AI-powered transcription analysis with structured JSON output

index.ts                      # Main application entry point
dist/                         # Compiled JavaScript output
tsconfig.json                 # TypeScript configuration
package.json                  # Project dependencies and scripts
.env.example                  # Environment variables template
.gitignore                    # Git ignore rules (excludes .env files)
```

## Technologies Used

- **TypeScript** - For type safety and better development experience
- **OpenAI** - Whisper API for high-quality audio transcription
- **commander** - Command-line interface parsing
- **Node.js fs promises** - Asynchronous file operations
