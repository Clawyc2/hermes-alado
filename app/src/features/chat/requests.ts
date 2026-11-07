import { atom } from 'nanostores'
import { connectionState, on, onRequest, request } from '../../lib/hermes/connection'
import { t } from '../../i18n'
import { showToast } from '../../ui/toast-store'
import { homeBots, homeProfiles } from '../home/store'
import { receiveSecureRequest, removeSecurePrompt, securePrompts } from './secure-prompts'

/**
 * Server→client requests (approval / clarify / sudo / secret / vault.*) — shared
 * by the chat view (cards), Home (banner for other-session requests), and the
 * secure-prompt sheet. Lives in its own module so the `onRequest` handler
 * registers on first import, independent of whether a chat is open, and so
 * `home` and `chat` can both read it without a cycle. Secure prompts are
 * delegated to `secure-prompts.ts` (single `{ value }` answer, model never sees it).
 */

export interface ClarifyQ {
  qid: string
  question: string
  choices: string[]
}

export type ServerRequestCard =
  | {
      kind: 'approval'
      id: string
      sessionId: string
      command: string
      description: string
      choices: string[]
      respond: (r: Record<string, unknown>) => void
    }
  | {
      kind: 'clarify'
      id: string
      sessionId: string
      questions: ClarifyQ[]
      respond: (r: Record<string, unknown>) => void
    }

export const requests = atom<ServerRequestCard[]>([])

// session id → profile name, so a request from a session we opened can resolve
// which bot asked. Populated by the chat store on every open/resume.
const sessionToProfile = new Map<string, string>()

export function registerSessionProfile(sid: string, profile: string): void {
  sessionToProfile.set(sid, profile)
}

export function profileForSession(sid: string): string | null {
  return sessionToProfile.get(sid) ?? null
}

/** The bot's visible name for a session ("Pancho"), for sheets and notices. */
export function askerForSession(sid: string): string {
  const profile = profileForSession(sid)
  const bot = profile ? homeBots.get().find(b => b.name === profile) : undefined
  return bot?.displayName ?? profile ?? t('bots.fallback')
}

// Answered card ids: a reconnect replay can hand one back while the answer is in flight.
const answeredCards = new Set<string>()

export function resolveRequest(card: ServerRequestCard, result: Record<string, unknown>): void {
  answeredCards.add(card.id)
  card.respond(result)
  requests.set(requests.get().filter(r => r.id !== card.id))
}

function addRequest(card: ServerRequestCard): void {
  if (answeredCards.has(card.id)) return
  requests.set([...requests.get().filter(r => r.id !== card.id), card])
}

onRequest(req => {
  const params = req.params as Record<string, unknown>
  const sessionId = typeof params.session_id === 'string' ? params.session_id : ''

  if (req.method === 'approval') {
    addRequest({
      kind: 'approval',
      id: req.id,
      sessionId,
      command: typeof params.command === 'string' ? params.command : '',
      description: typeof params.description === 'string' ? params.description : '',
      choices: Array.isArray(params.choices) ? (params.choices as string[]) : [],
      respond: req.respond,
    })
    return true
  }

  if (req.method === 'clarify') {
    const questions = Array.isArray(params.questions)
      ? (params.questions as { qid: string; question: string; choices?: string[] }[]).map(q => ({
          qid: q.qid,
          question: q.question,
          choices: Array.isArray(q.choices) ? q.choices : [],
        }))
      : []
    addRequest({ kind: 'clarify', id: req.id, sessionId, questions, respond: req.respond })
    return true
  }

  if (
    req.method === 'sudo' ||
    req.method === 'secret' ||
    req.method === 'vault.save_login' ||
    req.method === 'vault.code' ||
    req.method === 'vault.unlock_prompt'
  ) {
    return receiveSecureRequest(req)
  }

  // Anything else: decline so the vendored default answers -32601.
  return false
})

// ── Recovery after a dropped socket ──────────────────────────────────────────
// A request frame sent to a socket that died (the user left the app to copy a
// key, Android froze it) is lost, and the bot stays blocked on it. Hermes hands
// unanswered requests back as `open_requests` on `session.resume` — but the app
// only resumed the chat that was open. So on every (re)connect, resume every
// session the server reports as `waiting` (blocked on a request), whatever
// screen is showing: the sheet / card comes back on its own.

interface ActiveRow {
  id?: string
  session_key?: string
  status?: string
}

