/**
 * Telegram-style long-press machine — the browser-quirk rules, pure and
 * framework-free so they can be driven like real user gestures in tests.
 *
 * Distilled from Telegram Web's own implementation
 * (morethanwords/tweb, src/helpers/dom/attachContextMenuListener.ts) plus the
 * Pointer Events spec:
 *
 * - The hold timer OPENS the menu while the finger is still down (tweb opens
 *   inside its 400ms touchstart timer — `TOUCH_HOLD_DURATION` — and then
 *   cancels the trailing touchend: "* fix instant instant closing"). Here the
 *   opening gesture is recognized by pointerId instead (see msg-menu-store).
 * - After the open, the gesture goes deaf: drift, extra fingers, scroll and
 *   the release itself must neither close nor reopen the menu. The release
 *   still arrives on the bubble thanks to implicit pointer capture for touch
 *   (Pointer Events spec §8.4 — direct manipulation pointers are captured to
 *   the pointerdown target, portals on top and all).
 * - A pending hold is cancelled by movement beyond the slop, a second finger,
 *   or a scroll that starts AFTER a short grace window. On iOS, momentum /
 *   rubber-band settling keeps firing `scroll` events once the finger is down
 *   again — those trailing events must not kill the fresh gesture (the
 *   "second long-press dies" bug). A real drag is caught by the move slop
 *   long before any scroll event fires.
 * - Mouse pointers are ignored; desktop opens the menu from `contextmenu`.
 */

export type LongPressPointerEvent = {
  pointerId: number
  pointerType: string
  isPrimary: boolean
  clientX: number
  clientY: number
}

export type LongPressState = 'idle' | 'pressing' | 'open'

export type LongPressHandlers = {
  /** Fired from inside the hold timer: open the menu NOW, finger still down. */
  onOpen: (pointerId: number) => void
  /** pressed visual: true on pointerdown, false on release/cancel. */
  onPressedChange?: (pressed: boolean) => void
}

export type LongPressOptions = {
  delayMs?: number
  slopPx?: number
  /** Scroll events this soon after pointerdown are iOS momentum noise. */
  scrollGraceMs?: number
  now?: () => number
  vibrate?: () => void
}

export type LongPressMachine = {
  readonly state: LongPressState
  /** 'ignored' (mouse/second finger), 'pressing' (hold armed) or 'held-open'. */
  down(e: LongPressPointerEvent): 'ignored' | 'pressing' | 'held-open'
  move(e: LongPressPointerEvent): void
  /** The release: never opens, never closes — only ends the gesture. */
  up(): void
  /** The browser claimed the pointer (scroll/zoom): same as up for us. */
  cancel(): void
  /** A scroll happened somewhere while a hold is pending. */
  scroll(): void
  /** Row unmounted mid-gesture: nothing may fire afterwards. */
  destroy(): void
}

export function createLongPress(handlers: LongPressHandlers, opts: LongPressOptions = {}): LongPressMachine {
  const delayMs = opts.delayMs ?? 450
  const slopPx = opts.slopPx ?? 10
  const scrollGraceMs = opts.scrollGraceMs ?? 150
  const now = opts.now ?? Date.now

  let state: LongPressState = 'idle'
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let pressedAt = 0

  const setPressed = (on: boolean) => handlers.onPressedChange?.(on)

  const toIdle = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (state !== 'idle') {
      state = 'idle'
      setPressed(false)
    }
  }

  return {
    get state() {
      return state
    },

    down(e) {
      if (e.pointerType === 'mouse') return 'ignored'
      if (!e.isPrimary) {
        // Second finger: spoils only a *pending* hold. An open menu (or an
        // idle gesture) must not care.
        if (state === 'pressing') toIdle()
        return state === 'open' ? 'held-open' : 'ignored'
      }
      if (state === 'open') {
        // This gesture's menu is still up; presses that still reach the
        // bubble belong to the outside-close path, not a new hold.
        return 'held-open'
      }
      state = 'pressing'
      startX = e.clientX
      startY = e.clientY
      pressedAt = now()
      setPressed(true)
      if (timer) clearTimeout(timer)
      const pointerId = e.pointerId
      timer = setTimeout(() => {
        timer = null
        if (state !== 'pressing') return
        state = 'open'
        opts.vibrate?.()
        handlers.onOpen(pointerId)
      }, delayMs)
      return 'pressing'
    },

    move(e) {
      // After the open the finger may drift (or tremble) — the menu stays.
      if (state !== 'pressing') return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.hypot(dx, dy) > slopPx) toIdle()
    },

    up() {
      toIdle()
    },

    cancel() {
      // If the menu already opened it stays: a genuine scroll with the menu
      // open is closed by CopyMenu's own scroll listener, not by the gesture.
      toIdle()
    },

    scroll() {
      if (state !== 'pressing') return
      if (now() - pressedAt < scrollGraceMs) return
      toIdle()
    },

    destroy() {
      toIdle()
    },
  }
}

/**
 * What the bubble's `contextmenu` handler should do. On Apple touch devices
 * tweb refuses to use the contextmenu event at all ("can't cancel further
 * events coming after 'contextmenu'"): the hold timer owns the menu, so touch
 * only suppresses the native callout. Mouse right-clicks open it at the cursor.
 */
export function contextMenuAction(lastPointerType: string): 'suppress-native' | 'open-menu' {
  return lastPointerType === 'mouse' ? 'open-menu' : 'suppress-native'
}
