import { useEffect, useRef } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { useStore } from '@nanostores/react'
import { LoginPage } from '../features/auth/LoginPage'
import { authState, authStatus, checkAuth } from '../features/auth/store'
import { resyncPushOnStart } from '../features/push/store'
import { mintWsTicket } from '../lib/hermes/auth'
import { close, connect } from '../lib/hermes/connection'
import { verifyContractCommit } from '../lib/hermes/contract-version'
import { useT } from '../i18n'
import { UiPage } from '../ui/UiPage'
import { Shell } from './Shell'

export function App() {
  const status = useStore(authStatus)
  const t = useT()
  // The boot effect owns the first connect; the login-retry effect below only
  // acts after it, or both race and mint two tickets / two health checks.
  const booted = useRef(false)

  // Boot (mount, once): `auth/me` and the single-use WS ticket are minted IN
  // PARALLEL (a 401 ticket just means logged out), then the socket dial starts
  // with both results in hand — no serial resolve → ticket → dial chain.
  // Loopback backends ignore the ticket (token URL instead).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [state, ticket] = await Promise.all([checkAuth(), mintWsTicket()])
      if (cancelled) return
      if (state.mode === 'gated' || state.mode === 'loopback') {
        void verifyContractCommit()
        void connect(state, state.mode === 'loopback' ? null : ticket)
      }
      booted.current = true
    })()
    return () => {
      cancelled = true
      close()
    }
  }, [])

  // Re-connect when a login retry flips the status to authed (LoginPage
  // "Reintentar" / Settings backend save). Reuses the state the retry just
  // resolved from `checkAuth()` — never a second auth/me.
  useEffect(() => {
    if (status !== 'authed' || !booted.current) return
    const state = authState.get()
    if (!state || (state.mode !== 'gated' && state.mode !== 'loopback')) return
    void verifyContractCommit()
    void connect(state, null)
    return () => close()
  }, [status])

  // Once logged in, re-send this phone's push subscription (the server may
  // have lost it while the switch still shows "on").
  useEffect(() => {
    if (status === 'authed') void resyncPushOnStart()
  }, [status])

  // Dev-only design-system gallery: reviewable without logging in.
  if (import.meta.env.DEV && window.location.pathname === '/__ui') {
    return (
      <div className="app-shell">
        <UiPage />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        {status === 'checking' ? (
          <div className="app-main centered">
            <span className="connect-glyphs" role="status" aria-label={t('app.connecting')}>
              CONNECT
            </span>
          </div>
        ) : status === 'authed' ? (
          <Shell />
        ) : (
          <LoginPage />
        )}
      </div>
    </BrowserRouter>
  )
}
