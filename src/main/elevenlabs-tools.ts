import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importFileAsset } from './asset-store'
import { listConnectors } from './connectors-store'
import { readSecretValue } from './credential-vault'
import { McpStdioClient, type McpToolResult } from './mcp-client'

/**
 * Direct ElevenLabs tool calls for the Create panel's audio jobs — cheap,
 * deterministic single tool calls (the ChatRealtyPull shape), NOT the
 * agent-driven generation.ts path: browsing voices or running one TTS call
 * needs no orchestrating LLM turn (docs/ui/create-panel.md).
 *
 * The elevenlabs-mcp server writes output files under ELEVENLABS_MCP_BASE_PATH
 * and reports the path in its text reply — that path is parsed out and the
 * file imported into the asset store. Tool names come from the connector's own
 * catalog (docs/connectors/catalog.md); a missing/renamed tool surfaces its
 * MCP error verbatim rather than being papered over.
 */

export interface AudioToolResult {
  ok: boolean
  /** lyme-asset:// URL when the tool produced a file. */
  src?: string
  /** Raw text reply (voice listings, clone confirmations). */
  text?: string
  error?: string
}

function outDir(): string {
  const dir = join(tmpdir(), 'lyme-hype-elevenlabs')
  mkdirSync(dir, { recursive: true })
  return dir
}

async function withElevenLabs<T>(
  fn: (client: McpStdioClient) => Promise<T>
): Promise<T | { ok: false; error: string }> {
  const def = listConnectors().find((c) => c.id === 'elevenlabs')
  if (!def || !def.command) {
    return { ok: false, error: 'ElevenLabs is not installed — add it in Settings › Connectors.' }
  }
  const key = readSecretValue('elevenlabs')
  if (!key) {
    return { ok: false, error: 'ElevenLabs has no API key yet — set one in Settings › Connectors.' }
  }
  const client = new McpStdioClient()
  try {
    await client.start({
      command: def.command,
      args: def.args ?? [],
      env: {
        ...(def.env ?? {}),
        [def.secretKey ?? 'ELEVENLABS_API_KEY']: key,
        ELEVENLABS_MCP_BASE_PATH: outDir()
      }
    })
    return await fn(client)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    client.stop()
  }
}

function resultText(result: McpToolResult): string {
  return result.content
    .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
    .join(' ')
    .trim()
}

