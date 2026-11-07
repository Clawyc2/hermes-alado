import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from '@nanostores/react'
import { useBack, useSlideNavigate } from '../../app/transition'
import { useT } from '../../i18n'
import { Avatar } from '../../ui/Avatar'
import { IconButton } from '../../ui/IconButton'
import { useBotAppearance, ensureAppearances } from '../bots/appearance-store'
import { homeBots } from '../home/store'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { RequestCard } from './RequestCards'
import { requests } from './requests'
import {
  chatMeta,
  chatSessionId,
  closeChat,
  items,
  openChat,
  openError,
  running,
  setChatVisible,
  stop,
} from './store'

export function ChatPage() {
  const { profile = 'default' } = useParams()
  const back = useBack('/')
  const { forward } = useSlideNavigate()
  const list = useStore(items)
  const isRunning = useStore(running)
  const cards = useStore(requests)
  const meta = useStore(chatMeta)
  const bots = useStore(homeBots)
  const error = useStore(openError)
  const t = useT()

  const bot = bots.find(b => b.name === profile)
  const appearance = useBotAppearance(profile)

  useEffect(() => {
    ensureAppearances()
    setChatVisible(true)
    void openChat(profile, bot?.displayName).catch(() => undefined)
    return () => {
      setChatVisible(false)
      closeChat()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const sessionCards = cards.filter(c => c.sessionId === chatSessionId())

  return (
    <div className="chat-page">
      <header className="chat-header glass">
        <IconButton icon="back" variant="ghost" label={t('common.back')} onClick={back} />
        <button
          className="chat-header-identity"
          onClick={() => forward(`/bots/${encodeURIComponent(profile)}`)}
        >
          <Avatar name={profile} size="sm" mood={isRunning ? 'thinking' : 'idle'} appearance={appearance} />
          <span className="chat-title">{bot?.displayName || meta.displayName || profile}</span>
        </button>
        <span className="spacer" />
        {isRunning ? (
          <IconButton icon="stop" variant="glass" label={t('common.stop')} onClick={() => void stop()} />
        ) : (
          <IconButton icon="more" variant="ghost" label={t('common.more')} disabled />
        )}
      </header>

      {error && list.length === 0 && (
        <div className="empty">
          <p className="error-text">{error}</p>
          <button className="btn" onClick={() => void openChat(profile, bot?.displayName)}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <MessageList
        items={list}
        running={isRunning}
        botName={bot?.displayName || meta.displayName || profile}
        isDefault={Boolean(bot?.isDefault)}
        footerKey={sessionCards.map(c => c.id).join(',')}
        footer={
          sessionCards.length > 0 ? (
            <div className="request-cards">
              {sessionCards.map(c => (
                <RequestCard key={c.id} card={c} bot={bot?.displayName || meta.displayName || profile} />
              ))}
            </div>
          ) : undefined
        }
      />

      <Composer />
    </div>
  )
}
