import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  answerSecurePrompt,
  buildSaveLoginValue,
  normalizeCode,
  parseSecureRequest,
  receiveSecureRequest,
  securePrompts,
  type IncomingSecureRequest,
} from './secure-prompts'

// One request id per test (answered ids are remembered module-wide); calls
// within a test share it, like a replay of the same request.
let seq = 0
let currentId = 'req-1'
function req(method: string, params: Record<string, unknown>, respond: (r: Record<string, unknown>) => void = () => {}): IncomingSecureRequest {
  return { id: currentId, method, params, respond }
}

beforeEach(() => {
  securePrompts.set([])
  currentId = `req-${++seq}`
})

describe('parseSecureRequest', () => {
  it('maps vault.save_login params (origin + site) with the 180s deadline', () => {
    const p = parseSecureRequest(
      req('vault.save_login', { session_id: 's1', origin: 'https://github.com', site: 'github.com' }),
      1000,
    )
    expect(p).toMatchObject({
      kind: 'vault.save_login',
      id: currentId,
      sessionId: 's1',
      origin: 'https://github.com',
      site: 'github.com',
      receivedAt: 1000,
      timeoutMs: 180_000,
      replayed: false,
    })
  })

  it('falls back save_login site to origin', () => {
    const p = parseSecureRequest(req('vault.save_login', { origin: 'https://x.com' }), 0)
    expect(p?.site).toBe('https://x.com')
  })

  it('maps vault.code with the 180s deadline and keeps hint/site optional', () => {
    const p = parseSecureRequest(req('vault.code', { session_id: 's', site: 'gh', hint: 'app' }), 0)
    expect(p).toMatchObject({ kind: 'vault.code', site: 'gh', hint: 'app', timeoutMs: 180_000 })
    expect(parseSecureRequest(req('vault.code', { session_id: 's' }), 0)).toMatchObject({ site: undefined, hint: undefined })
  })

  it('maps vault.unlock_prompt and defaults displayName to backend', () => {
    const p = parseSecureRequest(req('vault.unlock_prompt', { backend: '1password', display_name: '1Password' }), 0)
    expect(p).toMatchObject({ kind: 'vault.unlock_prompt', backend: '1password', displayName: '1Password', timeoutMs: 120_000 })
    expect(parseSecureRequest(req('vault.unlock_prompt', { backend: 'bitwarden' }), 0)?.displayName).toBe('bitwarden')
  })

  it('maps secret (env_var + prompt) with the 300s deadline', () => {
    const p = parseSecureRequest(req('secret', { env_var: 'X_KEY', prompt: 'dame la key' }), 0)
    expect(p).toMatchObject({ kind: 'secret', envVar: 'X_KEY', prompt: 'dame la key', timeoutMs: 120_000 })
  })

  it('maps sudo with the 120s deadline', () => {
    const p = parseSecureRequest(req('sudo', { command: 'rm -rf /' }), 0)
    expect(p).toMatchObject({ kind: 'sudo', command: 'rm -rf /', timeoutMs: 120_000 })
  })

  it('returns null for methods this store does not handle', () => {
    expect(parseSecureRequest(req('clarify', {}), 0)).toBeNull()
    expect(parseSecureRequest(req('approval', {}), 0)).toBeNull()
  })
})

describe('answer shapes', () => {
  it('builds the save_login JSON value with trimmed identifier', () => {
    expect(JSON.parse(buildSaveLoginValue(' tek@acme.test ', 'pw'))).toEqual({ identifier: 'tek@acme.test', password: 'pw' })
  })

  it('normalizes the one-time code by stripping spaces and dashes', () => {
    expect(normalizeCode('123 456-789')).toBe('123456789')
  })
})

describe('store', () => {
  it('receive → answer responds {value} and clears the prompt', () => {
    const respond = vi.fn()
    receiveSecureRequest(req('sudo', { session_id: 's', command: 'ls' }, respond))
    expect(securePrompts.get()).toHaveLength(1)
    answerSecurePrompt(securePrompts.get()[0], 'hunter2')
    expect(respond).toHaveBeenCalledWith({ value: 'hunter2' })
    expect(securePrompts.get()).toHaveLength(0)
  })

  it('cancel answers ""', () => {
    const respond = vi.fn()
    receiveSecureRequest(req('secret', { env_var: 'X', prompt: 'dame la key' }, respond))
    answerSecurePrompt(securePrompts.get()[0], '')
    expect(respond).toHaveBeenCalledWith({ value: '' })
  })

  it('never retains the typed value in the store', () => {
    receiveSecureRequest(req('vault.save_login', { origin: 'x', site: 'x' }, () => {}))
    const p = securePrompts.get()[0]
    expect(p).not.toHaveProperty('value')
    expect(p).not.toHaveProperty('password')
    expect(p).not.toHaveProperty('identifier')
  })

  it('dedupes by request id so a replay does not stack a second card', () => {
    const respond = vi.fn()
    receiveSecureRequest(req('sudo', { command: 'x' }, respond))
    receiveSecureRequest({ ...req('sudo', { command: 'x' }, respond), replayed: true })
    expect(securePrompts.get()).toHaveLength(1)
    expect(securePrompts.get()[0].replayed).toBe(true)
  })

  it('returns false for unhandled methods', () => {
    expect(receiveSecureRequest(req('clarify', {}))).toBe(false)
    expect(securePrompts.get()).toHaveLength(0)
  })
})

describe('replay after answering', () => {
  it('ignores a replay of a request already answered here', () => {
    receiveSecureRequest(req('secret', { session_id: 's1', env_var: 'X' }))
    answerSecurePrompt(securePrompts.get()[0], 'v')
    receiveSecureRequest(req('secret', { session_id: 's1', env_var: 'X' }))
    expect(securePrompts.get()).toHaveLength(0)
  })
})
