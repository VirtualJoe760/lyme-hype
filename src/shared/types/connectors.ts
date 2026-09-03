/** MCP connector definitions, as stored and as viewed. */

export type ConnectorKind = 'stdio' | 'http'

/** 'oauth' = the MCP server authorizes via an OAuth browser flow (http only);
 *  tokens are stored in the vault, never typed by anyone. */
export type ConnectorAuthType = 'none' | 'apiKey' | 'bearer' | 'oauth'

/**
 * A generic MCP connector — the product requirement is that a user can add one
 * we've never heard of, not just the pre-templated ones. Non-secret fields only;
 * the credential lives in the safeStorage vault keyed by this connector's id.
 */
export interface ConnectorDef {
  id: string
  name: string
  kind: ConnectorKind
  /** stdio: the local command + args. */
  command?: string
  args?: string[]
  /** http: the server URL. */
  url?: string
  /** Non-secret env vars (stdio) passed to the child process. */
  env?: Record<string, string>
  authType: ConnectorAuthType
  /**
   * Where the secret is injected: for stdio, the env-var name; for http, the
   * header name. Ignored when authType is 'none'.
   */
  secretKey?: string
  /** Label shown in the secure-credential modal. */
  secretFieldLabel: string
  /** Built-in template (ChatRealty) — present by default, not user-deletable. */
  builtin?: boolean
  docUrl?: string
}

export interface ConnectorView extends ConnectorDef {
  hasCredential: boolean
}

export interface ConnectorTestResult {
  ok: boolean
  serverName?: string
  serverVersion?: string
  toolCount?: number
  note?: string
  error?: string
}

/**
 * A known tool in the suggested-connectors catalog. "Open setup page" drives the
 * browser to keyPageUrl; "Add" installs `template` as an installed connector.
 * `available: false` means it needs transport support not built yet (http MCP,
 * OAuth, a Gemini wrapper) — still worth showing so the user can grab the key.
 */
export interface ConnectorSuggestion {
  id: string
  name: string
  blurb: string
  category: string
  keyPageUrl: string
  installed: boolean
  available: boolean
  note?: string
}
