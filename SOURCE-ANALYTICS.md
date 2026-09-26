# Source and behavior analytics

Storymera records first-party attribution and a small set of successful reader actions. It does not store IP addresses, device fingerprints, full referrer URLs, passwords, poll answers, or story text.

## Data model

Migration `analytics-migrations/001_source_behavior_analytics.sql` creates only these new tables:

- `source_tracking_sources` — configured links, exact UTM match fields, visible metrics and an optional goal;
- `source_tracking_visitors` — a random browser identifier stored only as SHA-256 and the first known source;
- `source_tracking_clicks` — short-link tokens awaiting page-load confirmation;
- `source_tracking_visits` — 30-minute activity sessions and their attribution;
- `source_tracking_events` — deduplicated reading, scene, completion and registration events;
- `source_analytics_migrations` — isolated migration marker.

The analytics schema has no foreign keys to product tables. It reads stable story, chapter and scene identifiers for goal configuration and reads user roles to exclude administrators. Existing product tables are not altered by this migration.

## Attribution

Priority is short link, exact UTM match, recognized external referrer, then direct. A request to `/go/:code` creates only a pending click and uses a temporary `307` redirect to a validated internal path. A visit is recorded after the destination page calls `/api/tracking/confirm`.

An active visit lasts until 30 minutes of inactivity. Reloads, tabs and a repeated marker reuse the visit. A different explicit attribution marker starts another visit. Unknown UTM combinations are kept as unassigned UTM traffic. Only the referrer host is retained.

Events are sent after the first scene is rendered, after each real scene is reached, after the server confirms chapter completion, and after registration succeeds. Unique database keys make retries idempotent. Analytics failures return a non-blocking response and never prevent reading or registration.

## Administration

Open `/admin/source-analytics`. Only an administrator can create, configure, archive, restore and report on sources. Short codes are permanent. External redirect targets are rejected. Disabled metrics show `—`; enabled metrics with no events show `0`.

Displayed and copied short links are built from `PUBLIC_SITE_URL`. For the isolated local test contour set it to `http://localhost:5176`. On the production server set it to the public origin, for example `https://storymera.com`. Never use the internal API host or port as `PUBLIC_SITE_URL`.

The default reporting timezone is `Europe/Kyiv`. Administrators are excluded from reports. The current user model has no reliable test-user flag, so the report cannot automatically exclude an unknown set of test accounts.

## Apply only this migration

Local test database:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run db:migrate:source-analytics -- --test
```

Production Compose deployment, after a backup and migration review:

```bash
docker compose --env-file deploy/.env.production --profile tools run --rm migrate-source-analytics
```

Do not run the general migration service when the deployment plan calls for analytics-only schema changes.

## Disable collection without deleting data

Set `SOURCE_ANALYTICS_ENABLED=false` and restart the API. Configured `/go/` links continue to redirect, while pending clicks, visits and events stop being collected. Existing reports and configuration remain available. Restore `true` to resume.

## Manual verification

1. Create two sources with different short codes in the admin screen.
2. Open one `/go/` URL and verify that no visit appears until its destination loads.
3. Reload and open another tab within 30 minutes; the visit count must stay unchanged.
4. Open the second source marker; it must create another visit.
5. Start a chapter, reach multiple scenes and finish it; check the enabled action columns.
6. Register after an attributed guest visit and check that one registration is attributed.
7. Try an unknown UTM combination and verify that it is not assigned to a configured source.
8. Archive and restore a link, confirm reader/admin access rules, and compare Today, 7 days, 30 days and a custom period.
