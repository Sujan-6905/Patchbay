# Deployment guide

Three paths to a public, HTTPS URL for Patchbay, all work for free.

## Why WebRTC requires HTTPS

Three separate requirements all point the same way:

- **`getUserMedia`/`getDisplayMedia` are secure-context APIs.** Browsers refuse to grant
  camera/mic/screen access on a plain `http://` origin, with the sole exception of
  `http://localhost`, which browsers treat as secure for local development. Anything served
  to a real domain over plain HTTP simply cannot request media.
- **Signaling needs WSS, not WS.** Socket.IO falls back to HTTP long-polling if a WebSocket
  upgrade fails, but a mixed-content page (HTTPS page, `ws://` signaling) is blocked outright
  by the browser; the signaling transport's scheme has to match the page's.
- **The browsers on a call are almost never on the same network**, so there's no shortcut like
  a self-signed cert accepted once locally: the cert has to be one every visitor's browser
  already trusts.

Every path below gets a browser-trusted cert without Patchbay's own code ever touching
certificates; `server/src/index.ts` only ever speaks plain HTTP, TLS is terminated in front
of it.

## Path A: Vercel (frontend) + Render (backend), recommended

This is what `vercel.json` and `render.yaml` in this repo target together. Splitting the two
means the frontend is served instantly from Vercel's edge network, and only the parts that
actually need a stateful server (signaling, TURN config, AI summaries) pay Render's free-tier
cold-start cost; see [Cold starts](#cold-starts-and-how-the-frontend-hides-them) below for how
the client hides that cost from visitors.

1. Push this repo to GitHub (if you haven't already).
2. **Deploy the backend on Render first**, so you have its URL before configuring the frontend.
   In the [Render dashboard](https://dashboard.render.com), **New → Blueprint**, point it at the
   repo. Render reads `render.yaml` and provisions the `patchbay` web service on the free plan,
   building from `Dockerfile`. Note the assigned URL (`https://<name>.onrender.com`); the
   backend doesn't need `CORS_ORIGIN` set correctly yet, that comes after step 3.
3. **Deploy the frontend on Vercel.** In the [Vercel dashboard](https://vercel.com/new), import
   the same repo; the root `vercel.json` tells Vercel how to build the `client` workspace (and
   its `shared` dependency) without any manual project configuration. Before the first deploy,
   set one environment variable:
   - `VITE_API_BASE_URL` = the Render URL from step 2 (e.g. `https://patchbay-api.onrender.com`,
     no trailing slash).
4. Once Vercel assigns its URL (`https://<project>.vercel.app`), go back to the Render
   dashboard and set `CORS_ORIGIN` to that exact URL. Comma-separate a second value if you also
   want Vercel's per-branch preview deployments to reach this backend (their origin looks like
   `https://<project>-git-<branch>-<team>.vercel.app`).
5. Set `GROQ_API_KEY` in the Render dashboard (free key from
   [console.groq.com/keys](https://console.groq.com/keys)) to enable AI meeting summaries.
   Leave unset and that one feature is simply disabled; everything else works regardless.
6. Register for free TURN credentials from the [Open Relay Project](https://www.metered.ca/tools/openrelay/)
   and set `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` in the Render dashboard. Without
   these, calls between two peers both behind symmetric NAT (common on cellular networks) will
   fail; STUN alone isn't enough for that case.
7. Every push to `main` redeploys both services automatically.

### Cold starts, and how the frontend hides them

Render's free plan spins the backend down after about 15 minutes of no traffic; the next
request wakes it back up, which can take up to a minute or two. Rather than let a visitor hit
that delay mid-action, the client pings `GET /api/health` the moment the home page loads (well
before anyone clicks anything) and keeps retrying until the backend answers. A status pill
reports what's happening (connecting, waking up, or unreachable) and stays visible while the
visitor scrolls and reads. Every action that needs a live connection (starting or joining a
call) is disabled until that check succeeds, so nobody can click through to a broken signaling
connection; they're told to wait a moment instead. See `client/src/store/backendStatusStore.ts`,
`client/src/components/BackendStatusBanner.tsx`, and `client/src/components/BackendGatedLink.tsx`.

## Path B: Render only (single container)

Simpler than Path A (one service, one dashboard) at the cost of the frontend also paying the
cold-start delay, since the client and API share the same Render instance.

1. Push this repo to GitHub (if you haven't already).
2. In the [Render dashboard](https://dashboard.render.com), **New → Blueprint**, point it at the
   repo. Render reads `render.yaml` and provisions the `patchbay` web service on the free plan,
   building from `Dockerfile`.
3. First deploy will fail health checks or behave oddly until `CORS_ORIGIN` is set. Render
   assigns your public URL (`https://<name>.onrender.com`) during that first deploy. Once you
   know it, set the `CORS_ORIGIN` env var in the Render dashboard to that exact URL (this repo's
   single service serves the client and API from the same origin, so this mostly matters as a
   defense-in-depth check, not a functional CORS requirement).
4. Set `GROQ_API_KEY` and the `TURN_*` variables as in Path A, steps 5–6.
5. Every push to `main` redeploys automatically (`autoDeploy: true` in `render.yaml`).

Because client and server share an origin here, `VITE_API_BASE_URL` should stay unset; leaving
it unset is what makes the client's `fetch`/Socket.IO calls same-origin relative paths.

## Path C: Cloudflare Tunnel (reusable across every future project)

Buy one cheap domain (~$10/yr via Cloudflare Registrar, at-cost, or use a free DuckDNS
subdomain for truly $0) and add it to a free Cloudflare account. From then on, **any** machine
you can run a process on (a laptop, a Raspberry Pi, an always-free Oracle Cloud VM) gets a
public `https://something.yourdomain.com` by running one `cloudflared` process next to it.
Cloudflare terminates TLS with its own certificate; `certbot`/Let's Encrypt never enter the
picture.

One-time setup:

```bash
# Install cloudflared (see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# for your platform), then:
cloudflared tunnel login
cloudflared tunnel create patchbay
```

This creates a tunnel and a credentials file (`~/.cloudflared/<tunnel-id>.json`). Point a
subdomain at it and run it; this is the "two commands" for any given project:

```bash
cloudflared tunnel route dns patchbay patchbay.yourdomain.com
cloudflared tunnel run --url http://localhost:5001 patchbay
```

`docker compose up` (or `npm run build && npm run start -w server`) serves the app locally on
`:5001` per usual; `cloudflared` is the only new piece, and it needs no changes to this repo's
code; `CORS_ORIGIN` should be set to `https://patchbay.yourdomain.com` in whatever `.env` the
local process reads.

**Reusing this for a different project later:** create one more tunnel
(`cloudflared tunnel create <project>`), route a new subdomain to it
(`cloudflared tunnel route dns <project> <project>.yourdomain.com`), and run it pointed at that
project's local port; the domain and Cloudflare account are the one-time cost, and every project
after the first is two commands.

## Local self-hosting with Docker (Path B and C's prerequisite)

```bash
docker compose up --build
```

Serves the full app (built client + compiled server) on `http://localhost:5001` from a single
container; this is the same image Render builds from `render.yaml`, so "it works in Docker
locally" and "it works on Render" are the same claim. See `.env.example` for every environment
variable the server reads (TURN credentials, rate limits, room TTL, etc.); `docker-compose.yml`
sets sane local defaults and comments out the TURN block for you to fill in.
