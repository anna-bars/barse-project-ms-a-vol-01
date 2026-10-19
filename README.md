# Ms A Voice Character — Rive demo and docs

Next.js app with a live preview of `public/ms_a.riv` (state machine `Ms A Controller`) and integration docs.

- Inputs: `BodyState` (0 Idle, 1 Thinking, 2 Talking), `EyebrowState` (0–200), `LookX` / `LookY` (0–100, center 50), `MouthViseme` (0–14), triggers `Acknowledge` and `Blink`
- Audio clips: `public/audio/02.mp3` … `10.mp3`, played with buttons; the mouth follows the sound live

```
npm install
npm run dev
```

Rendering uses `@rive-app/react-webgl2` (the Rive renderer) so effects like Feather are drawn. The Canvas renderer does not support feathering.

## Rive file from a private Supabase bucket

`ms_a.riv` is not in `/public`. It sits in the **private** bucket `rive-assets` and is served by `app/api/rive/route.js`, which reads it with a server-side secret key.

1. Keep the bucket private.
2. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (see `.env.local.example`) locally in `.env.local` and in Vercel env vars. Never use the `NEXT_PUBLIC_` prefix for the secret key.
3. `npm install`, then redeploy. Replacing the file in Supabase takes effect immediately (no caching).

The route refuses direct address-bar opens and requests from other websites. It cannot stop a determined user from copying the file from the browser's network tab: anything the browser needs to run, it can save.
