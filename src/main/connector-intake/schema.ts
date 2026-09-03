/**
 * Reading an MCP tool's JSON Schema into plain facts: which fields exist, what
 * they are called, which are required. No judgement about what the tool DOES —
 * that is the classifier's job.
 */

import type { ClassificationConfidence } from '@shared/intake-types'

/** Evidence sources, strongest first: a schema fact beats a name match, which
 *  beats a description match. `weaker` keeps the less certain of two. */
export const TIERS: ClassificationConfidence[] = ['schema', 'name', 'description']

export function weaker(a: ClassificationConfidence, b: ClassificationConfidence): ClassificationConfidence {
  return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b
}

/** `sourceVideoAssetId` → source video asset id; `images_data_url` → images data url. One
 *  token stream makes camelCase, snake_case and kebab-case servers match the same rules. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface SchemaField {
  name: string
  tokens: string[]
  type: string | null
  isArray: boolean
  required: boolean
}

export interface SchemaFacts {
  present: boolean
  fields: SchemaField[]
}

export function readType(prop: Record<string, unknown>): { type: string | null; isArray: boolean } {
  const raw = prop['type']
  const type = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : null
  if (type === 'array') return { type: 'array', isArray: true }
  return { type, isArray: false }
}

export function requiredNames(schema: Record<string, unknown>): Set<string> {
  const raw = schema['required']
  return new Set(Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [])
}

/** One level of nesting is walked because a wrapper object hides both halves of the job:
 *  a `{input: {command}}` tool must still trip the side-effect screen. Deeper than that is
 *  where field names stop describing the call and start describing a payload. */
export function collectFields(
  props: Record<string, unknown>,
  required: Set<string>,
  prefix: string,
  depth: number
): SchemaField[] {
  const out: SchemaField[] = []
  for (const [name, value] of Object.entries(props)) {
    const prop = isRecord(value) ? value : {}
    const { type, isArray } = readType(prop)
    const path = prefix ? `${prefix}.${name}` : name
    const isRequired = required.has(name)
    out.push({ name: path, tokens: tokenize(path), type, isArray, required: isRequired })
    const nested = prop['properties']
    if (depth > 0 && isRecord(nested)) {
      const nestedRequired = isRequired ? requiredNames(prop) : new Set<string>()
      out.push(...collectFields(nested, nestedRequired, path, depth - 1))
    }
  }
  return out
}

export function readSchema(inputSchema: unknown): SchemaFacts {
  if (!isRecord(inputSchema)) return { present: false, fields: [] }
  const props = inputSchema['properties']
  if (!isRecord(props)) return { present: false, fields: [] }
  const fields = collectFields(props, requiredNames(inputSchema), '', 1)
  // A tool that declares `properties: {}` published a contract saying "no arguments" — that
  // is a schema, and residue review should not read it as a server that told us nothing.
  return { present: true, fields }
}

export type FieldRole =
  | 'prompt'
  | 'text'
  | 'voice'
  | 'mask'
  | 'image'
  | 'video'
  | 'audio'
  | 'startFrame'
  | 'endFrame'
  | 'startVideo'
  | 'sourceRef'
  | 'targetRef'
  | 'trainingImages'
  | 'trainingControl'
  | 'loraRef'
  | 'referenceImages'
  | 'scaleFactor'
  | 'duration'
  | 'aspect'
  | 'outputCount'
  | 'dimension'
  | 'frameRate'

export const any = (f: SchemaField, ...tokens: string[]): boolean => tokens.some((t) => f.tokens.includes(t))
