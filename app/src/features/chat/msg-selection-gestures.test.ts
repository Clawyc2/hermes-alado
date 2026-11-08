import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createLongPress, type LongPressMachine } from './long-press'
import { closeMsgMenu, isOpeningClick, msgMenu, openMsgMenu, type MsgMenu } from './msg-menu-store'
import {
  bubblePressAction,
  copySelection,
  enterSelection,
  exitSelection,
  isSelectable,
  isSelected,
  itemText,
  msgSelection,
  selectFromMsgMenu,
  selectedTexts,
  toggleSelection,
} from './msg-selection-store'
import type { ChatItem } from './store'
import { localeChoice, t } from '../../i18n'
import { toast } from '../../ui/toast-store'

/**
 * User-level gesture tests for multi-message selection, driving the REAL
 * production modules (long-press machine, msg-menu store, selection store)
 * with the same PointerEvent-shaped streams as msg-copy-gestures.test.ts.
 *
 * The bubble harness mirrors what useLongPressCopy + ItemRow do:
 * - machine.onOpen → openMsgMenu, gated on `enabled` exactly like the hook's
 *   openRef (ItemRow passes `copyable && !selecting`);
 * - a press on a bubble consults bubblePressAction: 'toggle' while selecting
 *   (the machine is not even attached), 'long-press' otherwise.
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

/** Mirrors useLongPressCopy(id, getText, enabled) + ItemRow's press wiring. */
function makeBubble(id: string, text: string, enabledRef: { current: boolean }) {
  const machine: LongPressMachine = createLongPress({
    onOpen: pointerId => {
      // The hook's openRef: no menu while disabled (selection mode / streaming).
      if (!enabledRef.current) return
      openMsgMenu({ id, text, rect: { ...RECT }, cursor: null, pointerId })
    },
  })
  return { id, machine, enabledRef }
}

/** ItemRow's exact behavior for a tap while selecting (production path). */
function tapBubble(b: { id: string; enabledRef: { current: boolean } }, selecting: boolean, copyable: boolean) {
  const action = bubblePressAction(selecting, copyable)
  if (action === 'toggle') toggleSelection(b.id)
  return action
}

/** CopyMenu's production onClick for an item. */
function itemClick(menu: NonNullable<MsgMenu>, pointerId: number, now: number, act: (m: NonNullable<MsgMenu>) => void) {
  if (isOpeningClick(menu, pointerId, now)) return
  act(menu)
}

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

const ITEMS: ChatItem[] = [
  { kind: 'user', id: 'u1', text: 'planea el viaje' },
  { kind: 'assistant', id: 'a1', text: 'respuesta larga', streaming: false, error: '' },
  { kind: 'agent', id: 'n1', sender: 'Pancho', body: 'nota interna' },
  { kind: 'delivery', id: 'd1', target: 'Ana', reply: 'entregado', pending: false },
  { kind: 'assistant', id: 'a2', text: 'escribiendo…', streaming: true, error: '' },
]

const byId = (id: string) => ITEMS.find(g => g.id === id)!

beforeEach(() => {
  vi.useFakeTimers()
  msgMenu.set(null)
  msgSelection.set({ active: false, ids: new Set() })
  toast.set(null)
})

afterEach(() => {
  vi.useRealTimers()
  msgMenu.set(null)
  msgSelection.set({ active: false, ids: new Set() })
  toast.set(null)
})

