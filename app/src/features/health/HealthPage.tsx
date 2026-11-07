import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import { useSlideNavigate, useBack } from '../../app/transition'
import { useT, useTp } from '../../i18n'
import type { CheckStatus } from '../../lib/hermes/doctor-output'
import { PREPARER_COMMAND } from '../../lib/hermes/preparer'
import type { Remediation } from '../../lib/hermes/remediation'
import type { ProfileRow } from '../../lib/hermes/rpc-types'
import { ensureAppearances, useBotAppearance } from '../bots/appearance-store'
import {
  activeProfile,
  activeResolved,
  featuredBotName,
  homeProfiles,
  loadHome,
} from '../home/store'
import { botDisplayName } from '../bot-profile/store'
import { Avatar } from '../../ui/Avatar'
import { copyText } from '../../ui/clipboard'
import { Disclosure } from '../../ui/Disclosure'
import { PageShell } from '../../ui/PageShell'
import { Row, Section } from '../../ui/Section'
import { Skeleton } from '../../ui/Skeleton'
import { StatusDot, type DotTone } from '../../ui/StatusDot'
import { groupDoctorAreas } from './areas'
import {
  collectRemediations,
  computerUse,
  doctorError,
  doctorPhase,
  doctorRaw,
  doctorResult,
  envVars,
  loadProbes,
  modelCredential,
  probeError,
  probeLoading,
  repairBusy,
  repairError,
  repairProgress,
  runDoctor,
  runRepair,
  switchHealthProfile,
  toolsets,
} from './store'
import './health.css'

const CLOUD_BROWSERS: { titleKey: 'health.cloudBrowserBase' | 'health.cloudBrowserUse'; key: string }[] = [
  { titleKey: 'health.cloudBrowserBase', key: 'BROWSERBASE_API_KEY' },
  { titleKey: 'health.cloudBrowserUse', key: 'BROWSER_USE_API_KEY' },
]

function checkTone(status: CheckStatus): DotTone {
  return status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'danger'
}

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

function RemediationCard({
  remediation,
  onRepair,
  onOpenVault,
}: {
  remediation: Remediation
  onRepair: (r: Remediation) => void
  onOpenVault: (key: string) => void
}) {
  const busy = useStore(repairBusy) === remediation.id
  const progress = useStore(repairProgress)
  const error = useStore(repairError)
  const t = useT()

  if (remediation.kind === 'root') {
    return (
      <div className="health-fix card">
        <div className="health-fix-title">{t('health.needsServer')}</div>
        <div className="health-fix-finding">
          {remediation.title} — {remediation.finding}
        </div>
        {remediation.specific && (
          <div className="health-cmd">
            <div className="health-cmd-label">{t('health.thisOnly')}</div>
            <div className="health-cmd-row">
              <code className="health-cmd-code">{remediation.specific}</code>
              <CopyButton text={remediation.specific} />
            </div>
          </div>
        )}
        <div className="health-cmd">
          <div className="health-cmd-label">{t('health.fullRepair')}</div>
          <div className="health-cmd-row">
            <code className="health-cmd-code">{PREPARER_COMMAND}</code>
            <CopyButton text={PREPARER_COMMAND} />
          </div>
        </div>
      </div>
    )
  }

  if (remediation.kind === 'vault') {
    return (
      <Row
        icon="folder"
        tint="accent"
        title={remediation.title}
        subtitle={remediation.finding}
        chevron
        onClick={() => onOpenVault(remediation.envKey)}
      />
    )
  }

  return (
    <div className="health-fix card">
      <div className="health-fix-title">{remediation.title}</div>
      <div className="health-fix-finding">{remediation.finding}</div>
      {busy && progress ? <div className="faint health-progress">{progress}</div> : null}
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => onRepair(remediation)}
      >
        {busy ? t('health.repairing') : t('health.repair')}
      </button>
    </div>
  )
}

