# ModemDeck

Local-first web console for USB AT-command modems: SMS, USSD, call log, phonebook, network & dial-up data — private, self-hosted, localhost-only. Runs on any OS with a serial-capable port; CI verifies on Windows.

## Features

- **SMS** — receive live (GSM-7 + Unicode/Bangla, multipart reassembly, locally archived), send, delete, modem sync/purge
- **USSD** — interactive sessions with cancel and reply
- **Calls** — incoming-call log with caller ID
- **Phonebook** — read/write contacts (SIM & modem storage, UCS2 names)
- **Network** — signal, operator, registration (CS/PS/EPS), IMEI, firmware, APN
- **Dial-up data** — toggle the OS dial-up profile, connect/disconnect from the UI
- **Call forwarding** — view/set forwarding rules
- **Raw AT console** — guarded interactive console
- **Diagnostics** — modem capability probes, compatibility evidence, health/readiness endpoints

## Quickstart

```bash
npm install
npm run build:all   # compile backend (tsc) + bundle frontend (vite) into public/
npm start           # http://localhost:3000
```

The modem is auto-detected across available serial ports with bounded probing. To pin a port or enable the data toggle, create `config.json`:

```json
{ "port": "COM3", "http": 3000, "dialup": "My Dial-up Entry" }
```

**Mobile data:** create the OS dial-up connection for your modem once (number `*99#`), then set its name in `dialup`. Tip: pin the app to the Diagnostics/AT port so it keeps working while the data connection holds the modem's data port.

## Configuration

Everything can be inspected and hot-reloaded from the **Capabilities → Runtime configuration** panel (port, baud, dial-up profile, modem profile, trace capture), or set via `config.json` / environment variables.

| Key                          | Env override                                       | Notes                                                      |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `port`                       | `MODEMDECK_PORT`                                   | Serial port (empty = auto-detect)                          |
| `http`                       | `PORT`                                             | HTTP port (default 3000)                                   |
| `baud`                       | `MODEMDECK_BAUD`                                   | Serial baud (default 115200)                               |
| `dialup`                     | `DIALUP`                                           | OS dial-up profile name                                    |
| `authToken`                  | `MODEMDECK_AUTH_TOKEN`                             | Require `Authorization: Bearer …`                          |
| `dataPath`                   | `MODEMDECK_DATA_PATH`                              | SQLite path                                                |
| `retentionDays`              | `MODEMDECK_RETENTION_DAYS`                         | Default 90                                                 |
| `persistSensitive`           | `MODEMDECK_PERSIST_SENSITIVE`                      | Redact SMS bodies if false (default)                       |
| `profile`                    | `MODEMDECK_PROFILE`                                | Modem profile id                                           |
| `captureRaw` / `capturePath` | `MODEMDECK_CAPTURE_RAW` / `MODEMDECK_CAPTURE_PATH` | Raw serial trace capture                                   |
| `logPayloads`                | `MODEMDECK_LOG_PAYLOADS`                           | Interaction payload logging                                |
| `lockMinutes`                | `MODEMDECK_LOCK_MINUTES`                           | Auto-lock idle minutes, 0 disables (default 15)            |
| `sessionMaxMinutes`          | `MODEMDECK_SESSION_MAX_MINUTES`                    | Session lifetime minutes, 0 disables (default 480)         |
| —                            | `MODEMDECK_SETUP_SKIP_VERIFY`                      | Testing only: skip setup OTP proof (never set in real use) |

Restart-only settings: `http`, `authToken`, `dataPath`, `retentionDays`, `persistSensitive`, `logPayloads`.

## Compatibility

| OS / CI platform                                                                                                                | Modem model | Firmware | SMS | USSD | Phonebook | Forwarding | Data dial-up | Call audio | Notes |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | --- | ---- | --------- | ---------- | ------------ | ---------- | ----- |
| _No physical modem tested on CI yet — populate from `npm run hardware:test -- COM3` output and `npm run compatibility:report`._ |             |          |     |      |           |            |              |            |       |

Until a real device is added, we only confirm what the AT probe can observe; the UI reports only live evidence.

## Security & responsibility