describe('multi-selection — the Telegram flow', () => {
  it('(2) long-press → "Seleccionar" → tap 2 more → "Copiar (3)": 3 texts, chronological, joined with \\n\\n', async () => {
    const u1 = makeBubble('u1', 'planea el viaje', { current: true })
    const a1 = makeBubble('a1', 'respuesta larga', { current: true })
    const n1 = makeBubble('n1', 'nota interna', { current: true })

    // 1. long-press the first message → menu opens mid-press → release
    u1.machine.down(touch())
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()?.id).toBe('u1')
    u1.machine.up()

    // 2. tap "Seleccionar mensajes" (fresh pointer, past the grace window)
    const menu = msgMenu.get()!
    itemClick(menu, 2, menu.openedAt + 900, selectFromMsgMenu)
    expect(msgMenu.get()).toBeNull() // entering selection closes the popup
    expect(msgSelection.get().active).toBe(true)
    expect(isSelected('u1')).toBe(true) // the long-pressed one is pre-checked
    // from now on ItemRow detaches the machine (enabled = copyable && !selecting)
    u1.enabledRef.current = false
    a1.enabledRef.current = false
    n1.enabledRef.current = false

    // 3. tap two more bubbles → toggle (never a long-press)
    for (const b of [a1, n1]) {
      const action = tapBubble(b, true, isSelectable(byId(b.id)))
      expect(action).toBe('toggle')
    }
    expect(selectedTexts(ITEMS, msgSelection.get().ids)).toEqual([
      'planea el viaje',
      'respuesta larga',
      'nota interna',
    ])

    // 4. "Copiar (3)" on the bar (a real click → one clipboard write)
    const writeText = stubClipboard()
    const toasts: string[] = []
    const unsub = toast.subscribe(v => {
      if (v) toasts.push(v.text)
    })
    await copySelection(selectedTexts(ITEMS, msgSelection.get().ids))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('planea el viaje\n\nrespuesta larga\n\nnota interna')
    expect(toasts.filter(x => x === t('chat.copied'))).toHaveLength(1) // ONE toast
    expect(msgSelection.get().active).toBe(false) // copy leaves the mode
    expect(msgMenu.get()).toBeNull()
    unsub()
  })

  it('(3) re-tap deselects; deselecting the last one exits the mode', () => {
    enterSelection('a1')
    toggleSelection('n1')
    expect(isSelected('a1') && isSelected('n1')).toBe(true)

    toggleSelection('a1') // deselect one
    expect(isSelected('a1')).toBe(false)
    expect(isSelected('n1')).toBe(true)
    expect(msgSelection.get().active).toBe(true)

    toggleSelection('n1') // the last one off → mode exits (Telegram behavior)
    expect(msgSelection.get()).toEqual({ active: false, ids: new Set() })
  })

  it('(4) exit (✕ / Esc) → normal long-press still opens the menu (regression)', () => {
    enterSelection('u1')
    exitSelection()
    expect(msgSelection.get().active).toBe(false)

    // …and after copying from selection mode too:
    enterSelection('d1')
    exitSelection()

    const a1 = makeBubble('a1', 'respuesta larga', { current: true })
    expect(a1.machine.down(touch())).toBe('pressing')
    vi.advanceTimersByTime(500)
    expect(msgMenu.get()).toMatchObject({ id: 'a1', text: 'respuesta larga', pointerId: 1 })
    a1.machine.up()
    expect(msgMenu.get()?.id).toBe('a1') // release keeps it open
    closeMsgMenu()
    expect(msgMenu.get()).toBeNull()
  })

  it('(5) a short tap in selection mode toggles — it NEVER opens the menu', () => {
    const a1 = makeBubble('a1', 'respuesta larga', { current: false }) // hook disabled while selecting
    enterSelection('u1')

    // ItemRow wiring: press action says toggle, machine not attached
    const action = tapBubble(a1, true, true)
    expect(action).toBe('toggle')
    expect(isSelected('a1')).toBe(true)

    // even the full ghost stream (down → hold → up) cannot open a menu,
    // because the hook's openRef is gated on enabled (production mirror)
    a1.machine.down(touch())
    vi.advanceTimersByTime(500)
    a1.machine.up()
    expect(msgMenu.get()).toBeNull()

    // and a NON-selectable row (streaming) is inert in selection mode
    expect(bubblePressAction(true, isSelectable(byId('a2')))).toBe('none')
    expect(bubblePressAction(true, false)).toBe('none')
  })

  it('streaming rows are never selectable; selection skips ids that turned bad', () => {
    expect(isSelectable(byId('a2'))).toBe(false) // streaming
    enterSelection('a2') // even if forced in…
    toggleSelection('u1')
    // …the bar's copy only writes what is still selectable
    expect(selectedTexts(ITEMS, msgSelection.get().ids)).toEqual(['planea el viaje'])
  })

  it('i18n: es/en strings for the new keys', () => {
    localeChoice.set('es')
    expect(t('chat.selectMessages')).toBe('Seleccionar mensajes')
    expect(t('chat.selectedCount', { n: 3 })).toBe('3 seleccionados')
    expect(t('chat.copyN', { n: 3 })).toBe('Copiar (3)')
    localeChoice.set('en')
    expect(t('chat.selectedCount', { n: 1 })).toBe('1 selected')
    expect(t('chat.copyN', { n: 1 })).toBe('Copy (1)')
  })

  it('itemText is the single source (matches the old ItemRow extraction)', () => {
    expect(itemText(byId('u1'))).toBe('planea el viaje')
    expect(itemText(byId('n1'))).toBe('nota interna')
    expect(itemText(byId('d1'))).toBe('entregado')
  })
})
