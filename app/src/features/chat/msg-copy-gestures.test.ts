import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { contextMenuAction, createLongPress, type LongPressMachine } from './long-press'
import {
  backdropPointerAction,
  closeMsgMenu,
  copyFromMsgMenu,
  isOpeningClick,
  msgMenu,
  openMsgMenu,
} from './msg-menu-store'
import { t } from '../../i18n'
import { toast } from '../../ui/toast-store'

/**
 * User-level gesture tests for the Telegram-style copy menu, driving the REAL
 * production modules (long-press machine, msg-menu store, CopyMenu's decision
 * helpers) with PointerEvent-shaped streams copied from real iOS Safari /
 * Chrome Android sequences.
 *
 * jsdom is not a dependency of this repo (and none may be added), so these run
 * in the node environment against the framework-free gesture logic — which is
 * exactly where the browser rules live. The React hooks/components are thin
 * wiring over these modules (checked by tsc + build).
 *
 * The bubble harness mirrors what useLongPressCopy does on machine.onOpen:
 * same openMsgMenu payload, same pointerId.
 */

type Ptr = { pointerId?: number; pointerType?: string; isPrimary?: boolean; clientX?: number; clientY?: number }

function touch(init: Ptr = {}) {
  return {
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? 'touch',
    isPrimary: init.isPrimary ?? true,
    clientX: init.clientX ?? 100,
    clientY: init.clientY ?? 200,
  }
}

const RECT = { top: 100, left: 12, width: 220, bottom: 150 }

function makeBubble(id: string, text: string) {
  const pressed: boolean[] = []
  const openedPointerIds: number[] = []
  const machine: LongPressMachine = createLongPress({
    onOpen: pointerId => {
      openedPointerIds.push(pointerId)
      openMsgMenu({ id, text, rect: { ...RECT }, cursor: null, pointerId })
    },
    onPressedChange: p => pressed.push(p),
  })
  return { id, machine, pressed, openedPointerIds }
}

/** Press and hold: pointerdown + `ms` of holding, finger still down. */
function hold(b: { machine: LongPressMachine }, ms = 500, init: Ptr = {}) {
  const r = b.machine.down(touch(init))
  vi.advanceTimersByTime(ms)
  return r
}

/** What CopyMenu's backdrop onPointerDown does (production code path). */
function backdropTap(pointerId: number) {
  if (backdropPointerAction(msgMenu.get(), pointerId) === 'close') closeMsgMenu()
}

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

beforeEach(() => {
  vi.useFakeTimers()
  msgMenu.set(null)
})

afterEach(() => {
  vi.useRealTimers()
  msgMenu.set(null)
})

describe('BUG 1 — the menu opens while the finger is still down', () => {
  it('(a) press 500ms → menu is open BEFORE the release', () => {
    const a = makeBubble('m1', 'hola mundo')
    expect(a.machine.down(touch())).toBe('pressing')
    expect(a.pressed).toEqual([true])
    expect(msgMenu.get()).toBeNull() // nothing before the delay
    vi.advanceTimersByTime(500)
    const menu = msgMenu.get()
    expect(menu).not.toBeNull() // ← opened by the timer, no pointerup yet
    expect(menu).toMatchObject({ id: 'm1', text: 'hola mundo', pointerId: 1, cursor: null })
    expect(a.openedPointerIds).toEqual([1])
    expect(a.machine.state).toBe('open') // finger still down, gesture alive
  })

  it('(b) release → menu STAYS open; no reopen, no close; holding long is inert', () => {
    const a = makeBubble('m1', 'hola')
    hold(a)
    const menu = msgMenu.get()
    expect(menu).not.toBeNull()
    const openedAt = menu!.openedAt

    a.machine.up() // the opening gesture's release
    expect(msgMenu.get()).not.toBeNull()
    expect(msgMenu.get()!.openedAt).toBe(openedAt) // not reopened
    expect(a.openedPointerIds).toEqual([1]) // not opened twice
    expect(a.pressed).toEqual([true, false]) // pressed visual off, menu still selected

    // "hold as long as you want, nothing weird happens" (natural cap < 4s)
    vi.advanceTimersByTime(4000)
    expect(msgMenu.get()!.openedAt).toBe(openedAt)
    expect(a.openedPointerIds).toEqual([1])

    // drift AFTER the open must not kill the menu either
    a.machine.move(touch({ clientX: 100 + 80, clientY: 200 + 40 }))
    expect(msgMenu.get()).not.toBeNull()
  })

  it('release landing on the backdrop (Android, no implicit capture) is swallowed', () => {
    const a = makeBubble('m1', 'hola')
    hold(a)
    // Chrome-style: pointerup/pointerdown of the opening pointer hit the
    // freshly-mounted backdrop — CopyMenu asks backdropPointerAction.
    expect(backdropPointerAction(msgMenu.get(), 1)).toBe('swallow')
    backdropTap(1) // must be a no-op for the opening pointer
    expect(msgMenu.get()).not.toBeNull()
  })

  it('pointercancel after the open keeps the menu (real scroll closes it in CopyMenu)', () => {
    const a = makeBubble('m1', 'hola')
    hold(a)
    a.machine.cancel()
    expect(msgMenu.get()?.id).toBe('m1')
  })
})

