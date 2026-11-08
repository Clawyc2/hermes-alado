import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@nanostores/react'
import {
  backdropPointerAction,
  closeMsgMenu,
  copyFromMsgMenu,
  isOpeningClick,
  msgMenu,
} from './msg-menu-store'
import { Icon } from '../../ui/Icon'
import { useT } from '../../i18n'

const GAP = 8 // menu ↔ bubble / cursor
const EDGE = 8 // viewport margin
const ARROW_W = 10

type Pos = { left: number; top: number; below: boolean; arrowX: number }

/**
 * The single Telegram-style copy popup for the chat, mounted once by
 * MessageList. Long-press anchors it above the pressed bubble (with a little
 * arrow) — and the menu opens while the finger is still down, so the backdrop
 * swallows that same pointer's release (pointerId) instead of treating it as
 * a tap-outside. Desktop right-click anchors it at the cursor. Tapping the
 * backdrop, scrolling or Esc closes it; tapping "Copy" is the only clipboard
 * write — a real click, so iOS is happy.
 */
export function CopyMenu() {
  const menu = useStore(msgMenu)
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)

  // Measure and land the menu in the same frame (renders off-screen first).
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null)
      return
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = ref.current.offsetWidth
    const h = ref.current.offsetHeight
    const anchorX = menu.cursor ? menu.cursor.x : menu.rect.left + menu.rect.width / 2
    const left = Math.min(Math.max(anchorX - w / 2, EDGE), Math.max(vw - w - EDGE, EDGE))
    const arrowX = Math.min(Math.max(anchorX - left, ARROW_W), Math.max(w - ARROW_W, ARROW_W))
    let below = false
    // Long-press: hover above the bubble. Right-click: drop below the cursor,
    // like a native menu. Both flip to the other side when they don't fit.
    let top = menu.cursor ? menu.cursor.y + GAP : menu.rect.top - h - GAP
    if (top < EDGE + safeTopPx()) {
      below = true
      top = (menu.cursor ? menu.cursor.y : menu.rect.bottom) - h - GAP
    }
    top = Math.min(Math.max(top, EDGE), Math.max(vh - h - EDGE, EDGE))
    setPos({ left, top, below, arrowX })
  }, [menu])

  // The list scrolls → the anchor goes stale: close. Esc closes (desktop).
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMsgMenu()
    }
    window.addEventListener('scroll', closeMsgMenu, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', closeMsgMenu, { capture: true })
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Outside pointers close the menu — except the very gesture that opened it
  // (its release must not count as a tap-outside).
  const onBackdropPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (backdropPointerAction(menu, e.pointerId) === 'close') closeMsgMenu()
  }

  if (!menu) {
    // The backdrop node itself stays mounted (inert via CSS) so it is never
    // removed from the DOM mid-gesture — the WebKit-safe pattern.
    return createPortal(<div className="copy-menu-backdrop" aria-hidden="true" />, document.body)
  }

  return createPortal(
    <>
      <div
        className="copy-menu-backdrop"
        data-open=""
        aria-hidden="true"
        onPointerDown={onBackdropPointerDown}
        onContextMenu={e => {
          e.preventDefault()
          closeMsgMenu()
        }}
      />
      <div
        ref={ref}
        className={`copy-menu${pos?.below ? ' copy-menu-below' : ''}`}
        role="menu"
        aria-label={t('chat.copyMessage')}
        style={pos ? { left: pos.left, top: pos.top } : undefined}
        onContextMenu={e => {
          e.preventDefault()
          closeMsgMenu()
        }}
      >
        <button
          type="button"
          className="copy-menu-item"
          role="menuitem"
          onClick={e => {
            // Swallow the opening gesture's trailing click (same pointerId)
            // and the first instants after open (iOS ghost tap).
            const ev = e as unknown as PointerEvent
            if (isOpeningClick(menu, ev.pointerId, performance.now())) return
            void copyFromMsgMenu(menu)
          }}
        >
          <Icon name="copy" />
          <span>{t('chat.copyMessage')}</span>
        </button>
        {!menu.cursor && (
          <span className="copy-menu-arrow" style={{ left: pos ? pos.arrowX : 0 }} aria-hidden="true" />
        )}
      </div>
    </>,
    document.body,
  )
}

/** The notched safe area at the top (status bar in standalone mode). */
function safeTopPx(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-top')
  return parseFloat(v) || 0
}
