# ModemDeck

Local-first web console for USB AT-command modems: SMS, USSD, call log, phonebook, network & dial-up data — private, self-hosted, localhost-only. Windows is the only supported OS.

Live compatibility is intentionally limited to the connected device and is never inferred from internet data.

## Features

- **SMS** — receive live (GSM-7 + Unicode/Bangla, multipart reassembly, locally archived), send, delete, modem sync/purge
- **USSD** — interactive sessions with cancel and reply
- **Calls** — incoming-call log with caller ID
- **Phonebook** — read/write contacts (SIM & modem storage, UCS2 names)
- **Network** — signal, operator, registration (CS/PS/EPS), IMEI, firmware, APN
- **Dial-up data** — toggle the Windows dial-up profile, connect/disconnect from the UI
- **Call forwarding** — view/set forwarding rules
- **Raw AT console** — guarded interactive console
- **Diagnostics** — modem capability probes, compatibility evidence, health/readiness endpoints

> **Not possible on this hardware:** placing or answering calls with audio (no USB audio interface on the modem).

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

**Mobile data:** create a Windows dial-up connection once (Settings → Network → Dial-up, number `*99#`, using the modem), then set its name in `dialup`. Tip: pin the app to the Diagnostics/AT port (e.g. COM3) so it keeps working while the data connection holds the modem's data port.

## Configuration

Everything can be inspected and hot-reloaded from the **Capabilities → Runtime configuration** panel (port, baud, dial-up profile, modem profile, trace capture), or set via `config.json` / environment variables.

| Key                          | Env override                                       | Notes                                |
| ---------------------------- | -------------------------------------------------- | ------------------------------------ |
| `port`                       | `MODEMDECK_PORT`                                   | Serial port (empty = auto-detect)    |
| `http`                       | `PORT`                                             | HTTP port (default 3000)             |
| `baud`                       | `MODEMDECK_BAUD`                                   | Serial baud (default 115200)         |
| `dialup`                     | `DIALUP`                                           | Windows dial-up profile name         |
| `authToken`                  | `MODEMDECK_AUTH_TOKEN`                             | Require `Authorization: Bearer …`    |
| `dataPath`                   | `MODEMDECK_DATA_PATH`                              | SQLite path                          |
| `retentionDays`              | `MODEMDECK_RETENTION_DAYS`                         | Default 90                           |
| `persistSensitive`           | `MODEMDECK_PERSIST_SENSITIVE`                      | Redact SMS bodies if false (default) |
| `profile`                    | `MODEMDECK_PROFILE`                                | Modem profile id                     |
| `captureRaw` / `capturePath` | `MODEMDECK_CAPTURE_RAW` / `MODEMDECK_CAPTURE_PATH` | Raw serial trace capture             |
| `logPayloads`                | `MODEMDECK_LOG_PAYLOADS`                           | Interaction payload logging          |

Restart-only settings: `http`, `authToken`, `dataPath`, `retentionDays`, `persistSensitive`, `logPayloads`.

## Security & responsibility

- Binds to `127.0.0.1` only, validates the `Host` header, and requires JSON POST bodies (blocks cross-site requests). Rate-limited per client. SMS contain OTPs — **never expose this server to a network**.
- Set `MODEMDECK_AUTH_TOKEN` to enforce Bearer auth on every endpoint, including `/health` and `/ready`. Without a token, localhost binding + Host validation is the security boundary.
- Sensitive text is redacted in SQLite unless `MODEMDECK_PERSIST_SENSITIVE=true`. Detailed interaction logs (correlation IDs, command/response) are recorded; payload logging is opt-in.
- The UI shows a **non-blocking** notice that this is a personal, local tool for lawful use. Acknowledging is never enforced — you are solely responsible for using it lawfully and ethically.

## Architecture

The TypeScript source is layered so hardware and HTTP concerns stay at the edges:

- `src/domain` — modem entities, protocol/value logic, SMS codec, dependency-free ports
- `src/application` — use-case services (SMS sending, serial discovery, dial-up selection)
- `src/infrastructure` — serial transport, AT command queue, SQLite persistence, configuration, modem lifecycle, Windows RAS/provider integration
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

- **No modem detected**: verify the COM port in Device Manager, close any competing serial client, and check the modem is not in use by the Windows dial-up connection. The app retries discovery after a failed probe or unplug; reconnect the device and wait for the status to update. You can choose a detected port in Capabilities → Runtime configuration or pin `port` in `config.json`.
- **Phonebook names look wrong**: most modems use UCS2; if yours differs, please open an issue with the output of `AT+CPBR=?`.
- **Data toggle fails**: ensure the dial-up profile name matches exactly and the modem is attached to that profile (see README's dial-up tip above).

## License

MIT — see [LICENSE](LICENSE).
