import { atom } from 'nanostores'

/**
 * Secure credential prompts (`sudo`, `secret`, `vault.*`). The backend blocks the
 * agent thread on these server→client requests; the answer is a single JSON string
 * and the model never sees the value. This store holds only the request metadata
 * and the `respond` handle — the typed values live in the sheet's component state
 * and are cleared after answering (never logged, stored, or placed on the URL).
 */

export type SecurePromptKind =
  | 'sudo'
  | 'secret'
  | 'vault.unlock_prompt'
  | 'vault.save_login'
  | 'vault.code'

/**
 * Backend deadlines (pinned bf0203a): sudo 120 s, unlock 120 s, save_login 180 s,
 * code 180 s (`tui_gateway/agent_callbacks.py`); secret 120 s — a bot turn runs on
 * the gateway, whose `SECRET_TIMEOUT_S = 120` (`gateway/session_secret_prompt.py`)
 * applies, per field. The sheet shows a countdown and answers "" on expiry; the
 * backend also withdraws the request itself after the deadline.
 */
export const SECURE_TIMEOUT_MS: Record<SecurePromptKind, number> = {
  sudo: 120_000,
  secret: 120_000,
  'vault.unlock_prompt': 120_000,
  'vault.save_login': 180_000,
  'vault.code': 180_000,
}

export interface SecurePrompt {
  kind: SecurePromptKind
  id: string
  sessionId: string
  /** sudo: the (redacted) command the terminal wants to run. */
  command?: string
  /** secret: the env var name being captured. */
  envVar?: string
  /** secret: the server's prompt text. */
  prompt?: string
  /** unlock_prompt: the vault backend id (1password / bitwarden / …). */
  backend?: string
  /** unlock_prompt: the manager's display name. */
  displayName?: string
  /** save_login: the full sign-in page URL. */
  origin?: string
  /** save_login / code: the site label. */
  site?: string
  /** code: the server's hint. */
  hint?: string
  respond: (result: Record<string, unknown>) => void
  receivedAt: number
  timeoutMs: number
  replayed: boolean
}

export const securePrompts = atom<SecurePrompt[]>([])

/** `vault.save_login` answer: JSON `{identifier, password}` (`agent_callbacks.py` `json.loads` it). */
export function buildSaveLoginValue(identifier: string, password: string): string {
  return JSON.stringify({ identifier: identifier.trim(), password })
}

/** `vault.code` answer: strip spaces/dashes so "123 456" reads "123456". */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

export interface IncomingSecureRequest {
  id: string
  method: string
  params: Record<string, unknown>
  respond: (result: Record<string, unknown>) => void
  replayed?: boolean
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** Normalize one inbound request into a `SecurePrompt`, or `null` for methods this store does not handle. */
export function parseSecureRequest(req: IncomingSecureRequest, now = Date.now()): SecurePrompt | null {
  const p = req.params
  const sessionId = typeof p.session_id === 'string' ? p.session_id : ''
  const base = {
    id: req.id,
    sessionId,
    respond: req.respond,
    receivedAt: now,
    replayed: req.replayed === true,
  }

  switch (req.method) {
    case 'sudo':
      return {
        ...base,
        kind: 'sudo',
        command: typeof p.command === 'string' ? p.command : '',
        timeoutMs: SECURE_TIMEOUT_MS.sudo,
      }
    case 'secret':
      return {
        ...base,
        kind: 'secret',
        envVar: typeof p.env_var === 'string' ? p.env_var : '',
        prompt: typeof p.prompt === 'string' ? p.prompt : '',
        timeoutMs: SECURE_TIMEOUT_MS.secret,
      }
    case 'vault.unlock_prompt': {
      const backend = typeof p.backend === 'string' ? p.backend : ''
      return {
        ...base,
        kind: 'vault.unlock_prompt',
        backend,
        displayName: typeof p.display_name === 'string' && p.display_name ? p.display_name : backend,
        timeoutMs: SECURE_TIMEOUT_MS['vault.unlock_prompt'],
      }
    }
    case 'vault.save_login': {
      const origin = typeof p.origin === 'string' ? p.origin : ''
      return {
        ...base,
        kind: 'vault.save_login',
        origin,
        site: typeof p.site === 'string' && p.site ? p.site : origin,
        timeoutMs: SECURE_TIMEOUT_MS['vault.save_login'],
      }
    }
    case 'vault.code':
      return {
        ...base,
        kind: 'vault.code',
        site: str(p.site),
        hint: str(p.hint),
        timeoutMs: SECURE_TIMEOUT_MS['vault.code'],
      }
    default:
      return null
  }
}

// Ids already answered here. A reconnect replay (`open_requests`) can still hand
// one back while the answer is in flight; showing it again would take a second
// answer the server ignores.
const answeredIds = new Set<string>()

/** Add (or replace, by id) a secure prompt. Returns `false` for methods this store does not handle. */
export function receiveSecureRequest(req: IncomingSecureRequest): boolean {
  const prompt = parseSecureRequest(req)
  if (!prompt) return false
  if (answeredIds.has(prompt.id)) return true
  securePrompts.set([...securePrompts.get().filter(x => x.id !== prompt.id), prompt])
  return true
}

export function removeSecurePrompt(id: string): void {
  securePrompts.set(securePrompts.get().filter(x => x.id !== id))
}

/** Answer the backend and drop the card. `value === ''` = skipped / cancelled. */
export function answerSecurePrompt(prompt: SecurePrompt, value: string): void {
  answeredIds.add(prompt.id)
  prompt.respond({ value })
  removeSecurePrompt(prompt.id)
}