interface RosterRow {
  name: string
  canonical_session?: { id?: string; resolved_id?: string } | null
  worker_session?: { id?: string } | null
  last_session?: { id?: string } | null
}

/** Stored-session id → profile, from the roster rows (same ids Home attributes busy state with). */
export function profileByStoredId(rows: readonly RosterRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    for (const id of [
      row.canonical_session?.id,
      row.canonical_session?.resolved_id,
      row.worker_session?.id,
      row.last_session?.id,
    ]) {
      if (id) map.set(id, row.name)
    }
  }
  return map
}

/**
 * The `waiting` sessions to resume (with the bot they belong to, when the
 * roster knows it), the ones it does not know, and the live ids that may still
 * hold an open request.
 */
export function planRecovery(
  active: readonly ActiveRow[],
  byStoredId: ReadonlyMap<string, string>,
): { resume: { sessionId: string; profile: string }[]; unknown: string[]; waitingLive: Set<string> } {
  const resume: { sessionId: string; profile: string }[] = []
  const unknown: string[] = []
  const waitingLive = new Set<string>()
  for (const row of active) {
    if (row.status !== 'waiting') continue
    if (row.id) waitingLive.add(row.id)
    if (!row.session_key) continue
    const profile = byStoredId.get(row.session_key)
    if (profile) resume.push({ sessionId: row.session_key, profile })
    else unknown.push(row.session_key)
  }
  return { resume, unknown, waitingLive }
}

// `session.resume` needs the bot, and `session.active_list` does not say it. A
// session outside the roster's ids (a side chat, a group turn) is tried against
// each bot; the winner is remembered.
const learnedProfile = new Map<string, string>()

async function resumeTrying(sessionId: string, profiles: readonly string[]): Promise<void> {
  for (const profile of profiles) {
    try {
      await resumeFor(sessionId, profile)
      learnedProfile.set(sessionId, profile)
      return
    } catch {
      // not this bot's session: try the next
    }
  }
}

/** Resume, and teach the request cards which bot asks (name + avatar on the sheet). */
async function resumeFor(sessionId: string, profile: string): Promise<void> {
  const res = await request('session.resume', { session_id: sessionId, profile })
  if (res?.session_id) registerSessionProfile(String(res.session_id), profile)
  registerSessionProfile(sessionId, profile)
}

let recovering = false
// Waiting sessions seen before the roster loaded (first connect): retry once it arrives.
let awaitingRoster = false

export async function recoverWaitingRequests(): Promise<void> {
  if (recovering) return
  recovering = true
  try {
    const res = await request('session.active_list', {})
    const rows: ActiveRow[] = res?.sessions ?? []
    const roster = homeProfiles.get()
    const byStoredId = profileByStoredId(roster)
    for (const [id, profile] of learnedProfile) if (!byStoredId.has(id)) byStoredId.set(id, profile)
    const { resume, unknown, waitingLive } = planRecovery(rows, byStoredId)
    awaitingRoster = unknown.length > 0 && roster.length === 0
    const names = roster.map(r => r.name)
    await Promise.all([
      ...resume.map(t => resumeFor(t.sessionId, t.profile).catch(() => undefined)),
      ...unknown.map(id => resumeTrying(id, names)),
    ])
    // A card whose session is no longer waiting was answered elsewhere or timed
    // out while we were away: drop it, or the user would answer into the void.
    requests.set(requests.get().filter(r => waitingLive.has(r.sessionId)))
    for (const p of securePrompts.get()) if (!waitingLive.has(p.sessionId)) removeSecurePrompt(p.id)
  } catch {
    // older gateway / socket down again: the next reconnect retries
  } finally {
    recovering = false
  }
}

connectionState.listen(state => {
  if (state === 'open') void recoverWaitingRequests()
})

homeProfiles.listen(() => {
  if (awaitingRoster && connectionState.get() === 'open') {
    awaitingRoster = false
    void recoverWaitingRequests()
  }
})

on('request.cancel', e => {
  const id = e.payload?.id
  if (typeof id === 'string') {
    // The server gave up on a form the user still had open: say so, instead of
    // the sheet just vanishing.
    const open = securePrompts.get().find(p => p.id === id)
    if (open && e.payload?.reason === 'timeout') showToast(t('chat.secure.expired', { asker: askerForSession(open.sessionId) }), 6000)
    requests.set(requests.get().filter(r => r.id !== id))
    removeSecurePrompt(id)
  }
})
