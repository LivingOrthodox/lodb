# Authoring Living Orthodox content

Everything the apps show comes from the `editorial/` directory of this repository. Pull requests
are validated automatically; merging to `main` publishes a new **development** release, and a
**production** release once the content passes every production check (see below). Apps read
releases straight from this repository, so never edit `channels/`, `releases/` or `ledgers/` by hand.

## Layout

```
editorial/
  sources.json                      where content comes from and what its rights allow
  daily/scheduled/<id>.json         one daily thought per file, with the date it is shown
  assets/backgrounds/<name>.jpg     images used by daily thoughts
  lessons/<id>.json                 lessons for the Learn tab
  calendars/<id>/configuration.json, events.json, days.json
  reviews.json                      editorial approvals (never sent to the apps)
```

Every file is optional. JSON Schemas for each record are in `.publisher/schema/`.

## Scheduling a daily thought

Create `editorial/daily/scheduled/<id>.json`. The `id` is lowercase letters, digits and hyphens
and must match nothing else; the file name should be the same. One thought per date and language.

```json
{
  "id": "example-thought-id",
  "date": "2027-01-07",
  "quote": "The exact words of the quotation.",
  "author": "The person who wrote or said it",
  "attribution": "Work, chapter or section",
  "sourceIds": ["example-source-id"],
  "reflection": "An optional question to reflect on.",
  "practicalAction": "An optional small step for the day.",
  "tags": ["optional-tag"],
  "background": {
    "image": "assets/backgrounds/example.jpg",
    "altText": "What the image shows, for screen readers",
    "focalPoint": { "x": 0.5, "y": 0.4 },
    "photographer": "Photographer's name",
    "license": "Licence name",
    "licenseUrl": "https://example.org/licence",
    "attributionText": "Photo credit as it should appear"
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase letters, digits, single hyphens. Never reuse or rename a published id. |
| `date` | yes | `YYYY-MM-DD`, the civil date on which the thought is shown. |
| `locale` | no | Language, default `en`. |
| `quote` | yes | Up to 2,000 characters, exactly as published in the source. |
| `author` | yes | Who actually wrote or said it. |
| `attribution` | yes | Full attribution, e.g. work and section. |
| `kind` | no | `quotation` (default) or `originalReflection`. |
| `sourceIds` | yes | At least one id from `sources.json`. |
| `reflection`, `practicalAction` | no | Optional prompts shown with the thought. |
| `background` | no | A licensed image; see below. |
| `status` | no | `published` (default) or `withdrawn` to remove it from the apps. |

Images must be JPEG, PNG or WebP under `editorial/assets/`, at most 15 MB (optimise them for phones),
and their licence must permit use in the apps. The focal point (0–1 on each axis) keeps the
important part of the image visible when it is cropped.

## Sources and rights

Each source in `sources.json` names its publisher and title, a `rightsReference` pointing to your
own record of the permission (kept outside this public repository), and the uses it allows:

```json
[
  {
    "id": "example-source-id",
    "publisher": "Publisher name",
    "title": "Title of the work",
    "rightsReference": "example-permission-record",
    "allowedUses": { "offlineStorage": true, "redistribution": true, "feedExcerpts": false, "sharing": true }
  }
]
```

Production releases only include content whose sources permit redistribution.

## Development and production

- **Development** releases are what debug builds of the apps read. Anything valid is published.
- **Production** releases are what store builds read. They require real content (no record marked
  `"isDevelopmentContent": true`), an approved review in `reviews.json` for every published thought,
  lesson and calendar — bound to the exact text that was reviewed, so any later edit needs a new
  review — and sources that permit redistribution. Until then the production channel is left
  unchanged and the workflow says why.

To check locally (Node 26 or later):

```sh
cd .publisher && npm ci --ignore-scripts && cd ..
node .publisher/publisher/src/cli.ts validate --input editorial --channel development
node .publisher/publisher/src/cli.ts validate --input editorial --channel production
```

## Google Calendar

The public Google Calendar is a copy of a calendar in `editorial/calendars/`, kept in sync by the
workflow; never edit its events in Google (events added there by hand are left alone, everything
else is overwritten). To set one up:

1. Create a Google Calendar, make it public (*Make available to public*), and copy its calendar ID
   (`…@group.calendar.google.com`) into the calendar's `configuration.json` as `"googleCalendarId"`.
   The apps then offer it in *Subscribe to this calendar*.
2. In Google Cloud, enable the Google Calendar API, create a service account and a JSON key for it,
   and share the calendar with the service account's email with *Make changes to events*.
3. Add the key as the repository secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Run the Content workflow once by hand (*Run workflow*) with *first_publication* set to the
   calendar's configuration id. This creates `ledgers/<id>.json`, the permanent identity of every
   event; the workflow commits it and must never lose it.

Only content valid for production is synced, unless the repository variable
`GOOGLE_CALENDAR_CHANNEL` is set to `development` (for a test calendar). The workflow runs daily so
the calendar always covers the next 400 days.

## Corrections and withdrawals

Fix a typo by editing the record; the next release replaces it in the apps (and invalidates its
production review). To remove something, set `"status": "withdrawn"` rather than deleting the
file, so apps that saved it can say it was withdrawn.

## The publisher

`.publisher/` is a verified copy of the Living Orthodox content contracts and publisher, exported
from the app repository with pinned dependencies. Do not edit it here: the workflow checks every
file against `.publisher/VENDOR.json` and fails if anything differs.
