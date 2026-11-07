import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/hermes/connection', async () => {
  const { atom } = await import('nanostores')
  return { connectionState: atom('idle'), on: vi.fn(), onRequest: vi.fn(), request: vi.fn() }
})
vi.mock('../home/store', async () => {
  const { atom } = await import('nanostores')
  return { homeProfiles: atom([]) }
})

const { planRecovery, profileByStoredId } = await import('./requests')

describe('request recovery after a dropped socket', () => {
  const roster = profileByStoredId([
    { name: 'default', canonical_session: { id: 'S-pancho', resolved_id: 'S-pancho-tip' } },
    { name: 'lola', canonical_session: { id: 'S-lola' }, worker_session: { id: 'W-lola' } },
  ])

  it('maps every stored id of a bot to its profile', () => {
    expect(roster.get('S-pancho-tip')).toBe('default')
    expect(roster.get('W-lola')).toBe('lola')
  })

  it('splits waiting sessions into known and unknown bots, and reports every waiting live id', () => {
    const plan = planRecovery(
      [
        { id: 'live1', session_key: 'S-pancho', status: 'waiting' },
        { id: 'live2', session_key: 'S-lola', status: 'working' },
        { id: 'live3', session_key: 'S-unknown', status: 'waiting' },
      ],
      roster,
    )
    expect(plan.resume).toEqual([{ sessionId: 'S-pancho', profile: 'default' }])
    expect(plan.unknown).toEqual(['S-unknown'])
    expect([...plan.waitingLive].sort()).toEqual(['live1', 'live3'])
  })
})
