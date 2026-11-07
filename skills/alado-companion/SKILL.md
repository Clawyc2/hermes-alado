---
name: alado-companion
description: "You are talked to from Alado, a phone app — not Hermes Desktop, and the user has no terminal. Read before you use the computer/browser, ask the user to log in, solve a captcha or 2FA, tell them how to watch or take over your screen, set up a CLI/API login (OAuth, API keys, tokens), or would ask them to run any command."
---

# Alado companion

The person talking to you uses **Alado**, a light mobile app (PWA) for Hermes, usually on a phone,
often on the move. They do **not** have Hermes Desktop open. Never send them to Hermes Desktop menus
("Bots → Screen → Take over", "Hand back", sidebars, panels): those don't exist for them.

**Language rule:** every UI label you mention must match the language the user writes in. Alado is
localized English/Spanish. Use the **English** set when they write in English, the **Spanish** set
when they write in Spanish:

| English | Español |
| ------- | ------- |
| my profile | mi perfil |
| Computer | Computadora |
| Watch | Ver |
| Take control | Tomar el control |
| Hand back | Devolver |

Example English: "open my profile → Computer → Watch → Take control → Hand back".
Example Spanish: "entrá a mi perfil → Computadora → Ver → Tomar el control → Devolver".

## Your computer

You have your own virtual computer (the Hermes Bot Desktop): an Xfce desktop with a browser whose
profile is **persistent** — cookies and logged-in sessions survive restarts. Once the user logs in
somewhere on it, you can keep using that session later. Use `computer_use` / the browser tools on it.

The user can see and drive that same screen from their phone:

1. In Alado, open **your** bot profile — tell them "my profile" / "mi perfil" (they tap your avatar or
   name in the chat header) → **Computer** / **Computadora**.
2. **Watch** / **Ver** opens your live screen (view only).
3. **Take control** / **Tomar el control** gives them mouse and keyboard; a keyboard button opens the
   phone keyboard.
4. **Hand back** / **Devolver** hands control back to you.

While they hold control, every computer action you try returns `human_has_control`. That is
expected: do not retry in a loop. Tell them you are waiting, and continue once they say they are done
(or when an action stops returning `human_has_control`).

## Logins: use the secure form first

For a login, prefer `browser_vault`: open the site's login page, then call
`browser_vault action=list`; if nothing is saved for that site, call `action=save_login`. Alado shows
the user a secure form on their phone (user + masked password); the vault fills the page and you never
see the password. Use `action=enter_code` when the site asks for a 2FA / one-time code — the user gets
a code form the same way. Only if that fails (the form is unusual, a captcha appears, the user
prefers it) fall back to letting them take control of the screen.

## Commands: you run them, never the user

The user has **no terminal** — they are on their phone, not at the server. Never answer with "run
this on the host / in a terminal / over SSH". Every command is yours to run with the `terminal` tool,
including setup and logins of command-line tools (`gh auth`, `xurl auth`, `gcloud auth`, …).

**Never ask for a sudo password.** You run as an unprivileged user with no sudo rights, so a sudo
prompt can only fail. Install tools with Hermes' own manager, no root needed: `hermes pm install
<name>` (e.g. `gh`; `hermes pm doctor` lists what it offers), or a user-level install (`pip install
--user`, `npm` prefix in your home). If something truly needs root (an apt package, a system
service), say so in one line: the server admin has to install it.

**Commands that wait for an answer** (an OAuth flow that prints a URL and waits for the redirect, a
`[y/N]` prompt, a code to paste):

1. Start it in the background: `terminal` with `background=true` **and `persist_on_release=true`**
   (and `pty=true` if it needs a real terminal). Prefer the tool's headless / device-code /
   no-browser mode. `persist_on_release` matters: to authorize, the user leaves Alado for the
   browser, the app disconnects, and without it Hermes kills your process when the session idles.
2. Read its output with `process_manage action=poll` (or `log`) until it prints the URL or the question.
3. Send the user the URL or the question in one short message, saying exactly what to paste back.
4. When they answer in the chat, pass it with `process_manage action=submit` (`data` = their answer,
   `session_id` = the process id), then `poll` until it finishes and tell them the result. Lost the
   process id (new turn, resumed chat)? `process_manage action=list` shows it.

An OAuth redirect URL (`…?code=…`) or a device code is fine in the chat: it works once and expires in
minutes. If the process ended while you waited, start it again and send the new URL. If the user
gives up, stop it with `process_manage action=kill`.

`process_manage` may be a deferred tool. Call it through `tool_call` with exactly this shape — the
name and its arguments in the **same** object:

```
tool_call {"calls":[{"name":"process_manage","arguments":{"action":"submit","session_id":"proc_…","data":"<their answer>"}}]}
```

**Secrets** (client secrets, API keys, tokens, passwords) never go through the chat. Ask for them
with the secure form — but **only when the user already has the values at hand**. Each field waits
about 2 minutes and you are blocked while it waits; if the user has to leave the app to fetch the
value (another site, another app), the form expires meanwhile. So first tell them where to find the
values and ask them to reply "ready" / "listo" once they have them copied; open the form only after
that reply. Ask only for what is truly secret (a client ID or username can go in the chat).

Then:

1. Create a small skill of your own with `skill_manage action=create` (e.g. `x-api-setup`) whose
   frontmatter declares the variables:

   ```yaml
   required_environment_variables:
     - name: X_CLIENT_SECRET
       prompt: "Client secret of your X app"
       help: "https://developer.x.com/en/portal/dashboard"
   ```

2. Load it with `skill_view`. Alado shows the user a secure masked form for each missing variable;
   the value is saved to your `.env` and you never see it.
3. Use it in commands as `"$X_CLIENT_SECRET"`; never echo or print it. Non-secret values (a client
   ID, a username) can simply be asked in the chat.

If the user skips the form, the variable stays missing: tell them, and offer to ask again.

## When to hand over

Ask the user to take control — instead of guessing or asking for secrets in chat — for:
- captchas, "are you human" checks, or a login the secure form could not complete;
- payments or anything that needs their explicit, personal action;
- a page you are stuck on after two honest attempts.

Before asking: open the exact page they need, so they land right on it. Then verify the page
actually rendered a login form (read the page text for real form fields, not an error page). Some
bot-protected sites serve a generic error to the bot's datacenter IP even on their home page; taking
control won't bypass that, because the user drives the same browser and IP. If the page errors, say
so upfront instead of handing over. Otherwise say it in one short
message, in their language, for example:

> Te dejé abierta la página de login de LinkedIn. Entrá a mi perfil → Computadora → Ver → Tomar el
> control, iniciá sesión y tocá Devolver. La sesión queda guardada para la próxima.

In English: "I left the LinkedIn login page open for you. Open my profile → Computer → Watch → Take
control, sign in and tap Hand back. The session stays saved for next time."

Never ask the user to paste passwords, codes or card numbers into the chat.

## Phone-friendly replies

- Short first: the answer or result in one or two sentences, details after only if useful.
- No wide tables or long code blocks unless they ask; prefer short lists.
- If a task will take a while, say so and work; the app notifies them when you finish or need them.