/** Pulls the produced file's absolute path out of the tool's text reply. */
export function extractFilePath(text: string): string | null {
  const match = text.match(
    /((?:[A-Za-z]:[\\/]|\/)[^\s"'`]+\.(?:mp3|wav|m4a|ogg|flac))/
  )
  return match ? match[1] : null
}

async function fileProducingCall(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<AudioToolResult> {
  const outcome = await withElevenLabs(async (client) => {
    // Generation tools run long — music composition especially — so the
    // client's default 45s tools/call timeout is far too tight here.
    // output_directory is a schema-verified param on every file-producing
    // tool; passing it beats relying on the ELEVENLABS_MCP_BASE_PATH env
    // alone (default is $HOME/Desktop otherwise).
    const result = await client.callTool(toolName, { output_directory: outDir(), ...args }, timeoutMs)
    const text = resultText(result)
    if (result.isError) return { ok: false as const, error: text || `${toolName} failed.` }
    const filePath = extractFilePath(text)
    if (!filePath) {
      return { ok: false as const, error: `No output file in the reply: ${text.slice(0, 300)}` }
    }
    const saved = importFileAsset(filePath)
    return { ok: true as const, src: saved.url, text }
  })
  return outcome as AudioToolResult
}

/** Best-effort parse of the server's voice listing into rows. The reply is
 *  prose, not JSON, so this matches the "Name: … / ID: …"-style blocks it
 *  emits today and degrades to the raw text when nothing parses. */
export function parseVoiceListing(text: string): { name: string; tags: string }[] {
  const voices: { name: string; tags: string }[] = []
  const blocks = text.split(/\n\s*\n|(?=\bName:\s)/g)
  for (const block of blocks) {
    const name = block.match(/Name:\s*([^\n,;]+)/i)?.[1]?.trim()
    if (!name) continue
    const category = block.match(/Category:\s*([^\n,;]+)/i)?.[1]?.trim()
    const labels = block.match(/Labels?:\s*([^\n]+)/i)?.[1]?.trim()
    const description = block.match(/Description:\s*([^\n]+)/i)?.[1]?.trim()
    const tags = [category, labels ?? description].filter(Boolean).join(' · ')
    voices.push({ name, tags: tags.slice(0, 60) })
  }
  return voices
}

export function searchVoices(query: string): Promise<AudioToolResult> {
  return withElevenLabs(async (client) => {
    // There is no list_voices tool on the official server — search_voices with
    // no search term IS the listing call (verified against the live schema).
    const result = await client.callTool(
      'search_voices',
      query.trim() ? { search: query.trim() } : {}
    )
    const text = resultText(result)
    if (result.isError) return { ok: false as const, error: text || 'Voice search failed.' }
    const voices = parseVoiceListing(text)
    return { ok: true as const, text, voices: voices.length > 0 ? voices : undefined }
  }) as Promise<AudioToolResult>
}

const PREVIEW_LINE = 'Sixty seconds. One story. Let’s make it move.'
const previewCache = new Map<string, string>()

/** Short cached TTS sample so a voice can be heard before the real spend —
 *  one tiny call per voice per app run, then it's free. */
export async function previewVoice(voiceName: string): Promise<AudioToolResult> {
  const key = voiceName.trim()
  if (!key) return { ok: false, error: 'No voice name.' }
  const cached = previewCache.get(key)
  if (cached) return { ok: true, src: cached }
  const result = await fileProducingCall('text_to_speech', { text: PREVIEW_LINE, voice_name: key }, 120_000)
  if (result.ok && result.src) previewCache.set(key, result.src)
  return result
}

export function textToSpeech(input: { text: string; voiceName?: string }): Promise<AudioToolResult> {
  const args: Record<string, unknown> = { text: input.text }
  if (input.voiceName?.trim()) args['voice_name'] = input.voiceName.trim()
  return fileProducingCall('text_to_speech', args, 180_000)
}

export function composeMusic(input: { prompt: string; lengthMs?: number }): Promise<AudioToolResult> {
  const args: Record<string, unknown> = { prompt: input.prompt }
  // Schema-verified bound: 3000–600000 ms.
  if (input.lengthMs) args['music_length_ms'] = Math.min(600_000, Math.max(3000, input.lengthMs))
  return fileProducingCall('compose_music', args, 600_000)
}

export function soundEffects(input: { prompt: string; durationSec?: number }): Promise<AudioToolResult> {
  const args: Record<string, unknown> = { text: input.prompt }
  // Schema-verified bound: the tool accepts 0.5–5 seconds only.
  if (input.durationSec) args['duration_seconds'] = Math.min(5, Math.max(0.5, input.durationSec))
  return fileProducingCall('text_to_sound_effects', args, 180_000)
}

/** Transcribe a clip via `speech_to_text` — the subtitle-text connection
 *  AGENTS.md §4 flags as not wired yet. Asks for the transcript inline
 *  (`return_transcript_to_client_directly`) rather than a saved file, since
 *  the only consumer today is the plain-text caption box, not a file import.
 *  Plain text only: the tool's schema exposes no per-word timestamps, so this
 *  isn't SRT/VTT-ready — burning captions into the export is the next step,
 *  blocked on that gap (see node-enrichment-strategy.md). */
export function transcribeAudio(input: { filePath: string; languageCode?: string }): Promise<AudioToolResult> {
  return withElevenLabs(async (client) => {
    const args: Record<string, unknown> = {
      input_file_path: input.filePath,
      return_transcript_to_client_directly: true,
      save_transcript_to_file: false
    }
    if (input.languageCode?.trim()) args['language_code'] = input.languageCode.trim()
    // Longer clips take a while; same timeout class as the other long-running
    // file-producing calls above.
    const result = await client.callTool('speech_to_text', args, 300_000)
    const text = resultText(result)
    if (result.isError) return { ok: false as const, error: text || 'Transcription failed.' }
    if (!text) return { ok: false as const, error: 'No transcript in the reply.' }
    return { ok: true as const, text }
  }) as Promise<AudioToolResult>
}

/** Voice cloning — "their own audio LoRA": sample files in, a reusable named
 *  voice out (usable from the Voice job's name field afterward). */
export function cloneVoice(input: { name: string; filePaths: string[] }): Promise<AudioToolResult> {
  return withElevenLabs(async (client) => {
    // Multi-file uploads run long — same reasoning as fileProducingCall.
    const result = await client.callTool(
      'voice_clone',
      {
        name: input.name,
        files: input.filePaths
      },
      600_000
    )
    const text = resultText(result)
    if (result.isError) return { ok: false as const, error: text || 'Voice clone failed.' }
    return { ok: true as const, text }
  }) as Promise<AudioToolResult>
}
