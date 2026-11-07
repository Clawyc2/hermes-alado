import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { copyText } from '../../ui/clipboard'
import { showToast } from '../../ui/toast-store'
import { useT } from '../../i18n'

/**
 * Long-press to copy, chat-app style (Telegram-like).
 *
 * Mobile (touch/pen): press ≥450ms without moving >10px arms the copy; the
 * actual clipboard write happens in onPointerUp — a real user gesture — so
 * WebKit's transient activation is intact (calling from the timer would be
 * rejected in iOS standalone). Scrolling, a second finger or an early
 * release cancels.
 *
 * Desktop (mouse): pointer handlers are no-ops; use the hover copy button
 * (the returned `copy()`).
 */
const LONG_PRESS_MS = 450
const MOVE_SLOP_PX = 10

export function useLongPressCopy(getText: () => string, enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const firedRef = useRef(false)
  const touchRef = useRef(false)
  const [armed, setArmed] = useState(false)
  const t = useT()

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    firedRef.current = false
    setArmed(false)
  }, [])

  const copy = useCallback(async () => {
    const ok = await copyText(getText())
    showToast(ok ? t('chat.copied') : t('chat.copyFailed'))
  }, [getText, t])

  // While armed, any scroll (the list, the page) cancels the gesture.
  useEffect(() => {
    if (!armed) return
    const cancel = () => clear()
    window.addEventListener('scroll', cancel, { capture: true })
    return () => window.removeEventListener('scroll', cancel, { capture: true })
  }, [armed, clear])

  useEffect(() => clear, [clear])

  const handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void
  } = {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
      if (e.pointerType === 'mouse' || !e.isPrimary || !enabled) return
      touchRef.current = true
      startXRef.current = e.clientX
      startYRef.current = e.clientY
      firedRef.current = false
      setArmed(true)
      timerRef.current = setTimeout(() => {
        firedRef.current = true
      }, LONG_PRESS_MS)
    },
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      if (!timerRef.current && !armed) return
      const dx = e.clientX - startXRef.current
      const dy = e.clientY - startYRef.current
      if (Math.hypot(dx, dy) > MOVE_SLOP_PX) clear()
    },
    onPointerUp() {
      const fire = firedRef.current
      clear()
      if (fire && enabled) void copy()
    },
    onPointerCancel() {
      clear()
    },
    onContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
      // Suppress the native long-press menu only for touch; keep the
      // desktop context menu (Inspect, Translate…) untouched.
      if (touchRef.current) e.preventDefault()
    },
  }

  return { handlers, armed, copy }
}
