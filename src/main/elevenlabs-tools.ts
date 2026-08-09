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
    const result = await client.callTool(toolName, args, timeoutMs)
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

export function searchVoices(query: string): Promise<AudioToolResult> {
  return withElevenLabs(async (client) => {
    const result = await client.callTool(
      query.trim() ? 'search_voices' : 'list_voices',
      query.trim() ? { search: query.trim() } : {}
    )
    const text = resultText(result)
    if (result.isError) return { ok: false as const, error: text || 'Voice search failed.' }
    return { ok: true as const, text }
  }) as Promise<AudioToolResult>
}

export function textToSpeech(input: { text: string; voiceName?: string }): Promise<AudioToolResult> {
  const args: Record<string, unknown> = { text: input.text }
  if (input.voiceName?.trim()) args['voice_name'] = input.voiceName.trim()
  return fileProducingCall('text_to_speech', args, 180_000)
}

export function composeMusic(input: { prompt: string }): Promise<AudioToolResult> {
  return fileProducingCall('compose_music', { prompt: input.prompt }, 600_000)
}

export function soundEffects(input: { prompt: string; durationSec?: number }): Promise<AudioToolResult> {
  const args: Record<string, unknown> = { text: input.prompt }
  if (input.durationSec) args['duration_seconds'] = input.durationSec
  return fileProducingCall('text_to_sound_effects', args, 180_000)
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
