import { useEffect, useState, type FormEvent } from 'react'
import { useStore } from '@nanostores/react'
import { t, useT } from '../../i18n'
import { Avatar } from '../../ui/Avatar'
import { IconButton } from '../../ui/IconButton'
import { Sheet } from '../../ui/Sheet'
import { useBotAppearance } from '../bots/appearance-store'
import { homeBots } from '../home/store'
import { showToast } from '../../ui/toast-store'
import { profileForSession } from './requests'
import {
  answerSecurePrompt,
  buildSaveLoginValue,
  normalizeCode,
  securePrompts,
  type SecurePrompt,
} from './secure-prompts'
import './secure-prompts.css'

const COUNTDOWN_THRESHOLD_MS = 30_000

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

/**
 * Global host for secure credential prompts. Mounted once in the app shell so a
 * request opens over whatever screen is showing. Shows the oldest pending prompt;
 * answering (or dismissing) it reveals the next, if any.
 */
export function SecurePromptHost() {
  const prompts = useStore(securePrompts)
  const prompt = prompts[0] ?? null
  return prompt ? <SecurePromptSheet key={prompt.id} prompt={prompt} /> : null
}

function SecurePromptSheet({ prompt }: { prompt: SecurePrompt }) {
  const profile = profileForSession(prompt.sessionId)
  const bot = profile ? homeBots.get().find(b => b.name === profile) : undefined
  const botName = profile ?? 'bot'
  const t = useT()
  const asker = bot?.displayName ?? profile ?? t('bots.fallback')
  const appearance = useBotAppearance(botName)

  const now = useNow(true)
  const remaining = Math.max(0, prompt.timeoutMs - (now - prompt.receivedAt))
  const expiring = remaining > 0 && remaining < COUNTDOWN_THRESHOLD_MS

  useEffect(() => {
    if (remaining > 0) return
    answerSecurePrompt(prompt, '')
    showToast(t('chat.secure.expired', { asker }), 6000)
  }, [remaining, prompt, asker, t])

  const cancel = () => answerSecurePrompt(prompt, '')
  // The answer travels to the bot; confirm it so the user is not left guessing.
  const send = (value: string) => {
    answerSecurePrompt(prompt, value)
    if (value) showToast(t('chat.secure.sent', { asker }))
  }

  return (
    <Sheet open onClose={cancel} title={ariaTitle(prompt, asker)}>
      <div className="secure-head">
        <Avatar name={botName} size="md" mood="thinking" appearance={appearance} />
        <div className="secure-head-text">
          <div className="secure-asker">{asker}</div>
          <div className="secure-asker-sub faint">{t('chat.secure.asks')}</div>
        </div>
      </div>

      <SecurePromptBody
        prompt={prompt}
        expiring={expiring}
        remainingS={Math.ceil(remaining / 1000)}
        onAnswer={send}
        onCancel={cancel}
      />
    </Sheet>
  )
}

function ariaTitle(prompt: SecurePrompt, asker: string): string {
  switch (prompt.kind) {
    case 'vault.save_login':
      return t('chat.secure.saveLoginAria', { asker, site: prompt.site || t('chat.secure.aSite') })
    case 'vault.code':
      return t('chat.secure.codeAria', { asker })
    case 'vault.unlock_prompt':
      return t('chat.secure.unlockAria', { asker, name: prompt.displayName || t('chat.secure.theVault') })
    case 'secret':
      return prompt.envVar || t('chat.secure.secretAria', { asker })
    case 'sudo':
      return t('chat.secure.sudoAria', { asker })
  }
}

function SecurePromptBody({
  prompt,
  expiring,
  remainingS,
  onAnswer,
  onCancel,
}: {
  prompt: SecurePrompt
  expiring: boolean
  remainingS: number
  onAnswer: (value: string) => void
  onCancel: () => void
}) {
  if (prompt.kind === 'vault.save_login') {
    return <SaveLoginPrompt prompt={prompt} expiring={expiring} remainingS={remainingS} onAnswer={onAnswer} onCancel={onCancel} />
  }
  if (prompt.kind === 'vault.code') {
    return <CodePrompt prompt={prompt} expiring={expiring} remainingS={remainingS} onAnswer={onAnswer} onCancel={onCancel} />
  }
  return <MaskedPrompt prompt={prompt} expiring={expiring} remainingS={remainingS} onAnswer={onAnswer} onCancel={onCancel} />
}

