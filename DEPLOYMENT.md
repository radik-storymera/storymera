# Storymera: first Docker Compose deployment

This guide prepares an Ubuntu 24.04 VPS without exposing MySQL or the API directly. The Compose web port is bound to `127.0.0.1:8080`; a separately managed HTTPS reverse proxy can publish it later. Compose uses two networks: `edge` lets Docker activate that loopback host binding for `web`, while the isolated `internal` network connects `web` to `api` and connects `api`/`migrate` to `db`.

## Prerequisites

- Ubuntu 24.04 with Docker Engine and the Docker Compose plugin.
- A DNS record for the final hostname.
- A TLS reverse proxy on the VPS for `https://storymera.com` that forwards to `http://127.0.0.1:8080` and overwrites `X-Forwarded-For` and `X-Forwarded-Proto`.
- A verified SQL dump and matching managed-media archives if existing data will be transferred.

Do not copy `.env`, `.local/mysql-data`, `.runtime`, `node_modules`, local logs, or private keys to the source checkout on the VPS.

## 1. Create the production environment file

From the project directory on the VPS:

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
nano deploy/.env.production
```

Replace both database password placeholders with different strong values from your password manager. Confirm the final HTTPS origin. Do not commit this file.

Every Compose command below intentionally uses `--env-file deploy/.env.production`; this avoids using a developer `.env` by accident.

Validate the rendered configuration before starting anything:

```bash
docker compose --env-file deploy/.env.production config --quiet
```

## 2. Build the images

```bash
docker compose --env-file deploy/.env.production build --pull api web migrate
```

The API image compiles TypeScript and then installs production dependencies only. The web image builds Vite and copies only `dist` into nginx. `.dockerignore` keeps local databases, media, environment files, dumps, logs, caches, and keys out of both build contexts.

## 3. Start a new MySQL container

```bash
docker compose --env-file deploy/.env.production up -d db
docker compose --env-file deploy/.env.production ps
```

Wait until `db` is healthy. MySQL has no published host port.

## 4. Choose one database initialization path

### New empty production database

Run the migration service once:

```bash
docker compose --env-file deploy/.env.production --profile tools run --rm migrate
```

The migration service is not a permanent container. Applied migration names and checksums are stored in `schema_migrations`.

### Existing Windows database

Do not run migrations first when restoring a complete current database. Restore the verified dump as described in “Transfer the current Windows data”, then run the migration command once. Already applied migrations are skipped after checksum verification.

## 5. Start the API and web frontend

```bash
docker compose --env-file deploy/.env.production up -d api web
docker compose --env-file deploy/.env.production ps
```

Only `127.0.0.1:8080` is published through the non-internal `edge` network. `web` also joins `internal` so nginx can reach `api:3001` by service name. `api`, `migrate`, and `db` join only `internal`; API and MySQL have no published host ports.

## 6. Health and smoke checks

On the VPS:

```bash
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/
curl --fail http://127.0.0.1:8080/about
docker compose --env-file deploy/.env.production ps
```

`/api/health` returns only `{"status":"ok"}` when both Express and MySQL are available. `/about` verifies the SPA fallback.

After the external HTTPS proxy is configured, repeat the checks through the real hostname. Verify registration, login, logout, reading progress, polls, the admin area, image upload, video upload, and media playback. `APP_ORIGIN` must match the browser origin exactly.

## 7. Logs

```bash
docker compose --env-file deploy/.env.production logs --tail=200 db api web
docker compose --env-file deploy/.env.production logs --follow api web
```

Containers write application logs to stdout/stderr. Configure Docker log rotation at the host level.

## 8. Stop and start

Stop containers while retaining all named volumes:

```bash
docker compose --env-file deploy/.env.production stop
```

Start them again:

```bash
docker compose --env-file deploy/.env.production up -d db api web
```

Do not use `docker compose down --volumes`: it deletes the database and managed-media volumes.

## 9. Update

Before an update, back up MySQL and both media volumes. Give the new build a new `STORYMERA_IMAGE_TAG` in `deploy/.env.production`, then:

```bash
docker compose --env-file deploy/.env.production build --pull api web migrate
docker compose --env-file deploy/.env.production --profile tools run --rm migrate
docker compose --env-file deploy/.env.production up -d api web
docker compose --env-file deploy/.env.production ps
```

Run migrations before replacing the API only after reviewing the new migration for backward compatibility.

## 10. Rollback

Keep the previous tagged `storymera-api` and `storymera-web` images and the pre-update database/media backup. Set `STORYMERA_IMAGE_TAG` back to the previous image tag and run:

```bash
docker compose --env-file deploy/.env.production up -d --no-build api web
```

Application rollback does not reverse database migrations. If a migration is incompatible with the previous image, stop the stack and restore the matching pre-update database and media backups together.

## Transfer the current Windows data

Perform this only during a planned maintenance window. Keep the original verified files until the VPS restoration has been tested.

### A. Create and verify the Windows database dump

In PowerShell on the Windows workstation:

```powershell
Set-Location C:\Projects\JessicaStories
& 'C:\Program Files\nodejs\npm.cmd' run db:verify-backup
```

Use the `verified-*.sql` path recorded in `.local/backups/last-verified.json`. This operation creates a logical dump and proves that it can be restored into a temporary database. Never copy `.local/mysql-data` to Linux.

Transfer the selected SQL file to a private `transfer/` directory on the VPS using an encrypted channel. Do not place it in Git or the Docker build context.

### B. Restore the dump into the container

Start only MySQL and confirm it is healthy. For an initial empty target database:

```bash
docker compose --env-file deploy/.env.production up -d db
docker compose --env-file deploy/.env.production exec -T db sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --user=root "$MYSQL_DATABASE"' \
  < transfer/storymera-verified.sql
```

Then verify and apply only missing migrations:

```bash
docker compose --env-file deploy/.env.production --profile tools run --rm migrate
```

Do not import a working dump over a database that already contains production activity.

### C. Archive managed media on Windows

Create two archives so active files and recoverable trash remain separate:

```powershell
Set-Location C:\Projects\JessicaStories
tar -czf .local\media-transfer.tar.gz -C .local\media .
tar -czf .local\media-trash-transfer.tar.gz -C .local\media-trash .
```

Copy these archives privately to `transfer/` on the VPS. They may contain unpublished material and must not enter Git or a Docker image.

### D. Restore managed media volumes

With `api` stopped, restore the archives into the named volumes. The default Compose project name is `storymera`:

```bash
docker compose --env-file deploy/.env.production stop api
docker run --rm \
  -v storymera_media_data:/target \
  -v "$PWD/transfer:/source:ro" \
  alpine:3.22 sh -c 'cd /target && tar -xzf /source/media-transfer.tar.gz && chown -R 1000:1000 /target'
docker run --rm \
  -v storymera_media_trash:/target \
  -v "$PWD/transfer:/source:ro" \
  alpine:3.22 sh -c 'cd /target && tar -xzf /source/media-trash-transfer.tar.gz && chown -R 1000:1000 /target'
docker compose --env-file deploy/.env.production up -d api web
```

If `COMPOSE_PROJECT_NAME` was changed, find the actual volume names with `docker volume ls` before restoring. Restore the SQL dump and media from the same backup point.

## Backup requirements

A complete recoverable backup contains all three items:

1. a consistent MySQL logical dump;
2. the `media_data` volume;
3. the `media_trash` volume.

Store encrypted copies outside the VPS and test restoration regularly. Database-only backups do not contain uploaded image or video bytes.
