import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '@nanostores/react'
import { locale, useT } from '../../i18n'
import { Avatar } from '../../ui/Avatar'
import { IconButton } from '../../ui/IconButton'
import { useBotAppearance } from '../bots/appearance-store'
import { Markdown } from './markdown'
import { activitySummary, groupToRows, type ActivityStep } from './activity'
import { loadOlder, retryLast, type ChatItem } from './store'

export function MessageList({
  items,
  running,
  botName,
  isDefault,
  footer,
  footerKey = '',
}: {
  items: ChatItem[]
  running: boolean
  botName: string
  isDefault: boolean
  /** Cards that wait on the user (questions, approvals): shown last, where the bot's reply goes. */
  footer?: ReactNode
  /** Changes when the footer's content changes, to bring it into view. */
  footerKey?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const canLoadRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [newBelow, setNewBelow] = useState(0)
  const t = useT()
  useStore(locale) // re-group the rows when the language changes

  const rows = useMemo(() => groupToRows(items), [items])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current && running) el.scrollTop = el.scrollHeight
  }, [items, running])

  // A new question or approval is something the user must see: always scroll to it.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !footerKey) return
    el.scrollTop = el.scrollHeight
    stickRef.current = true
    setShowJump(false)
  }, [footerKey])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = nearBottom
    setShowJump(!nearBottom)
    if (nearBottom) setNewBelow(0)
    if (el.scrollTop > 200) canLoadRef.current = true
    if (el.scrollTop < 40 && canLoadRef.current) {
      canLoadRef.current = false
      void loadOlder()
    }
  }

  useEffect(() => {
    if (!stickRef.current) {
      setNewBelow(n => n + 1)
    }
  }, [items.length])

  function jumpToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setShowJump(false)
    setNewBelow(0)
  }

  const wordmark = isDefault || !botName ? 'HERMES AGENT' : botName.toUpperCase()

  return (
    <div className="msg-wrap">
      <div className="msg-list" ref={scrollRef} onScroll={onScroll}>
        {rows.length === 0 && !running ? (
          <div className="chat-empty">
            <span className="backdrop-texture" aria-hidden="true" />
            <p className="wordmark">{wordmark}</p>
            <p className="chat-empty-sub">
              {botName ? t('chat.composerPlaceholder', { name: botName }) : t('chat.composerPlaceholder', { name: 'Hermes' })}
            </p>
          </div>
        ) : (
          rows.map(r => (r.kind === 'activity' ? <ActivityRow key={r.id} steps={r.steps} /> : <ItemRow key={r.item.id} g={r.item} />))
        )}
        {footer ?? (running && <TypingIndicator />)}
      </div>
      {showJump && (
        <div className="jump-wrap">
          <IconButton icon="arrow-down" variant="solid" label={t('chat.jumpToBottom')} onClick={jumpToBottom} />
          {newBelow > 0 && <span className="jump-count">{newBelow}</span>}
        </div>
      )}
    </div>
  )
}

function ItemRow({ g }: { g: ChatItem }) {
  const t = useT()
  switch (g.kind) {
    case 'user':
      return (
        <div className="msg user">
          <div className="msg-bubble">{g.text}</div>
        </div>
      )
    case 'agent':
      return (
        <div className="msg-note">
          <NoteAvatar name={g.sender} />
          <span>
            {t('chat.messageFrom', { sender: g.sender })}
          </span>
          {g.body && (
            <details className="msg-note-details">
              <summary>{t('chat.viewMessage')}</summary>
              <div className="msg-note-body">{g.body}</div>
            </details>
          )}
        </div>
      )
    case 'delivery':
      return (
        <div className="msg-note">
          <NoteAvatar name={g.target} />
          <span>
            {t('chat.wroteTo', { target: g.target })}
            {g.pending ? '…' : ''}
          </span>
          {!g.pending && g.reply && (
            <details className="msg-note-details">
              <summary>{t('chat.viewMessage')}</summary>
              <div className="msg-note-body">{g.reply}</div>
            </details>
          )}
        </div>
      )
    case 'assistant':
      return (
        <div className="msg assistant">
          <div className="msg-bubble assistant">
            {g.text.trim() ? (
              <Markdown text={g.text.trim()} />
            ) : g.streaming ? (
              <span className="typing-dots">
                <i /><i /><i />
              </span>
            ) : null}
            {g.error && (
              <div className="msg-error">
                <span>{g.error}</span>
                <button className="btn btn-sm" onClick={() => void retryLast()}>
                  {t('common.retry')}
                </button>
              </div>
            )}
          </div>
        </div>
      )
    case 'error':
      return (
        <div className="msg-error-row">
          <span>⚠ {g.text}</span>
          <button className="btn btn-sm" onClick={() => void retryLast()}>
            {t('common.retry')}
          </button>
        </div>
      )
    case 'reasoning':
    case 'tool':
      return null
  }
}

/**
 * One quiet activity line per tool/reasoning burst: "Working…" while the
 * turn runs, "Done · N steps · X s" when it ends. Tapping expands a compact
 * timeline of friendly steps; the reasoning step stays collapsed by default.
 */
function ActivityRow({ steps }: { steps: ActivityStep[] }) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const { running, text } = activitySummary(steps)

  return (
    <div className={`activity-row${running ? ' activity-running' : ''}`}>
      <button type="button" className="activity-toggle" onClick={() => setOpen(o => !o)}>
        <span className={`activity-status${running ? '' : ' activity-status-done'}`}>
          {running ? (
            <span className="typing-dots activity-dots">
              <i /><i /><i />
            </span>
          ) : (
            '✓'
          )}
        </span>
        <span className="activity-label">{running ? t('chat.activity.workingShort') : text}</span>
        <span className="activity-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="activity-steps">
          {steps.map(step =>
            step.kind === 'reasoning' ? (
              <details key={step.id} className="reasoning">
                <summary>{step.label}</summary>
                <div className="reasoning-body">{step.reasoningText}</div>
              </details>
            ) : (
              <div key={step.id} className="activity-step">
                <span className={`activity-step-status${step.done ? ' activity-step-status-done' : ''}`}>
                  {step.done ? '✓' : '…'}
                </span>
                <span className="activity-step-label">{step.label}</span>
                {step.durationS != null && <span className="activity-step-time">{step.durationS.toFixed(1)} s</span>}
                {step.detail && <span className="activity-step-detail">{step.detail}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function NoteAvatar({ name }: { name: string }) {
  const appearance = useBotAppearance(name)
  return <Avatar name={name} size="xs" appearance={appearance} />
}

function TypingIndicator() {
  return (
    <div className="msg assistant">
      <div className="msg-bubble assistant">
        <span className="typing-dots">
          <i /><i /><i />
        </span>
      </div>
    </div>
  )
}
