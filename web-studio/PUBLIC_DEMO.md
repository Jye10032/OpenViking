# Portfolio read-only deployment

This fork adds an opt-in public showcase on top of official main. The Dockerfile
in this directory builds Web Studio with `VITE_OV_PUBLIC_DEMO=true` and serves it
through `script/public-demo-server.mjs` on port 8080 (`PORT` is configurable).
Ordinary `npm run build` keeps the upstream connection behavior.

Set `OV_DEMO_USER_API_KEY` **at runtime only** to the ordinary
`default/jye10032` user key. Never set a VITE key variable or use the Root key.
Startup checks the key's role and exact identity and fails closed on a mismatch.
The backend defaults to `https://openviking-server-production.up.railway.app`;
`OV_DEMO_UPSTREAM` can override it with an HTTPS origin.

The owner has chosen to publicly expose this identity's readable data. Visitors
do not need a key. This is a live view: future content accessible to that identity
also becomes visible. The real key is injected only by the server. Incoming keys,
identity headers and cookies are discarded; upstream redirects are not followed.

The proxy allows only enumerated GET paths and query parameters for resources,
memories, sessions, skills, usage, audit and monitoring. All writes, administration,
OAuth, model calls and unknown APIs are denied. Even GET session auto-creation is
blocked. Downloads are attachments with a sandbox policy. API responses have a
16 MiB cap, a 20-second timeout, a concurrency cap and a global request limit.
Only the Vite `dist` directory is served as static content.

The banner explains the read-only mode. Write-oriented navigation and credential
editing are removed in this build; remaining write controls receive HTTP 403.
Server enforcement is authoritative even if a visitor alters the frontend.

Verification:

```sh
npm run test:public-demo
VITE_OV_PUBLIC_DEMO=true npm run build
```

Railway: keep this service's source root at `/web-studio`. It detects the
`Dockerfile` automatically. The existing public domain keeps port 8080.
`/showcase-health` is available for a deployment health check. Configure secrets
only in Railway's service variables. The image contains no `.env` files.

Rollback: redeploy the previous static frontend deployment. The backend data and
its authentication configuration are not changed by this deployment.
