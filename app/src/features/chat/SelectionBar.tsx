import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { Icon } from '../../ui/Icon'
import { useT } from '../../i18n'
import { copySelection, exitSelection, msgSelection, selectedTexts } from './msg-selection-store'
import type { ChatItem } from './store'

/**
 * The Telegram-style "N selected" bar shown while multi-selecting messages:
 * ✕ leaves the mode, "Copy (N)" writes every selected text in one clipboard
 * operation (chronological order, joined with blank lines) and closes the
 * selection. Esc leaves too. Mounted once by MessageList.
 */
export function SelectionBar({ items }: { items: ChatItem[] }) {
  const sel = useStore(msgSelection)
  const t = useT()

  useEffect(() => {
    if (!sel.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel.active])

  if (!sel.active) return null

  // Count what can actually be copied: ids of rows still present/selectable.
  const n = selectedTexts(items, sel.ids).length
  return (
    <div className="sel-bar" role="toolbar" aria-label={t('chat.selectMessages')}>
      <button
        type="button"
        className="sel-bar-cancel"
        onClick={exitSelection}
        aria-label={t('common.cancel')}
      >
        <Icon name="close" size={18} />
      </button>
      <span className="sel-bar-count">{t('chat.selectedCount', { n })}</span>
      <button
        type="button"
        className="sel-bar-copy"
        onClick={() => void copySelection(selectedTexts(items, sel.ids))}
        disabled={n === 0}
      >
        <Icon name="copy" size={16} />
        <span>{t('chat.copyN', { n })}</span>
      </button>
    </div>
  )
}
