# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web application that generates LLM-powered "third guest" commentary on Dwarkesh Patel podcast episodes. The project fetches YouTube transcripts, processes them with various frontier LLMs, and displays the AI-generated insights as blog-style posts. Think of it as a lightweight benchmark to track how well different models can follow expert conversations and contribute meaningful research directions.

## Commands

### Development

```bash
# Run dev server on port 3000
bun run dev

# Build for production (prerendered static site)
bun run build

# Preview production build
bun run preview

# Build and run production server
bun run build:preview
```

### Testing & Linting

```bash
# Run tests
bun run test

# Type checking
bun run typecheck

# Lint with oxlint (type-aware)
bun run lint:oxlint

# Auto-fix with oxlint
bun run lint:oxlint:fix

# Auto-fix including suggestions
bun run lint:oxlint:fix:fix-suggestions

# Dangerous auto-fix (use with caution)
bun run lint:oxlint:unsafe:fix

# Format code with oxfmt
bun run fmt:write

# Check formatting
bun run fmt:check
```

### Content Scripts

These scripts require environment variables (use `infisical run --` prefix in production):

```bash
# Fetch YouTube transcript and metadata
infisical run -- ./scripts/yt-transcript.ts add <youtube-url>
infisical run -- ./scripts/yt-transcript.ts list
infisical run -- ./scripts/yt-transcript.ts update-metadata <videoId>
infisical run -- ./scripts/yt-transcript.ts update-metadata --all
infisical run -- ./scripts/yt-transcript.ts reprocess-transcript <videoId>

# Generate LLM "third guest" post
infisical run -- ./scripts/llm-guest.ts generate <videoId>
infisical run -- ./scripts/llm-guest.ts generate <videoId> --models "claude-sonnet-4-20250514,openrouter/openai/gpt-4o"
infisical run -- ./scripts/llm-guest.ts generate --all
infisical run -- ./scripts/llm-guest.ts list
```

## Architecture

### Content Processing Pipeline

The project has a two-stage content generation pipeline:

1. **Transcript Generation** (`scripts/yt-transcript.ts`):
   - Downloads audio from YouTube using `yt-dlp`
   - Preprocesses audio to 16kHz mono MP3 with `ffmpeg`
   - Splits large files into chunks (configurable by size/duration)
   - Uploads chunks to S3 storage
   - Transcribes via Groq's Whisper API
   - Merges overlapping chunks with intelligent deduplication
   - Saves metadata to `src/content/podcasts-metadata/` and transcripts to `src/content/transcripts/`

2. **LLM Generation** (`scripts/llm-guest.ts`):
   - Reads podcast metadata and transcripts
   - Builds a prompt with transcript + system instructions (versioned in `src/llm-prompts.ts`)
   - Supports multiple LLM providers: Anthropic, OpenAI, OpenRouter, Groq, Google
   - Uses Effect AI library for unified LLM interface
   - Fetches model metadata from models.dev API for cost estimation
   - Saves markdown posts with frontmatter to `src/content/llm-generated/`

### Effect-TS Architecture

This project uses **Effect-TS** extensively for scripts and server-side code. Key patterns:

- **Services**: Encapsulated dependencies (FileService, YtDlpService, FfmpegService, etc.)
- **Error handling**: Tagged errors (YtDlpError, GroqTranscribeError, etc.) instead of thrown exceptions
- **Effect pipelines**: All async operations use Effect.gen and pipe for composability
- **Configuration**: Config layer with environment variables and defaults
- **CLI**: @effect/cli for structured command definitions

If you're modifying scripts, follow the existing Effect patterns:

- Use `yield*` for effects inside `Effect.gen`
- Create tagged errors extending `Data.TaggedError`
- Define services with `Effect.Service` and dependency injection
- Use `Config` for environment variables with defaults

### Frontend Stack

- **TanStack Start**: Full-stack React framework with file-based routing
- **TanStack Router**: Type-safe routing with prerendering enabled
- **Content Collections**: Transforms markdown frontmatter into typed collections
- **Vite**: Build tool with prerendering for static site generation
- **Tailwind CSS v4**: Styling with the Vite plugin
- **shadcn/ui**: React components built with Radix UI and styled with Tailwind

### Route Structure

Routes follow TanStack Router conventions in `src/routes/`:

- `__root.tsx`: Root layout with theme provider and navigation
- `index.tsx`: Homepage listing all podcast episodes with available models
- `llm/$videoId/$model.tsx`: Individual LLM-generated post viewer

### Content Schema

All content has versioned schemas (`schemaVersion: '0.0.1'`) defined in `src/lib/schemas/`:

- `podcast-metadata.ts`: YouTube video metadata
- `transcript.ts`: Groq transcription responses + audio metadata
- `llm-generated.ts`: LLM frontmatter with usage stats, costs, model info
- `models-dev.ts`: Model metadata from models.dev API

### Model Selection

`src/lib/model-priority.ts` defines priority order for which model to display by default when multiple models exist for the same episode. This affects the homepage default links.

### Markdown Processing

Custom markdown rendering in `src/utils/markdown.ts` using:

- `unified` + `remark` + `rehype` pipeline
- Supports GitHub Flavored Markdown
- Auto-generates heading IDs and anchor links
- Processes raw HTML in markdown

## Important Notes

- **Prerendering**: The site is fully prerendered at build time (`crawlLinks: true` in vite.config.ts). New content requires a rebuild.
- **Effect Language Service**: The project uses the Effect TypeScript plugin. Run `bun run prepare` after fresh install to patch TypeScript.
- **Bun Runtime**: Scripts use `#!/usr/bin/env bun` and Bun-specific APIs via `@effect/platform-bun`.
- **No nitro patch needed**: A previous patch for nitro was removed (see git status).
- **Oxlint/Oxfmt**: This project uses Oxc tools instead of ESLint/Prettier for faster linting/formatting.

## Environment Variables

Scripts require these environment variables (typically loaded via `infisical`):

**Transcript Generation:**

- `GROQ_API_KEY`: For Whisper transcription
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `S3_BUCKET`: S3-compatible storage
- `TRANSCRIPTION_MODEL`: "whisper-large-v3" or "whisper-large-v3-turbo" (default: whisper-large-v3)
- `MAX_CHUNK_SIZE_MB`, `MAX_CHUNK_DURATION_SECONDS`: Optional chunking config

**LLM Generation:**

- `ANTHROPIC_API_KEY`: For Claude models
- `OPENAI_API_KEY`: For OpenAI models (optional, can use OpenRouter)
- `OPENROUTER_API_KEY`: For accessing multiple models via OpenRouter
- `GROQ_API_KEY`: For Groq models (optional)
- `GOOGLE_API_KEY`: For Gemini models (optional)
- `LLM_MODEL`: Default model for generation (default: claude-sonnet-4-20250514)

## Path Aliases

- `@/*` maps to `src/*`
- `content-collections` maps to `.content-collections/generated`
