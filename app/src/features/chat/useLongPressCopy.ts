import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '@nanostores/react'
import { msgMenu, openMsgMenu } from './msg-menu-store'
import { copyText } from '../../ui/clipboard'
import { showToast } from '../../ui/toast-store'
import { useT } from '../../i18n'

/**
 * Long-press opens the copy popup, Telegram-style. The clipboard write itself
 * happens on the popup's "Copy" button click — never here.
 *
 * Mobile (touch/pen): press ≥450ms without moving >10px, scrolling or landing
 * a second finger → haptic tick + the bubble lights up; on release a popup
 * anchored above the bubble opens. A short tap stays a normal tap (nothing
 * happens). Doing the write from the menu button keeps WebKit's transient
 * activation intact: it is a fresh user gesture, unlike a setTimeout.
 *
 * Desktop (mouse): pointer handlers are no-ops; right-click (contextmenu)
 * opens the same popup at the cursor, and the hover copy button still copies
 * directly via the returned `copy()`.
 */
const LONG_PRESS_MS = 450
const MOVE_SLOP_PX = 10

export function useLongPressCopy(id: string, getText: () => string, enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const firedRef = useRef(false)
  const touchRef = useRef(false)
  const [pressed, setPressed] = useState(false)
  const t = useT()
  const menu = useStore(msgMenu)

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    firedRef.current = false
    setPressed(false)
  }, [])

  const copy = useCallback(async () => {
    const ok = await copyText(getText())
    showToast(ok ? t('chat.copied') : t('chat.copyFailed'))
  }, [getText, t])

  // While pressing, any scroll (the list, the page) cancels the gesture.
  useEffect(() => {
    if (!pressed) return
    const cancel = () => clear()
    window.addEventListener('scroll', cancel, { capture: true })
    return () => window.removeEventListener('scroll', cancel, { capture: true })
  }, [pressed, clear])

  // A gesture still pending on unmount (row recycled mid-press) must not fire.
  useEffect(() => clear, [clear])

  const open = useCallback(
    (rect: DOMRect, cursor: { x: number; y: number } | null) => {
      if (!enabled) return
      openMsgMenu({
        id,
        text: getText(),
        rect: { top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom },
        cursor,
      })
    },
    [enabled, getText, id],
  )

  const handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerCancel: () => void
    onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void
  } = {
    onPointerDown(e) {
      if (e.pointerType === 'mouse') {
        touchRef.current = false
        return
      }
      if (!e.isPrimary) {
        // A second finger lands: the ongoing press is no longer a clean hold.
        if (timerRef.current) clear()
        return
      }
      if (!enabled) return
      touchRef.current = true
      startXRef.current = e.clientX
      startYRef.current = e.clientY
      firedRef.current = false
      setPressed(true)
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        navigator.vibrate?.(10)
      }, LONG_PRESS_MS)
    },
    onPointerMove(e) {
      if (!timerRef.current && !pressed) return
      const dx = e.clientX - startXRef.current
      const dy = e.clientY - startYRef.current
      if (Math.hypot(dx, dy) > MOVE_SLOP_PX) clear()
    },
    onPointerUp(e) {
      const fire = firedRef.current
      const rect = e.currentTarget.getBoundingClientRect()
      clear()
      if (fire) open(rect, null)
    },
    onPointerCancel() {
      clear()
    },
    onContextMenu(e) {
      // Touch: suppress only the native long-press callout — our popup opens
      // on release. Mouse: right-click opens the same popup at the cursor.
      if (touchRef.current) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      open(e.currentTarget.getBoundingClientRect(), { x: e.clientX, y: e.clientY })
    },
  }

  // The bubble stays highlighted while its popup is the open one.
  return { handlers, pressed, selected: menu?.id === id, copy }
}
