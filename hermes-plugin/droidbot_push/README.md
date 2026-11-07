# droidbot-push — Web Push for Alado

A Hermes plugin that sends push notifications to your phone when a bot:

1. **Finishes a turn** (`on_session_end`, cron included),
2. **Waits for you** for an approval / clarification / sudo
   (`pre_approval_request` + `on_human_input_request`),
3. **A group waits for you** (`on_room_member_activity` with `kind=request.opened`).

Per-bot toggles ("When it finishes" / "When it needs you") live in the PWA, GrokBot-style.
Tapping a notification opens `/chat/<profile>` or `/group/<room>`.

## Installation

```bash
# 1. Copy the plugin into the user-plugins folder
mkdir -p ~/.hermes/plugins
# The folder name must be the plugin key, or Hermes never installs pywebpush
cp -r droidbot_push ~/.hermes/plugins/droidbot-push

# 2. Enable it. Hermes' admission resolves pywebpush via the PM;
#    if it asks for dependencies: hermes pm install (interactive consent).
hermes plugins enable droidbot-push

# 3. Restart Hermes
#    hermes serve   (web)   and/or   hermes gateway run   (messaging)
```

Alternative from a git repo (non-interactive install with explicit dependency consent):

```bash
hermes plugins install <git-url> --yes-deps --enable
```

The hooks run in whichever process executes the turn (serve and gateway), so the plugin must
be enabled in both. Subscriptions, dedupe and preferences live in SQLite
(`plugin-data/droidbot_push/data.db`, WAL) and are shared across processes; the VAPID key is
generated once and kept in the plugin state (`plugin-data/.../state.json`).

The provisioner (`provisioner/prepare.sh`, module `push`) automates all of the above.

## API (mounted by the dashboard under `/api/plugins/droidbot-push/`)

| Method | Route               | Body / Query                               | Response                     |
| ------ | ------------------- | ------------------------------------------ | ----------------------------- |
| GET    | `/vapid-public-key` | —                                          | `{ "key": "<base64url>" }`    |
| POST   | `/subscribe`        | `{ endpoint, p256dh, auth, device_id?, device_label? }` | `{ "ok": true }` |
| DELETE | `/subscribe`        | `{ endpoint?, device_id? }`                | `{ "ok": true, "removed": n }` |
| GET    | `/prefs`            | —                                          | `{ "prefs": { "<profile>": { "termina": bool, "necesita": bool } } }` |
| PUT    | `/prefs`            | `{ profile, termina?, necesita? }`         | `{ "prefs": { "<profile>": ... } }` |
| POST   | `/test`             | `{ device_id? }`                           | `{ "sent": n }`               |

Dashboard session auth is inherited automatically (same session cookie).

## Optional configuration (`plugins.entries.droidbot-push.settings`)

- `subject` — VAPID claim (`mailto:` or `https:`). Default: `mailto:admin@alado.local`.
- `rate_limit_seconds` — minimum seconds between pushes per profile. Default: `30`.

## Tests

```bash
python -m pytest tests/ -q
```
