import { atom } from 'nanostores'
import { copyText } from '../../ui/clipboard'
import { showToast } from '../../ui/toast-store'
import { t } from '../../i18n'
import { closeMsgMenu, type MsgMenu } from './msg-menu-store'
import type { ChatItem } from './store'

/**
 * Telegram-style multi-message selection. Long-press → "Select messages"
 * enters the mode with that message pre-checked; taps toggle bubbles; the
 * bottom bar counts and copies everything selected in one write (texts joined
 * with a blank line, WhatsApp-style). Deselecting the last message — or the
 * bar's ✕ / Esc — leaves the mode.
 *
 * State is one immutable atom so React (useStore) re-renders on every change;
 * every mutation below sets a FRESH object/Set.
 */
export type MsgSelection = {
  active: boolean
  ids: ReadonlySet<string>
}

export const msgSelection = atom<MsgSelection>({ active: false, ids: new Set() })

/** Enter the mode with `id` pre-selected (the long-pressed message). */
export function enterSelection(id: string): void {
  msgSelection.set({ active: true, ids: new Set([id]) })
}

/** Leave the mode and forget every checked bubble. */
export function exitSelection(): void {
  const s = msgSelection.get()
  if (!s.active && s.ids.size === 0) return
  msgSelection.set({ active: false, ids: new Set() })
}

/**
 * A tap on a bubble while selecting. Toggling OFF the last remaining message
 * leaves the mode (Telegram does the same) — there is nothing left to act on.
 */
export function toggleSelection(id: string): void {
  const s = msgSelection.get()
  if (!s.active) return
  const ids = new Set(s.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  msgSelection.set(ids.size === 0 ? { active: false, ids } : { active: true, ids })
}

export function isSelected(id: string): boolean {
  return msgSelection.get().ids.has(id)
}

/** The menu's "Select messages" item — mirror of copyFromMsgMenu. */
export function selectFromMsgMenu(menu: NonNullable<MsgMenu>): void {
  closeMsgMenu()
  enterSelection(menu.id)
}

/**
 * What a press on a bubble means RIGHT NOW. While selecting, taps toggle and
 * the long-press machine is not even attached (ItemRow consults this); a
 * non-copyable row (streaming / empty) is inert in both modes.
 */
export function bubblePressAction(
  selecting: boolean,
  copyable: boolean,
): 'toggle' | 'long-press' | 'none' {
  if (selecting) return copyable ? 'toggle' : 'none'
  return copyable ? 'long-press' : 'none'
}

/** The raw copyable text of an item — the ONE source ItemRow and selection share. */
export function itemText(g: ChatItem): string {
  switch (g.kind) {
    case 'user':
      return g.text
    case 'assistant':
      return g.text
    case 'agent':
      return g.body
    case 'delivery':
      return g.reply
    default:
      return ''
  }
}

/** Copyable = has text and is not mid-stream. */
export function isSelectable(g: ChatItem): boolean {
  return itemText(g).trim() !== '' && !(g.kind === 'assistant' && g.streaming)
}

/**
 * Texts of the selected items in CHRONOLOGICAL order (the chat list's own
 * order), skipping ids that vanished or turned non-copyable (streaming).
 */
export function selectedTexts(items: ChatItem[], ids: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const g of items) {
    if (ids.has(g.id) && isSelectable(g)) out.push(itemText(g))
  }
  return out
}

/**
 * The selection bar's "Copy (N)" — the ONLY clipboard write of multi-copy,
 * fired from a real click. One tap → one write → one toast, and it leaves
 * selection mode.
 */
export async function copySelection(texts: string[]): Promise<void> {
  exitSelection()
  const ok = await copyText(texts.join('\n\n'))
  showToast(ok ? t('chat.copied') : t('chat.copyFailed'))
}