describe('BUG 2 — open/close, then long-press ANOTHER message still works', () => {
  it('(d) open A → tap backdrop → long-press B → menu opens for B', () => {
    const a = makeBubble('m1', 'mensaje A')
    const b = makeBubble('m2', 'mensaje B')

    expect(hold(a)).toBe('pressing')
    expect(msgMenu.get()?.id).toBe('m1')
    a.machine.up()
    expect(msgMenu.get()?.id).toBe('m1')

    // close by tapping the backdrop with a NEW pointer (finger #2)
    backdropTap(7)
    expect(msgMenu.get()).toBeNull()

    // the closed backdrop is inert: it cannot eat the next press
    expect(backdropPointerAction(msgMenu.get(), 9)).toBe('none')

    // the second long-press on a different message — this used to die
    expect(b.machine.down(touch())).toBe('pressing')
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()).toMatchObject({ id: 'm2', text: 'mensaje B', pointerId: 1 })
    b.machine.up()
    expect(msgMenu.get()?.id).toBe('m2') // release keeps it open
  })

  it('(d-iOS) trailing momentum scroll after the press does not kill the hold', () => {
    const b = makeBubble('m2', 'mensaje B')
    // iOS: user closed the previous menu scrolling; the list is still gliding
    b.machine.down(touch())
    vi.advanceTimersByTime(60)
    b.machine.scroll() // trailing scroll event, inside the grace window
    expect(b.machine.state).toBe('pressing')
    vi.advanceTimersByTime(440)
    expect(msgMenu.get()?.id).toBe('m2')
  })

  it('(e) three full cycles, alternating messages', () => {
    const bubbles = [makeBubble('m1', 'uno'), makeBubble('m2', 'dos'), makeBubble('m3', 'tres')]
    for (const b of bubbles) {
      expect(hold(b)).toBe('pressing')
      expect(msgMenu.get()?.id).toBe(b.id)
      b.machine.up()
      expect(msgMenu.get()?.id).toBe(b.id)
      backdropTap(99)
      expect(msgMenu.get()).toBeNull()
    }
    // …and a 4th on the first message again, because it must work N times
    expect(hold(bubbles[0])).toBe('pressing')
    expect(msgMenu.get()?.id).toBe('m1')
    bubbles[0].machine.up()
  })

  it('a second finger spoils only a pending hold, never an open menu', () => {
    const a = makeBubble('m1', 'hola')
    a.machine.down(touch())
    a.machine.down(touch({ pointerId: 2, isPrimary: false, clientX: 40, clientY: 60 }))
    expect(a.machine.state).toBe('idle')
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()).toBeNull()

    hold(a)
    expect(a.machine.down(touch({ pointerId: 2, isPrimary: false, clientX: 40, clientY: 60 }))).toBe('held-open')
    expect(msgMenu.get()?.id).toBe('m1')
  })

  it('a row unmounted mid-press never fires (destroy)', () => {
    const a = makeBubble('m1', 'hola')
    a.machine.down(touch())
    a.machine.destroy()
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()).toBeNull()
    expect(a.pressed[a.pressed.length - 1]).toBe(false)
  })
})

