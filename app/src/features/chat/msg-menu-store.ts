import { atom } from 'nanostores'
import { copyText } from '../../ui/clipboard'
import { showToast } from '../../ui/toast-store'
import { t } from '../../i18n'

/** The release of the opening gesture can leave a trailing click; a real tap
 *  on "Copy" can't land this fast after the menu appears. */
export const CLICK_GRACE_MS = 300

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
  /**
   * Touch pointerId of the gesture that opened the menu. The menu opens while
   * the finger is still down, so that same pointer's release and trailing
   * click must be swallowed (tweb cancels the trailing touchend: "* fix
   * instant closing"). null on the desktop right-click path.
   */
  pointerId: number | null
  /** performance.now() at open — used to swallow the gesture's trailing click. */
  openedAt: number
}

export const msgMenu = atom<MsgMenu | null>(null)

/**
 * Menus whose "Copy" already ran. Every open creates a FRESH menu object, so a
 * new long-press on the same message is a new copy — but any SECOND invocation
 * for the same open (iOS's deferred ghost click after the release, a
 * double-delivered click on the item before React unmounts the portal, …) is
 * a no-op. This is the one-toast guarantee, at the only place that writes.
 */
const copiedMenus = new WeakSet<MsgMenu>()

export function openMsgMenu(menu: Omit<MsgMenu, 'openedAt'>): void {
  msgMenu.set({ ...menu, openedAt: performance.now() })
}

export function closeMsgMenu(): void {
  if (msgMenu.get()) msgMenu.set(null)
}

/**
 * What the menu's "Copy" button does — the ONLY clipboard write in the
 * feature, and always from a real click (fresh user gesture, iOS-friendly).
 * One-shot per menu instance: ghosts and duplicated clicks after the first
 * copy are swallowed here, so one tap = one clipboard write = one toast.
 * Exported so the gesture tests drive the exact production path.
 */
export async function copyFromMsgMenu(menu: NonNullable<MsgMenu>): Promise<void> {
  if (copiedMenus.has(menu)) return // already copied this open — ghost/dup click
  copiedMenus.add(menu)
  closeMsgMenu()
  const ok = await copyText(menu.text)
  showToast(ok ? t('chat.copied') : t('chat.copyFailed'))
}

/** Is this pointer event part of the very gesture that opened the menu? */
export function isOpeningPointer(menu: MsgMenu | null, pointerId: number | undefined): boolean {
  return menu != null && menu.pointerId != null && pointerId === menu.pointerId
}

/**
 * What a pointer event landing on the backdrop should do:
 * - 'none'    no menu is open — the backdrop stays mounted but inert
 *             (`pointer-events: none`). Keeping the node mounted means it is
 *             NEVER removed mid-gesture: tweb reuses one overlay element and
 *             only ever closes it on the synthetic mousedown iOS fires AFTER
 *             touchend, so a teardown never races an in-flight gesture.
 * - 'swallow' the opening gesture's own pointer — do nothing, keep the menu.
 * - 'close'   any other pointer: tap outside closes.
 */
export function backdropPointerAction(
  menu: MsgMenu | null,
  pointerId: number | undefined,
): 'none' | 'swallow' | 'close' {
  if (!menu) return 'none'
  if (isOpeningPointer(menu, pointerId)) return 'swallow'
  return 'close'
}

/**
 * May the menu's "Copy" button run for this click? Two ghosts to swallow:
 * the opening gesture's own trailing click (same pointerId — click events
 * carry the pointer's id in every modern browser) and the tap iOS can deliver
 * right as the popup lands.
 */
export function isOpeningClick(menu: MsgMenu, pointerId: number | undefined, now: number): boolean {
  if (isOpeningPointer(menu, pointerId)) return true
  return now - menu.openedAt < CLICK_GRACE_MS
}
