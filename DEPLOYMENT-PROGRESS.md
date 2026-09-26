# Storymera deployment progress

## 2026-09-26 — source analytics release

- Source analytics implementation, isolated migration, documentation and regression tests are ready locally.
- Frontend and backend production builds pass.
- Analytics integration tests pass, including Europe/Kyiv day boundaries and fail-open short-link redirects.
- Local `main` and `origin/main` were synchronized at `635526c3786d0df342e44f1cd8d5c824ad6259c5` before preparing the release.
- The migration audit confirms that `analytics-migrations/001_source_behavior_analytics.sql` creates only new analytics tables and writes its marker only to the new analytics migration table.
- No production database, container, volume, configuration or GitHub branch has been changed for this release.
- Production SSH access was verified as the non-root `deploy` user with the local `id_ed25519` key. The checkout is `/opt/storymera`; root login and password authentication remain disabled.
- The server checkout was clean on `main` at `635526c3786d0df342e44f1cd8d5c824ad6259c5`; `db`, `api` and `web` were healthy and Compose validation passed.
- A verified pre-deployment backup was created outside the checkout with a 21-table consistent SQL dump, both media volumes, a Git bundle, production env and Caddy configuration. SHA-256 checksums were recorded in the protected backup directory.

Next steps: commit and push the reviewed release, fast-forward the clean server checkout, validate the updated Compose configuration, apply only `migrate-source-analytics`, deploy API/web and run production smoke checks.
