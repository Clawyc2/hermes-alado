import { atom } from 'nanostores'

/**
 * The one open "copy message" popup (Telegram-style). A single atom so the
 * whole chat renders a single menu + backdrop (mounted once in MessageList):
 * which message it belongs to, the raw text captured at gesture time, and
 * where to anchor it on screen.
 */
export type MsgMenu = {
  /** ChatItem id — ItemRow matches it to keep the pressed bubble highlighted. */
  id: string
  /** Raw text to copy, snapshotted when the gesture happened. */
  text: string
  /** Bubble rect in viewport coords (getBoundingClientRect at gesture time). */
  rect: { top: number; left: number; width: number; bottom: number }
  /** Desktop right-click: anchor at the cursor instead of above the bubble. */
  cursor: { x: number; y: number } | null
  /** performance.now() at open — used to swallow the gesture's trailing click. */
  openedAt: number
}

export const msgMenu = atom<MsgMenu | null>(null)

export function openMsgMenu(menu: Omit<MsgMenu, 'openedAt'>): void {
  msgMenu.set({ ...menu, openedAt: performance.now() })
}

export function closeMsgMenu(): void {
  if (msgMenu.get()) msgMenu.set(null)
}
