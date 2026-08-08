import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { net, shell } from 'electron'
import { deleteSecret, readSecretValue, storeSecret } from './credential-vault'

/**
 * Minimal MCP OAuth client (Streamable-HTTP servers that auth via OAuth rather
 * than a stored key): protected-resource discovery → auth-server metadata →
 * dynamic client registration → PKCE authorization in the system browser →
 * loopback redirect → token exchange. Tokens live in the vault under the
 * connector's id, exactly like typed keys — nobody types anything, and the
 * agent never sees a token (same boundary as the secure-credential modal).
 */

interface StoredOAuth {
  accessToken: string
  refreshToken?: string
  /** Epoch ms; refresh a minute early. */
  expiresAt?: number
  tokenEndpoint: string
  clientId: string
  clientSecret?: string
}

const OAUTH_TIMEOUT_MS = 5 * 60_000

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const res = await net.fetch(url, init)
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** RFC 9728 protected-resource discovery, with an RFC 8414 fallback on the MCP
 *  server's own origin for servers that skip the resource-metadata step. */
async function discoverAuthServer(mcpUrl: string): Promise<Record<string, unknown>> {
  const origin = new URL(mcpUrl).origin
  const prm = await fetchJson(`${origin}/.well-known/oauth-protected-resource`)
  const authServers = (prm?.['authorization_servers'] as string[] | undefined) ?? []
  const candidates = [...authServers, origin]
  for (const base of candidates) {
    const meta =
      (await fetchJson(`${new URL(base).origin}/.well-known/oauth-authorization-server`)) ??
      (await fetchJson(`${new URL(base).origin}/.well-known/openid-configuration`))
    if (meta?.['authorization_endpoint'] && meta['token_endpoint']) return meta
  }
  throw new Error('No OAuth authorization server metadata found for this MCP server.')
}

/** RFC 7591 dynamic registration; servers without it need a pre-issued client id. */
async function registerClient(
  meta: Record<string, unknown>,
  redirectUri: string
): Promise<{ clientId: string; clientSecret?: string }> {
  const endpoint = meta['registration_endpoint'] as string | undefined
  if (!endpoint) {
    throw new Error('Server does not support dynamic client registration — a pre-registered client id is required.')
  }
  const res = await net.fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Lyme Hype',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    })
  })
  if (!res.ok) throw new Error(`Client registration failed: HTTP ${res.status}`)
  const reg = (await res.json()) as Record<string, unknown>
  const clientId = reg['client_id'] as string | undefined
  if (!clientId) throw new Error('Registration returned no client_id')
  return { clientId, clientSecret: reg['client_secret'] as string | undefined }
}

/** One-shot loopback listener for the authorization redirect. */
function waitForCode(server: Server, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error(`Authorization timed out after ${OAUTH_TIMEOUT_MS / 60_000} minutes.`))
    }, OAUTH_TIMEOUT_MS)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const state = url.searchParams.get('state')
      const code = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        '<html><body style="font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh"><div><h2>Lyme Hype</h2><p>' +
          (code && state === expectedState ? 'Account connected — you can close this tab.' : 'Authorization failed — you can close this tab.') +
          '</p></div></body></html>'
      )
      clearTimeout(timeout)
      server.close()
      if (err) reject(new Error(`Authorization denied: ${err}`))
      else if (state !== expectedState) reject(new Error('State mismatch in OAuth redirect.'))
      else if (!code) reject(new Error('No authorization code in redirect.'))
      else resolve(code)
    })
  })
}

async function exchangeToken(
  tokenEndpoint: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await net.fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !json?.['access_token']) {
    const desc = (json?.['error_description'] ?? json?.['error'] ?? `HTTP ${res.status}`) as string
    throw new Error(`Token request failed: ${desc}`)
  }
  return json
}

function persist(connectorId: string, tok: StoredOAuth): void {
  // The vault report (length/last4 of the JSON blob) is meaningless here but harmless.
  storeSecret(connectorId, 'OAuth tokens', JSON.stringify(tok))
}

function readStored(connectorId: string): StoredOAuth | null {
  const raw = readSecretValue(connectorId)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredOAuth
    return parsed.accessToken ? parsed : null
  } catch {
    return null
  }
}

/** Full connect flow. Opens the system browser; resolves when tokens are stored. */
export async function startOAuthConnect(connectorId: string, mcpUrl: string): Promise<void> {
  const meta = await discoverAuthServer(mcpUrl)

  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Failed to open loopback listener.')
  }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`

  try {
    const { clientId, clientSecret } = await registerClient(meta, redirectUri)
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(16))

    const authUrl = new URL(meta['authorization_endpoint'] as string)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('resource', mcpUrl)
    const scopes = meta['scopes_supported'] as string[] | undefined
    if (scopes?.length) authUrl.searchParams.set('scope', scopes.join(' '))

    const codePromise = waitForCode(server, state)
    void shell.openExternal(authUrl.toString())
    const code = await codePromise

    const tokenEndpoint = meta['token_endpoint'] as string
    const tok = await exchangeToken(tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      code_verifier: verifier,
      resource: mcpUrl
    })

    persist(connectorId, {
      accessToken: tok['access_token'] as string,
      refreshToken: tok['refresh_token'] as string | undefined,
      expiresAt:
        typeof tok['expires_in'] === 'number' ? Date.now() + (tok['expires_in'] as number) * 1000 : undefined,
      tokenEndpoint,
      clientId,
      clientSecret
    })
  } finally {
    if (server.listening) server.close()
  }
}

/** Returns a live access token, refreshing (and re-persisting) when expired.
 *  Null = not connected (or refresh failed → tokens cleared, reconnect needed). */
export async function getOAuthAccessToken(connectorId: string): Promise<string | null> {
  const stored = readStored(connectorId)
  if (!stored) return null
  const fresh = stored.expiresAt === undefined || stored.expiresAt - 60_000 > Date.now()
  if (fresh) return stored.accessToken
  if (!stored.refreshToken) return stored.accessToken // no refresh path — let the server 401 if truly dead
  try {
    const tok = await exchangeToken(stored.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: stored.clientId,
      ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {})
    })
    const next: StoredOAuth = {
      ...stored,
      accessToken: tok['access_token'] as string,
      refreshToken: (tok['refresh_token'] as string | undefined) ?? stored.refreshToken,
      expiresAt:
        typeof tok['expires_in'] === 'number' ? Date.now() + (tok['expires_in'] as number) * 1000 : undefined
    }
    persist(connectorId, next)
    return next.accessToken
  } catch {
    deleteSecret(connectorId)
    return null
  }
}

export function hasOAuthTokens(connectorId: string): boolean {
  return readStored(connectorId) !== null
}