export function HealthPage() {
  const { forward } = useSlideNavigate()
  const back = useBack('/settings')
  const rows = useStore(homeProfiles)
  const active = useStore(activeProfile)
  const t = useT()
  const tp = useTp()

  // The bot being diagnosed: the featured bot by default (the principal bot
  // when unset), changeable via the picker chips. The doctor + probes run for
  // THIS profile (explicit arg) — never the server's active profile.
  const [profile, setProfile] = useState(() => featuredBotName() ?? 'default')

  // Settle the default once the roster AND the server's active profile have
  // arrived (deep links start without either): featured → active → first row.
  // Afterwards only a missing bot is replaced. Adjusted during render (React's
  // "storing information from previous renders" pattern) so no effect fires a
  // cascading render. A manual pick wins over the settle.
  const activeReady = useStore(activeResolved)
  const [settled, setSettled] = useState(false)
  const [picked, setPicked] = useState(false)
  const [prevRows, setPrevRows] = useState(rows)
  const [prevReady, setPrevReady] = useState(activeReady)
  const ready = activeReady || featuredBotName() !== null
  if (rows !== prevRows || ready !== prevReady) {
    setPrevRows(rows)
    setPrevReady(ready)
    if (rows.length > 0) {
      if (!settled && ready && !picked) {
        setSettled(true)
        const desired = featuredBotName() ?? active
        if (desired && rows.some(r => r.name === desired)) setProfile(desired)
        else if (!rows.some(r => r.name === profile)) setProfile(rows[0].name)
      } else if (settled && !rows.some(r => r.name === profile)) {
        setProfile(rows[0].name)
      }
    }
  }

  const probesLoading = useStore(probeLoading)
  const probesError = useStore(probeError)
  const cu = useStore(computerUse)
  const ts = useStore(toolsets)
  const mc = useStore(modelCredential)
  const env = useStore(envVars)

  const phase = useStore(doctorPhase)
  const result = useStore(doctorResult)
  const raw = useStore(doctorRaw)
  const docError = useStore(doctorError)

  useEffect(() => {
    ensureAppearances()
    if (homeProfiles.get().length === 0) void loadHome()
  }, [])

  useEffect(() => {
    switchHealthProfile(profile)
  }, [profile])

  const areas = useMemo(() => (result ? groupDoctorAreas(result) : []), [result])
  const remediations = collectRemediations()

  const browserRow = ts.find(row => row.name === 'browser')
  const cuDotTone: DotTone = cu == null ? 'neutral' : cu.ready === true ? 'ok' : 'warn'
  const cuDotLabel = cu == null ? t('tools.status.unknown') : cu.ready === true ? t('tools.status.ready') : t('tools.status.needsSetup')

  const modelDotTone: DotTone =
    mc == null ? 'neutral' : mc.isSet === true ? 'ok' : mc.isSet === false ? 'warn' : 'neutral'
  const modelDotLabel =
    mc == null
      ? t('health.summary.unknown')
      : mc.isSet === true
        ? t('health.withKey')
        : mc.isSet === false
          ? t('health.withoutKey')
          : t('health.noVaultKey')

  const summaryTone: DotTone = result ? (result.issues.length > 0 ? 'warn' : 'ok') : 'neutral'
  const summaryLabel = result
    ? result.issues.length > 0
      ? tp('health.issuesFound', result.issues.length)
      : t('health.noIssues')
    : ''

  const enc = encodeURIComponent(profile)
  const vaultUrl = (key: string) => `/bots/${enc}/vault/${encodeURIComponent(key)}`

  return (
    <PageShell title={t('health.title')} onBack={back}>
      <BotPicker
        value={profile}
        onChange={name => {
          setPicked(true)
          setProfile(name)
        }}
      />

      <Section label={t('health.diagnosis')}>
        {phase === 'idle' && (
          <Row
            icon="bolt"
            tint="accent"
            title={t('health.runDiagnosis')}
            subtitle={t('health.runDiagnosisSub')}
            onClick={() => void runDoctor(profile)}
          />
        )}
        {phase === 'running' && (
          <Row icon="bolt" title={t('health.diagnosisRunning')} subtitle={<StatusDot tone="neutral" label={t('health.checking')} />} />
        )}
        {phase === 'error' && (
          <div className="empty">
            <p className="error-text">{docError}</p>
            <button className="btn" onClick={() => void runDoctor(profile)}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {phase === 'done' && result && (
          <Row
            icon="bolt"
            title={summaryLabel}
            subtitle={t('health.diagnosisDone')}
            trailing={<StatusDot tone={summaryTone} />}
            onClick={() => void runDoctor(profile)}
          />
        )}
      </Section>

      {phase === 'done' && result && areas.length === 0 && (
        <p className="muted" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          {t('health.unreadable')}
        </p>
      )}

      {phase === 'done' &&
        result &&
        areas.map(area => (
          <Section key={area.labelKey} label={area.label}>
            {area.checks.map(check => (
              <Row
                key={`${check.status}:${check.text}`}
                title={check.text}
                subtitle={check.detail || undefined}
                trailing={<StatusDot tone={checkTone(check.status)} />}
              />
            ))}
          </Section>
        ))}

      {phase === 'done' && raw && (
        <div className="advanced-block">
          <Disclosure title={t('health.fullOutput')}>
            <pre className="health-raw">{raw}</pre>
          </Disclosure>
        </div>
      )}

      <Section label={t('health.immediateState')}>
        {probesLoading ? (
          <div style={{ padding: 'var(--space-4)' }}>
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </div>
        ) : probesError ? (
          <div className="empty">
            <p className="error-text">{probesError}</p>
            <button className="btn" onClick={() => void loadProbes(profile)}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <>
            <Row
              icon="bolt"
              title={t('health.activeModel')}
              subtitle={mc ? mc.label : t('health.summary.unknown')}
              trailing={<StatusDot tone={modelDotTone} label={modelDotLabel} />}
            />
            <Row
              icon="monitor"
              title={t('health.browser')}
              subtitle={browserRow ? t('health.browserTool') : t('health.summary.unknown')}
              trailing={
                <StatusDot
                  tone={browserRow ? (browserRow.enabled ? 'ok' : 'warn') : 'neutral'}
                  label={browserRow ? (browserRow.enabled ? t('health.active') : t('health.inactive')) : t('health.summary.unknown')}
                />
              }
            />
            <Row
              icon="monitor"
              title={t('health.computerControl')}
              subtitle={cuDotLabel}
              trailing={<StatusDot tone={cuDotTone} label={cuDotLabel} />}
            />
          </>
        )}
      </Section>

      <Section label={t('health.cloudBrowser')}>
        {CLOUD_BROWSERS.map(browser => {
          const isSet = env?.[browser.key]?.is_set === true
          return (
            <Row
              key={browser.key}
              icon="folder"
              tint="accent"
              title={t(browser.titleKey)}
              trailing={<StatusDot tone={isSet ? 'ok' : 'neutral'} ariaLabel={isSet ? t('health.configured') : t('health.notConfigured')} />}
              chevron
              onClick={() => forward(vaultUrl(browser.key))}
            />
          )
        })}
      </Section>

      {remediations.length > 0 && (
        <Section label={t('health.fixes')}>
          {remediations.map(remediation => (
            <RemediationCard
              key={remediation.id}
              remediation={remediation}
              onRepair={r => void runRepair(profile, r)}
              onOpenVault={key => forward(vaultUrl(key))}
            />
          ))}
        </Section>
      )}
    </PageShell>
  )
}

/** Chips with every bot; the selected one is the diagnosed profile. */
function BotPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const rows = useStore(homeProfiles)
  return (
    <div className="chips-scroll" style={{ marginBottom: 'var(--space-3)' }}>
      {rows.map(row => (
        <PickerChip
          key={row.name}
          name={row.name}
          row={row}
          active={row.name === value}
          onClick={() => {
            if (row.name !== value) {
              onChange(row.name)
              switchHealthProfile(row.name)
            }
          }}
        />
      ))}
    </div>
  )
}

function PickerChip({
  name,
  row,
  active,
  onClick,
}: {
  name: string
  row: ProfileRow | undefined
  active: boolean
  onClick: () => void
}) {
  const appearance = useBotAppearance(name)
  return (
    <button
      type="button"
      className={`chip health-bot-chip${active ? ' chip-active' : ''}`}
      onClick={onClick}
    >
      <Avatar name={name} size={20} appearance={appearance} />
      {botDisplayName(row, name)}
    </button>
  )
}
