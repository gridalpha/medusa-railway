# medusa-railway

[Medusa](https://medusajs.com) 2.x packaged for [Railway](https://railway.com) as
two services from one image: a **server** (Store and Admin APIs plus the Admin
dashboard at `/app`) and a **worker** (scheduled jobs, subscribers and long-running
workflows), which is the split Medusa's own deployment guide prescribes.

Medusa ships no runnable backend image — `create-medusa-app` scaffolds a project
you build yourself — so this repository *is* the image.

## What is in here

| Path | Purpose |
|---|---|
| `medusa-config.ts` | Redis caching / event bus / workflow engine / locking, S3 file storage, CORS and worker mode, all driven by environment variables |
| `src/api/media/[key]/route.ts` | Public read surface for uploads: signs a short-lived bucket read and redirects |
| `src/migration-scripts/initial-data-seed.ts` | Upstream's starter seed (store, region, sales channel, publishable key, warehouse, shipping options, demo products), run by `medusa db:migrate` |
| `docker-entrypoint.sh` | Migrates on the server, waits for the schema on the worker, bootstraps the first admin |
| `bin/wait-for-schema.js` | The worker's wait — Railway has no service ordering and Medusa's migrations take no advisory lock |

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | yes | Enables the Redis caching, event bus, workflow engine and locking modules; without it Medusa falls back to in-memory equivalents that are single-process only |
| `JWT_SECRET`, `COOKIE_SECRET` | yes | Must be identical on the server and the worker, and stable across deploys |
| `MEDUSA_WORKER_MODE` | yes | `server` on the web service, `worker` on the background service |
| `DISABLE_MEDUSA_ADMIN` | yes | `false` on the server, `true` on the worker |
| `MEDUSA_PUBLIC_URL` | yes | The server's public URL. Set it on **both** services: the worker has no public domain, so it cannot derive one |
| `PORT` | yes | Listen port, 9000 by convention |
| `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD` | first boot | The first admin user. Created once; changing them later does not rewrite the account |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | recommended | Object storage for uploads. Without them Medusa writes to the container filesystem, which does not survive a deploy |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | no | Default to `auto` and virtual-host addressing |
| `STOREFRONT_URL` | no | Added to `STORE_CORS` and `AUTH_CORS` |
| `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` | no | Override the derived origin lists outright |

## Why uploads are served through `/media`

Medusa stores an absolute URL on every uploaded file, and shoppers fetch product
images with a plain `<img>` — no credentials. Railway's managed buckets answer
`403` to anonymous GETs and reject `PutBucketPolicy`, so a raw bucket URL leaves
every image broken. The S3 provider's `file_url` therefore points at this app's
own `/media` route, which signs a short-lived read and redirects, keeping the
bytes flowing from storage rather than through Node.

## Credits

`src/migration-scripts/initial-data-seed.ts` is taken unmodified from
[`medusajs/dtc-starter`](https://github.com/medusajs/dtc-starter) (MIT).
