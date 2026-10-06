# Voice Clone Studio · 声音克隆工作台

A public self-serve web app wrapping the ElevenLabs API:

1. **Voice cloning** — upload audio samples → Instant Voice Cloning → get a `voice_id`
2. **Text-to-speech** — type text, pick a voice, tune settings → MP3

Built with Next.js 14 (App Router) + TypeScript. No Tailwind — styling is a single
CSS module (`app/page.module.css`).

## The key never reaches the browser

All ElevenLabs calls happen in server API routes that read
`process.env.ELEVENLABS_API_KEY`:

- `app/api/status/route.ts` — GET → `{ ok, keyConfigured, passwordProtected }`
  (reports only whether the key exists, never the key itself)
- `app/api/clone/route.ts` — POST multipart (`name`, `files…`,
  `remove_background_noise`, `labels`) → forwards to
  `POST https://api.elevenlabs.io/v1/voices/add` → `{ voice_id, requires_verification }`
- `app/api/speak/route.ts` — POST JSON
  `{ voice_id, text, model_id?, voice_settings? }` → returns `audio/mpeg` bytes

The frontend only ever talks to `/api/*` on this same server.

## Environment variables

| Var | Required | Description |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | yes | ElevenLabs API key (server-side only). Without it, `/api/clone` and `/api/speak` return 500 and the UI shows a setup banner. |
| `SITE_PASSWORD` | no | Optional password gate. When set, `/api/clone` and `/api/speak` require the request header `x-site-password` to match, else 401. `/api/status` stays open so the UI can discover the gate. |

Local dev: copy `.env.example` to `.env` and fill in.
Vercel: Project → Settings → Environment Variables, then redeploy.

## Audio size handling (why the client compresses)

Vercel serverless functions accept request bodies up to ~4.5MB. Voice-clone
samples are often larger than that, so the browser pre-processes before upload:

- Any selected file **over 3.5MB** is decoded with `AudioContext`,
  downmixed to **mono**, and re-encoded to **64kbps MP3** with `lamejs`
  (all client-side — the UI shows an "Optimizing audio…" state and tags
  affected files with 「将自动压缩」).
- Files under 3.5MB are uploaded unchanged.

A 6-minute stereo interview (~15MB) typically shrinks to ~3MB as mono 64kbps
MP3 — still plenty of fidelity for voice cloning, and safely under the limit.

## Password gate

Set `SITE_PASSWORD` to put the tool behind a shared password without any
login system. The UI shows a password field at the top (stored in
`sessionStorage`, sent as the `x-site-password` header on API calls).
Leave it unset for a fully open public tool.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```
