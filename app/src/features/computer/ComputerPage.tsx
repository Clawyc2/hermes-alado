import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from '@nanostores/react'
import { useBack, useSlideNavigate } from '../../app/transition'
import { useT } from '../../i18n'
import { displayStart, displayThumbnail, parseGeometry } from '../../lib/hermes/display'
import { PREPARER_COMMAND } from '../../lib/hermes/preparer'
import { EmptyState } from '../../ui/EmptyState'
import { copyText } from '../../ui/clipboard'
import { Icon } from '../../ui/Icon'
import { PageShell } from '../../ui/PageShell'
import { Section } from '../../ui/Section'
import { Skeleton } from '../../ui/Skeleton'
import { applyDisplayStatus, computerDetail, computerError, computerLoading, loadComputer } from './store'
import './computer.css'

const THUMB_INTERVAL_MS = 4000

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const t = useT()
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        void copyText(text).then(ok => {
          setDone(ok)
          setTimeout(() => setDone(false), 1600)
        })
      }}
    >
      {done ? t('common.copied') : t('common.copy')}
    </button>
  )
}

/**
 * Computer (GrokBot screen 8): the bot's official Bot Desktop. Live status
 * from `display.status`; a JPEG thumbnail refreshed while visible; "Watch" opens
 * the full-screen noVNC viewer. Never installs (needs sudo on the server) —
 * the preparer command is shown instead.
 */
export function ComputerPage() {
  const { profile = 'default' } = useParams()
  const back = useBack(`/bots/${encodeURIComponent(profile)}`)
  const t = useT()

  // Keyed by profile so the thumbnail/action state resets with the route
  // instead of needing reset effects.
  return (
    <PageShell title={t('computer.title')} onBack={back}>
      <ComputerBody key={profile} profile={profile} />
    </PageShell>
  )
}

function ComputerBody({ profile }: { profile: string }) {
  const { forward } = useSlideNavigate()
  const detail = useStore(computerDetail)
  const loading = useStore(computerLoading)
  const loadError = useStore(computerError)
  const t = useT()

  const [thumb, setThumb] = useState<string | null>(null)
  const [suppressed, setSuppressed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    void loadComputer(profile)
  }, [profile])

  const running = detail?.running === true

  // A live JPEG every few seconds while the page is visible and the screen is
  // up. A grab suppressed by the lease (a human typing credentials) keeps the
  // last frame instead of flashing an empty one.
  useEffect(() => {
    if (!running) return
    let alive = true
    const tick = async (): Promise<void> => {
      if (!alive || document.visibilityState !== 'visible') return
      try {
        const res = await displayThumbnail(profile)
        if (!alive) return
        if (res.suppressed) {
          setSuppressed(true)
        } else if (res.data_url) {
          setThumb(res.data_url)
          setSuppressed(false)
        }
      } catch {
        // keep the last frame; the status row still tells the truth
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), THUMB_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [running, profile])

  const start = async (): Promise<void> => {
    setStarting(true)
    setActionError('')
    try {
      applyDisplayStatus(await displayStart(profile))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('computer.startFailed'))
    } finally {
      setStarting(false)
    }
  }

  const enc = encodeURIComponent(profile)
  const geometry = parseGeometry(detail?.geometry)

  return (
    <>
      {loading && !detail ? (
        <Section>
          <div style={{ padding: 'var(--space-4)' }}>
            <Skeleton height={180} />
          </div>
        </Section>
      ) : !detail ? (
        <EmptyState
          title={t('computer.loadFailed')}
          text={loadError || t('computer.noConnection')}
          actionLabel={t('common.retry')}
          onAction={() => void loadComputer(profile)}
        />
      ) : !detail.supported ? (
        <EmptyState
          title={t('computer.unavailable')}
          text={t('computer.unavailableText')}
        />
      ) : !detail.installed ? (
        <Section>
          <div className="comp-note">
            <div className="comp-note-title">{t('computer.notInstalledTitle')}</div>
            <p className="muted">
              {t('computer.notInstalledBody')}
            </p>
            <div className="comp-cmd">
              <code className="comp-cmd-code">{PREPARER_COMMAND}</code>
              <CopyButton text={PREPARER_COMMAND} />
            </div>
          </div>
        </Section>
      ) : !detail.running ? (
        <Section>
          <div className="comp-note">
            <div className="comp-note-title">{t('computer.offTitle')}</div>
            <p className="muted">
              {detail.blocker ?? t('computer.offBody')}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={starting || Boolean(detail.blocker)}
              onClick={() => void start()}
            >
              {starting ? (
                t('computer.starting')
              ) : (
                <>
                  <Icon name="power" size={16} /> {t('computer.start')}
                </>
              )}
            </button>
            {actionError ? <p className="error-text">{actionError}</p> : null}
          </div>
        </Section>
      ) : (
        <Section>
          <div className="comp-card">
            <div
              className="comp-screen"
              style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}
            >
              {thumb ? (
                <img className="comp-screen-img" src={thumb} alt={t('computer.screenAlt')} />
              ) : (
                <div className="comp-screen-wait">{t('common.connecting')}</div>
              )}
              {suppressed && <div className="comp-screen-note">{t('computer.otherUsing')}</div>}
            </div>
            <div className="comp-card-row">
              <span className="faint">
                {detail.display ? `${detail.display} · ${detail.geometry}` : detail.geometry}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => forward(`/bots/${enc}/computer/live`)}
            >
              {t('computer.view')}
            </button>
          </div>
        </Section>
      )}
    </>
  )
}
