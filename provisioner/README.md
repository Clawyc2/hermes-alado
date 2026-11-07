# Provisioner — Alado (phase 7b/7c)

Prepares an Ubuntu/Debian VPS so the Alado PWA works against Hermes: system libraries for the
bundled Chromium, the packages Hermes' official Bot Desktop needs (one Xfce desktop per bot
profile), HTTPS access with or without your own domain (Caddy site with a Let's Encrypt
certificate, sslip.io, or Tailscale), PWA cache headers in Caddy, atomic PWA deploys (from the
GitHub release by default), the `droidbot-push` Hermes plugin (web push to the phone), and the
`alado-companion` skill (teaches every bot it is talked to from Alado, not Hermes Desktop).
Idempotent, with `--check` diagnostics and a `--dry-run` rehearsal.

## One-line usage

```bash
# clone the repo and run everything (the PWA comes from the latest GitHub release):
git clone https://github.com/gabogabucho/hermes-alado && cd hermes-alado
sudo bash provisioner/prepare.sh --all --domain your.domain
```

Or piped straight from the repo without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/gabogabucho/hermes-alado/main/provisioner/prepare.sh | sudo bash -s -- --all --domain your.domain
```

With an explicit PWA dist:

```bash
sudo bash prepare.sh --all --domain your.domain --dist ./alado-pwa.tar.gz
```

Without your own domain:

```bash
sudo bash prepare.sh --all --access sslip      # https://<public-ip>.sslip.io via Caddy
sudo bash prepare.sh --all --access tailscale  # https://<machine>.<tailnet>.ts.net
```

With push notifications (uses the plugin source from the repo):

```bash
sudo bash prepare.sh push                                 # uses hermes-plugin/droidbot_push next to the script
sudo bash prepare.sh push --plugin-src ./hermes-plugin/droidbot_push
```

With the alado-companion skill (every bot learns it is talked to from Alado):

```bash
sudo bash prepare.sh companion              # uses skills/ next to the script
sudo bash prepare.sh companion --skills-src ./skills
```

## Diagnostics

```bash
sudo bash prepare.sh --check            # exit 0 = OK, 1 = problems
sudo bash prepare.sh --check --json     # output for the PWA "Health" screen
sudo bash prepare.sh --dry-run --all    # prints the commands without running anything
```

## Modules

| Module     | What it does |
|------------|--------------|
| `browser`  | Installs the system libraries Hermes' bundled Chromium needs (list derived from `playwright install-deps chromium` for Ubuntu 24.04/22.04 and Debian 13/12) and verifies with `ldd` (0 "not found") + a headless `--dump-dom` run as the Hermes user. |
| `botdesktop` | Installs exactly the packages Hermes' official Bot Desktop requires (`tools/bot_desktop/runtime.py` `PACKAGES["apt"]`: TigerVNC Xvnc + Xfce) and verifies every `REQUIRED_BINARIES` entry is on PATH. Runs the idempotent `cleanup-legacy` step (v1 `droidbot-display/vnc/novnc` units, `/etc/hermes/droidbot-*`, the xauthority cookie, DISPLAY drop-ins, the Caddy `/desktop/*` route) and prints the restart command. Hermes starts the desktops itself, one per profile, via `display.start` — this module only provisions the host. |
| `access`   | HTTPS access. `--domain <host>` ensures a working Caddy site for the domain: on a fresh server it creates the full self-contained site block (PWA root + reverse proxy `/api/* /auth/* /login*` → Hermes) and even the Caddyfile itself when Caddy has never been configured — a pre-existing site for the domain is never reshaped. It also ensures `dashboard.public_url` via `hermes config set` and warns when dashboard auth is missing. `--access sslip` (default without `--domain`) derives `<public-ip>.sslip.io`, creates the Caddy site, lets Caddy obtain the cert, and adds the host to Hermes' trusted public hosts. `--access tailscale` runs `tailscale serve --bg --yes --https=443` and prints the `ts.net` URL (install steps when tailscale is missing). Interactive prompt when stdin is a TTY; flags otherwise. Ends with a big "Open this on your phone" line. |
| `caddy`    | Marked cache-header block for the PWA: `no-cache` for `/sw.js /registerSW.js /index.html /manifest.webmanifest /workbox-*.js`, `immutable` for `/assets/*`. Backs up the Caddyfile and validates before reloading. Access-generated sites (sslip/tailscale/domain) already carry the headers inline, so the module only verifies them. |
| `pwa`      | Installs/updates the Alado PWA at `/var/www/droidbot`. Without `--dist` it downloads the latest GitHub release (`alado-pwa.tar.gz`) and verifies it against the published `alado-pwa.tar.gz.sha256` when that file can be fetched; `--dist <path\|url.tar.gz>` uses an explicit tarball. Atomic swap (the previous version stays in `droidbot.prev`) + a sha256 marker that skips identical redeploys. `droidbot` is accepted as a legacy alias. |
| `push`     | Installs the `droidbot-push` Hermes plugin (web push to the phone when a bot finishes a turn or waits for you): copies `--plugin-src` (default `hermes-plugin/droidbot_push` next to the script) into `~/.hermes/plugins/droidbot-push` (folder = plugin key), runs `hermes plugins enable droidbot-push` as the hermes user — Hermes' admission installs `pywebpush>=2,<3` into its runtime environment — and verifies `GET /api/plugins/droidbot-push/vapid-public-key` → 401 unauthenticated (route mounted). Prints the Hermes restart command — it never restarts Hermes itself. Until the plugin is published on GitHub this folder copy is the install path (then: `hermes plugins install <git-url> --yes-deps --enable`). |
| `companion` | Installs the `alado-companion` skill for every bot profile so they stop pointing users at Hermes Desktop menus that don't exist in Alado: copies `--skills-src/alado-companion` (default `skills/` next to the script) to `~/.hermes/alado-skills/` (hermes-owned), MERGES `~/.hermes/alado-skills` into each profile's `skills.external_dirs` via `hermes -p <profile> config get/set` (existing entries are never dropped), sets the TOP-LEVEL config key `platform_hints.tui.replace` per profile from the skill's `platform-hint.txt` with `hermes -p <profile> config set --force` (as the hermes user, never under `agent:`), and removes the legacy marked `<!-- alado:begin/end -->` block from each profile's `SOUL.md` (`~/.hermes/SOUL.md` for the default profile, `~/.hermes/profiles/<name>/SOUL.md` otherwise) — cleanup only, it is never added again; text outside the markers is never touched. `--check` reports ok/missing per profile. |

## Flags

```
--check               Diagnostics only (changes nothing). Exit 0/1.
--json                Emit the diagnostics as JSON (requires --check).
--all                 Apply all modules.
--dry-run             Print the commands it would run.
--hermes-user <user>  Owner of ~/.hermes (default: auto-detection, fallback 'hermes').
--domain <host>       Public domain (access/caddy site blocks + verifications).
--access <mode>       HTTPS without your own domain: 'sslip' or 'tailscale'.
--dist <path|url>     PWA tar.gz for the pwa module. Default: the latest GitHub release.
--plugin-src <path>   droidbot-push plugin source folder for the push module
                      (default: hermes-plugin/droidbot_push next to the script).
--skills-src <path>   alado-companion skill source folder for the companion module
                      (default: skills/ next to the script).
```

## Documentation

Full detail (system changes, `--check --json` schema, idempotency, risks) is in
[`docs/provisioner.md`](../docs/provisioner.md).
