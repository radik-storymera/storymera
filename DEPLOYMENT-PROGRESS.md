# Storymera deployment progress

## 2026-09-27 — source analytics release

- Source analytics implementation, isolated migration, documentation and regression tests were released in commit `1ba42ac6c9a3ac1e1119d9dbe163bf519720a766`.
- Frontend and backend production builds pass.
- Analytics integration tests pass, including Europe/Kyiv day boundaries and fail-open short-link redirects.
- Local `main`, `origin/main` and the production checkout were synchronized at the release commit.
- The migration audit confirms that `analytics-migrations/001_source_behavior_analytics.sql` creates only new analytics tables and writes its marker only to the new analytics migration table.
- The release uses the image tag `source-analytics-1ba42ac`; the prior `first-production` images remain available for application rollback.
- Production SSH access was verified as the non-root `deploy` user with the local `id_ed25519` key. The checkout is `/opt/storymera`; root login and password authentication remain disabled.
- The server checkout was clean on `main` at `635526c3786d0df342e44f1cd8d5c824ad6259c5`; `db`, `api` and `web` were healthy and Compose validation passed.
- A verified pre-deployment backup was created outside the checkout with a 21-table consistent SQL dump, both media volumes, a Git bundle, production env and Caddy configuration. SHA-256 checksums were recorded in the protected backup directory.
- The protected backup is `/home/deploy/storymera-backups/20260926T221308Z-pre-source-analytics-635526c3786d`.
- Only the `migrate-source-analytics` Compose service was run. The general migration and seed services were not run.
- The migration created `source_analytics_migrations`, `source_tracking_sources`, `source_tracking_visitors`, `source_tracking_clicks`, `source_tracking_visits` and `source_tracking_events`.
- Before and after the migration, the list, columns, indexes and exact row counts of all 21 pre-existing tables matched. No local analytics records or accounts were imported.
- `db`, `api` and `web` are healthy. Local and public home, health and admin Source routes return HTTP 200; the unauthenticated Source admin API returns HTTP 401; the catalog and SPA fallback return HTTP 200.
- The running API has `PUBLIC_SITE_URL=https://storymera.com`; recent API/web logs contain no fatal, uncaught or migration errors.

Manual follow-up: sign in with an existing production administrator, create or inspect a real source only when desired, and confirm the copied short URL starts with `https://storymera.com`. No production source was created during deployment.