- Binds to `127.0.0.1` only, validates the `Host` header, and requires JSON POST bodies (blocks cross-site requests). Rate-limited per client. SMS contain OTPs — **never expose this server to a network**.
- Set `MODEMDECK_AUTH_TOKEN` to enforce Bearer auth on every endpoint, including `/health` and `/ready`. Without a token, localhost binding + Host validation is the security boundary.
- Sensitive text is redacted in SQLite unless `MODEMDECK_PERSIST_SENSITIVE=true`. Detailed interaction logs (correlation IDs, command/response) are recorded; payload logging is opt-in.
- The UI shows a **non-blocking** notice that this is a personal, local tool for lawful use. Acknowledging is never enforced — you are solely responsible for using it lawfully and ethically.
- At rest, every record (SMS/call/USSD text, audit detail, parts) is AES-256-GCM encrypted with a key derived from your profile credential (scrypt). Nothing plaintext is written to SQLite.
- A profile (name and SIM label) is created on first run with a credential. Onboarding also requires a trusted recovery number, proven by an SMS OTP sent from the connected modem (`POST /api/auth/setup/request` → `POST /api/auth/setup/verify`, 10-min expiry, 5-attempt cap) before the profile is created. Every protected endpoint requires an unlocked session; while locked they all return 423.
- Sessions are first-class and SQLite-backed: every setup, login and recovery mints a session row (id, SIM binding, timestamps, origin) in the `sessions` table, and the browser carries it as an `HttpOnly` cookie (or `X-Session-Id` header for API clients). Requests are authenticated only with a live session — idle sessions lapse after `lockMinutes`, sessions expire after `sessionMaxMinutes`, SIM changes revoke everything, and decrypted state is wiped as soon as the last live session goes away. `POST /api/auth/lock` ends all sessions at once; `POST /api/auth/logout` ends one. Session rows hold metadata only — the data key is never written to disk, so a restart still forces re-authentication.
- Signature settings for the sign-out flow: a manual **Lock** button in the top bar, plus auto-lock after inactivity (`MODEMDECK_LOCK_MINUTES`, `config.json` `lockMinutes`, 0 disables, default 15) and session expiry (`sessionMaxMinutes`, default 480). Both immediately wipe decrypted in-memory state and force re-authentication through the detached LockScreen.
- Live presence and carrier watch: the modem gets a bare-`AT` heartbeat every 10s (silent drops fail over to reconnect immediately, no OS event needed), the SIM identity is re-verified every ~30s, and signal/registration/operator changes stream over `/events` as `carrier` events shown in the top bar. Port moves (USB re-enumeration) emit `port` events, are audit-logged, and the last connected port is retained for diagnostics.
- Forgotten credential recovery: two methods. (a) Recovery phrase — a random 16-byte hex phrase generated at setup; presenting it with a new credential re-wraps the at-rest data key, so all existing encrypted history is fully preserved. (b) OTP — onboarding also stores a trusted recovery number; `POST /api/auth/recover/request` SMSes a one-time OTP (10-min expiry, 5-attempt cap) from the connected modem. The OTP itself is held only in server memory (never written to disk); `POST /api/auth/recover/verify` with the OTP resets the credential and permanently wipes the previous encrypted archive.

## Architecture

The TypeScript source is layered so hardware and HTTP concerns stay at the edges:

- `src/domain` — modem entities, protocol/value logic, SMS codec, dependency-free ports
- `src/application` — use-case services (SMS sending, serial discovery, dial-up selection)
- `src/infrastructure` — serial transport, AT command queue, SQLite persistence, configuration, modem lifecycle, OS dial-up / provider integration
- `src/interfaces/http` — routing, HTTP adapter, SSE hub
- `src/bootstrap` — composition root and runtime wiring (`server.ts` is a thin entrypoint)
- `frontend/` — Svelte 5 + Vite UI, Catppuccin Mocha/Latte theme with Blue accents

Adapters implement domain ports; the domain never imports `serialport`, Node HTTP, or infrastructure modules (enforced by an architecture test). SQLite is the only persistence layer.

## API

`GET /health` · `GET /ready` · `GET /api/state` · `GET /api/capabilities` · `GET /api/compatibility` · `GET /api/config` / `POST /api/config` · `GET /api/ports` · `POST /api/sms` / `POST /api/sms/delete` · `POST /api/sync` · `POST /api/purge` · `POST /api/ussd` · `POST /api/ussd/cancel` · `GET /api/network` · `GET/POST /api/phonebook` · `GET/POST /api/forwarding` · `GET /api/data` / `POST /api/data` · `POST /api/apn` · `POST /api/at` · `GET /events` (SSE)

Unsupported modem features surface explicit errors rather than guesses; `GET /api/capabilities` reflects live probe evidence only.

## Development

```bash
npm run dev:ui          # Vite dev server (proxies /api + /events to :3000)
npm run lint            # eslint
npm run format          # prettier --write
npm run test            # build + node --test dist/test
npm run test:ui         # vitest (frontend)
npm run test:e2e        # playwright
```

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, build, backend & frontend tests on Node 20/22, plus a Playwright smoke job.

Utilities: `npm run capture:trace -- COM3` records real serial traffic to NDJSON · `npm run compatibility:report` reports observed command evidence from SQLite · `npm run hardware:test -- COM3` runs live hardware checks (skips cleanly with no port).

## Troubleshooting

- **No modem detected**: check the modem port in your OS device manager, close any competing serial client, and check the modem is not in use by the OS dial-up connection. The app retries discovery after a failed probe or unplug; reconnect the device and wait for the status to update. You can choose a detected port in Capabilities → Runtime configuration or pin `port` in `config.json`.
- **Phonebook names look wrong**: most modems use UCS2; if yours differs, please open an issue with the output of `AT+CPBR=?`.
- **Data toggle fails**: ensure the dial-up profile name matches exactly and the modem is attached to that profile (see README's dial-up tip above).

## License

MIT — see [LICENSE](LICENSE).
