# Call Recording Transcriber

A Node.js command-line application that recursively transcribes audio/video files in a folder using OpenAI Whisper API.

## Features

- **Recursive file processing**: Traverses all subfolders to find audio/video files
- **Supported formats**: mp3, wav, mp4, m4a, flac, ogg, amr (with FFmpeg conversion)
- **Default input folder**: `./input` (can be overridden)
- **Whisper model**: Uses OpenAI's Whisper model for high-quality transcription
- **Skip existing transcriptions**: If a `.txt` file already exists for an audio/video file, it skips processing
- **OpenAI API authentication**: Supports API key via `--api-key` option or `OPENAI_API_KEY` environment variable
- **TypeScript**: Fully typed with TypeScript for better development experience
- **Comprehensive debug logging**: Detailed progress information and error reporting

## Installation

```bash
npm install
npm run build
```

## Usage

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

## Development

```bash
# Run in development mode with ts-node
npm run dev /path/to/folder

# Build the project
npm run build
```

## Setup Requirements

1. **OpenAI API Key**: Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. **Configure Environment**: Copy `.env.example` to `.env` and add your API key
3. **Supported Audio Formats**: The app supports mp3, wav, mp4, m4a, flac, ogg, and amr files (.amr files are automatically converted to WAV using FFmpeg)

## Configuration

### Using .env file (Recommended)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your OpenAI API key:
   ```bash
   OPENAI_API_KEY=your_actual_openai_api_key_here
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

- `index.ts` - Main TypeScript source file
- `dist/` - Compiled JavaScript output
- `tsconfig.json` - TypeScript configuration
- `package.json` - Project dependencies and scripts
- `.env.example` - Environment variables template
- `.gitignore` - Git ignore rules (excludes .env files)

## Technologies Used

- **TypeScript** - For type safety and better development experience
- **OpenAI** - Whisper API for high-quality audio transcription
- **commander** - Command-line interface parsing
- **Node.js fs promises** - Asynchronous file operations