function SaveLoginPrompt({
  prompt,
  expiring,
  remainingS,
  onAnswer,
  onCancel,
}: {
  prompt: SecurePrompt
  expiring: boolean
  remainingS: number
  onAnswer: (value: string) => void
  onCancel: () => void
}) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const t = useT()
  const canSave = identifier.trim() !== '' && password !== ''

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSave) return
    onAnswer(buildSaveLoginValue(identifier, password))
  }

  return (
    <>
      {prompt.origin && <div className="secure-origin faint">{prompt.origin}</div>}

      <form onSubmit={submit}>
        <label className="secure-label" htmlFor={`${prompt.id}-id`}>
          {t('chat.secure.username')}
        </label>
        <input
          id={`${prompt.id}-id`}
          className="input"
          autoComplete="username"
          autoFocus
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
        />

        <label className="secure-label" htmlFor={`${prompt.id}-pw`}>
          {t('chat.secure.password')}
        </label>
        <div className="secure-password">
          <input
            id={`${prompt.id}-pw`}
            className="input"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <IconButton
            className="secure-eye"
            icon={show ? 'eye-off' : 'eye'}
            variant="ghost"
            label={show ? t('chat.secure.hidePassword') : t('chat.secure.showPassword')}
            onClick={() => setShow(v => !v)}
          />
        </div>

        <p className="secure-footnote faint">{t('chat.secure.storedEncrypted')}</p>

        <SecureActions
          expiring={expiring}
          remainingS={remainingS}
          submitLabel={t('chat.secure.saveAndEnter')}
          submitDisabled={!canSave}
          cancelLabel={t('common.later')}
          onCancel={onCancel}
        />
      </form>
    </>
  )
}

function CodePrompt({
  prompt,
  expiring,
  remainingS,
  onAnswer,
  onCancel,
}: {
  prompt: SecurePrompt
  expiring: boolean
  remainingS: number
  onAnswer: (value: string) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const t = useT()
  const trimmed = normalizeCode(code)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!trimmed) return
    onAnswer(trimmed)
  }

  return (
    <>
      <div className="secure-message">
        {prompt.site ? t('chat.secure.codeNeededFor', { site: prompt.site }) : t('chat.secure.codeNeeded')}
      </div>
      {prompt.hint && <div className="secure-origin faint">{prompt.hint}</div>}

      <form onSubmit={submit}>
        <label className="secure-label" htmlFor={`${prompt.id}-code`}>
          {t('chat.secure.code')}
        </label>
        <input
          id={`${prompt.id}-code`}
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123 456"
          value={code}
          onChange={e => setCode(e.target.value)}
        />

        <SecureActions
          expiring={expiring}
          remainingS={remainingS}
          submitLabel={t('chat.secure.send')}
          submitDisabled={!trimmed}
          cancelLabel={t('common.later')}
          onCancel={onCancel}
        />
      </form>
    </>
  )
}

function MaskedPrompt({
  prompt,
  expiring,
  remainingS,
  onAnswer,
  onCancel,
}: {
  prompt: SecurePrompt
  expiring: boolean
  remainingS: number
  onAnswer: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const t = useT()
  const message = maskedMessage(prompt)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!value) return
    onAnswer(value)
  }

  return (
    <>
      <div className="secure-message">{message}</div>
      {prompt.kind === 'sudo' && prompt.command ? <div className="secure-origin faint mono">{prompt.command}</div> : null}

      <form onSubmit={submit}>
        <label className="secure-label" htmlFor={`${prompt.id}-value`}>
          {prompt.kind === 'sudo' ? t('chat.secure.sudoPassword') : prompt.kind === 'secret' ? t('chat.secure.secretKey') : t('chat.secure.masterPassword')}
        </label>
        <div className="secure-password">
          <input
            id={`${prompt.id}-value`}
            className="input"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
          />
          <IconButton
            className="secure-eye"
            icon={show ? 'eye-off' : 'eye'}
            variant="ghost"
            label={show ? t('chat.secure.hide') : t('chat.secure.show')}
            onClick={() => setShow(v => !v)}
          />
        </div>

        <SecureActions
          expiring={expiring}
          remainingS={remainingS}
          submitLabel={t('chat.secure.send')}
          submitDisabled={!value}
          cancelLabel={prompt.kind === 'sudo' ? t('common.cancel') : t('common.later')}
          onCancel={onCancel}
        />
      </form>
    </>
  )
}

function maskedMessage(prompt: SecurePrompt): string {
  switch (prompt.kind) {
    case 'sudo':
      return t('chat.secure.sudoNeeded')
    case 'secret':
      return prompt.prompt || t('chat.secure.secretNeeded', { name: prompt.envVar || '' }).trim()
    case 'vault.unlock_prompt':
      return prompt.displayName
        ? t('chat.secure.unlockNeeded', { name: prompt.displayName })
        : t('chat.secure.unlockNeededDefault')
    default:
      return t('chat.secure.passwordNeeded')
  }
}

function SecureActions({
  expiring,
  remainingS,
  submitLabel,
  submitDisabled,
  cancelLabel,
  onCancel,
}: {
  expiring: boolean
  remainingS: number
  submitLabel: string
  submitDisabled: boolean
  cancelLabel: string
  onCancel: () => void
}) {
  const t = useT()
  return (
    <>
      {expiring && <div className="secure-countdown">{t('chat.secure.expiresIn', { n: remainingS })}</div>}
      <div className="secure-actions">
        <button className="btn btn-primary btn-block" type="submit" disabled={submitDisabled}>
          {submitLabel}
        </button>
        <button className="btn btn-block" type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </>
  )
}
