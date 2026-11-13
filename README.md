# lodb

Content for the Living Orthodox apps: daily thoughts, lessons and calendars.

- **Authors:** see [AUTHORING.md](AUTHORING.md). Edit files under `editorial/` and open a pull request.
- **Apps:** read `channels/development.json` or `channels/production.json`, which name an
  immutable, hash-verified release under `releases/`. Both are written only by the Content workflow.
- **Google Calendar:** a public copy of each calendar that names a `googleCalendarId`, synced by the
  same workflow; `ledgers/` holds every event's permanent identity.
- **Tooling:** `.publisher/` holds the verified publisher used by the workflow.
