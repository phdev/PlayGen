# playgen-dispatch (Cloudflare Worker)

Holds the GitHub PAT server-side so the static webapp doesn't have to ask visitors for one. Two endpoints, both restricted to allowed Origins:

- `POST /dispatch` — dispatches `generate.yml` with `{ premise, modes }`
- `GET /runs` — last 5 workflow runs

## Deploy

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GH_DISPATCH_PAT
# paste a PAT with workflow scope (and repo scope if the repo is private)
npx wrangler deploy
```

Wrangler prints the URL: `https://playgen-dispatch.<your-subdomain>.workers.dev`.

## Configuration

`wrangler.toml`:

- `ALLOWED_ORIGINS` — comma-separated origins permitted to call the worker. Default: `https://phdev.github.io,http://localhost:5174`. Update if the webapp moves.
- `GITHUB_REPO` — `phdev/PlayGen`.
- `GITHUB_WORKFLOW` — `generate.yml`.

## Webapp wiring

The webapp reads `import.meta.env.VITE_DISPATCH_URL`. Set it in the Pages deploy:

```bash
gh variable set VITE_DISPATCH_URL --body 'https://playgen-dispatch.<your-subdomain>.workers.dev'
```

…and the deploy workflow exports it during `vite build`.
