import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '@nanostores/react'
import { msgMenu, openMsgMenu } from './msg-menu-store'
import { contextMenuAction, createLongPress, type LongPressMachine } from './long-press'
import { copyText } from '../../ui/clipboard'
import { showToast } from '../../ui/toast-store'
import { useT } from '../../i18n'

/**
 * Long-press opens the copy popup, Telegram-style — while the finger is still
 * down (~450ms into the hold). The clipboard write itself happens on the
 * popup's "Copy" button click — never here — so iOS keeps its transient
 * activation: that is a fresh user gesture, unlike a setTimeout.
 *
 * The browser rules live in long-press.ts (pure, gesture-tested). This hook is
 * only the React wiring: pointer events → machine, machine.onOpen → the
 * msg-menu store, and the contextmenu split (touch suppresses the native
 * callout; mouse right-click opens at the cursor).
 */
const LONG_PRESS_MS = 450
const MOVE_SLOP_PX = 10
const SCROLL_GRACE_MS = 150

export function useLongPressCopy(id: string, getText: () => string, enabled: boolean) {
  const [pressed, setPressed] = useState(false)
  const t = useT()
  const menu = useStore(msgMenu)

  // Fresh-at-gesture-time values for the machine's stable callbacks (synced
  // in an effect, never during render).
  const enabledRef = useRef(enabled)
  const getTextRef = useRef(getText)
  const elRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef<(pointerId: number) => void>(() => {})
  const lastPointerTypeRef = useRef<string | null>(null)

  useEffect(() => {
    enabledRef.current = enabled
    getTextRef.current = getText
    openRef.current = pointerId => {
      if (!enabledRef.current || !elRef.current) return
      const r = elRef.current.getBoundingClientRect()
      openMsgMenu({
        id,
        text: getTextRef.current(),
        rect: { top: r.top, left: r.left, width: r.width, bottom: r.bottom },
        cursor: null,
        pointerId,
      })
    }
  })

  // The machine is created before the first paint (layout effect), so no user
  // event can ever beat it. Its stable callbacks trampoline into the refs —
  // which are only read at event time.
  const [machine, setMachine] = useState<LongPressMachine | null>(null)
  useLayoutEffect(() => {
    const m = createLongPress(
      { onOpen: pointerId => openRef.current(pointerId), onPressedChange: setPressed },
      {
        delayMs: LONG_PRESS_MS,
        slopPx: MOVE_SLOP_PX,
        scrollGraceMs: SCROLL_GRACE_MS,
        vibrate: () => navigator.vibrate?.(10),
      },
    )
    setMachine(m)
    return () => m.destroy()
    // A gesture still pending on unmount (row recycled) must not fire either:
    // destroy() is the cleanup.
  }, [])

  const copy = useCallback(async () => {
    const ok = await copyText(getTextRef.current())
    showToast(ok ? t('chat.copied') : t('chat.copyFailed'))
  }, [t])

  // While pressing, any scroll (the list, the page) cancels the hold — except
  // the iOS momentum noise the machine's grace window absorbs.
  useEffect(() => {
    if (!pressed || !machine) return
    const onScroll = () => machine.scroll()
    window.addEventListener('scroll', onScroll, { capture: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [pressed, machine])

  const handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void
  } = {
    onPointerDown(e) {
      lastPointerTypeRef.current = e.pointerType
      if (!machine) return
      const armed = machine.down(e) === 'pressing'
      if (armed) {
        elRef.current = e.currentTarget
        // Touch is implicitly captured already (spec §8.4); making it explicit
        // also guarantees delivery on quirky engines when the menu portal
        // appears over the finger.
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // unsupported (tests/jsdom) — implicit capture still applies
        }
      }
    },
    onPointerMove(e) {
      machine?.move(e)
    },
    // The release neither opens nor closes the menu (see long-press.ts).
    onPointerUp() {
      machine?.up()
    },
    onPointerCancel() {
      machine?.cancel()
    },
    onContextMenu(e) {
      e.preventDefault()
      if (contextMenuAction(lastPointerTypeRef.current ?? '') === 'suppress-native') {
        // Touch/pen: the hold timer owns the menu; only kill the callout.
        return
      }
      openMsgMenu({
        id,
        text: getTextRef.current(),
        rect: (() => {
          const r = e.currentTarget.getBoundingClientRect()
          return { top: r.top, left: r.left, width: r.width, bottom: r.bottom }
        })(),
        cursor: { x: e.clientX, y: e.clientY },
        pointerId: null,
      })
    },
  }

  // The bubble stays highlighted while pressed and while its popup is the
  // open one.
  return { handlers, pressed, selected: menu?.id === id, copy }
}