describe('short taps and cancellation', () => {
  it('(f) a short tap never opens the menu', () => {
    const a = makeBubble('m1', 'hola')
    a.machine.down(touch())
    vi.advanceTimersByTime(120)
    a.machine.up()
    expect(msgMenu.get()).toBeNull()
    vi.advanceTimersByTime(1000) // nothing fires later either
    expect(msgMenu.get()).toBeNull()
  })

  it('(g) a real scroll after the grace window cancels the hold', () => {
    const a = makeBubble('m1', 'hola')
    a.machine.down(touch())
    vi.advanceTimersByTime(200)
    a.machine.scroll()
    expect(a.machine.state).toBe('idle')
    vi.advanceTimersByTime(400)
    expect(msgMenu.get()).toBeNull()
  })

  it('(g) dragging beyond the slop cancels the hold', () => {
    const a = makeBubble('m1', 'hola')
    a.machine.down(touch())
    a.machine.move(touch({ clientX: 130, clientY: 200 }))
    expect(a.machine.state).toBe('idle')
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()).toBeNull()
  })

  it('a small tremor (< slop) does not cancel', () => {
    const a = makeBubble('m1', 'hola')
    a.machine.down(touch())
    a.machine.move(touch({ clientX: 105, clientY: 204 }))
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()?.id).toBe('m1')
  })
})

describe('(c) the Copy item — clipboard + toast', () => {
  it('a real tap copies, toasts and closes (production path copyFromMsgMenu)', async () => {
    const a = makeBubble('m1', 'texto para copiar')
    hold(a)
    a.machine.up()
    const menu = msgMenu.get()!
    const writeText = stubClipboard()

    await copyFromMsgMenu(menu)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('texto para copiar')
    expect(msgMenu.get()).toBeNull()
    expect(toast.get()?.text).toBe(t('chat.copied'))
  })

  it('swallows the opening gesture\'s trailing click and the iOS ghost tap', () => {
    const a = makeBubble('m1', 'hola')
    hold(a)
    const menu = msgMenu.get()!

    // same pointer as the opening gesture: never a Copy tap, however late
    expect(isOpeningClick(menu, 1, menu.openedAt + 60_000)).toBe(true)
    // a click inside the grace window right after open: ignored
    expect(isOpeningClick(menu, undefined, menu.openedAt + 200)).toBe(true)
    // a later tap with another pointer: allowed
    expect(isOpeningClick(menu, 4, menu.openedAt + 301)).toBe(false)
    expect(isOpeningClick(menu, undefined, menu.openedAt + 10_000)).toBe(false)
  })
})

describe('(h) desktop right-click', () => {
  it('mouse pointers never arm the long-press; contextmenu opens at the cursor', () => {
    const a = makeBubble('m1', 'hola')
    expect(a.machine.down(touch({ pointerId: 5, pointerType: 'mouse', clientX: 10, clientY: 10 }))).toBe('ignored')
    vi.advanceTimersByTime(1000)
    expect(msgMenu.get()).toBeNull()

    expect(contextMenuAction('mouse')).toBe('open-menu')
    openMsgMenu({ id: 'm1', text: 'hola', rect: { ...RECT }, cursor: { x: 33, y: 44 }, pointerId: null })
    expect(msgMenu.get()).toMatchObject({ cursor: { x: 33, y: 44 }, pointerId: null })

    // a mouse press outside is not the opening pointer → backdrop closes
    expect(backdropPointerAction(msgMenu.get(), 5)).toBe('close')
    backdropTap(5)
    expect(msgMenu.get()).toBeNull()
  })

  it('touch contextmenu only suppresses the native callout (the timer owns the menu)', () => {
    expect(contextMenuAction('touch')).toBe('suppress-native')
    expect(contextMenuAction('pen')).toBe('suppress-native')
  })
})
