# Artwork endpoints and provider requests

Implementation reference for `library-workshop-6`. Checked against
`tools/serve-model-audit.cjs` and `tools/artwork-workshop.cjs` on 2026-10-19.
This describes the current workshop, not a public production API or a promise
that third-party URLs will remain stable. Lookup precedence is in `PLAN.md`
§3.3.1.

## Workshop base URL

Default: `http://127.0.0.1:8766`. `AISLES_PREVIEW_PORT` changes the port; the
server binds to IPv4 loopback. Requests below use paths relative to that base.
The native host will eventually own equivalent operations.

| Method | Endpoint | Purpose |
|---|---|---|
| GET / HEAD | `/api/library` | Local library with current artwork resolution; the workshop then starts its missing-artwork job separately |
| GET / HEAD | `/api/library?refresh=1` | Refresh local scan, retaining cached artwork candidates and saved choices |
| POST | `/api/artwork/search` | Search missing artwork for one known game, cache candidates, return updated resolution |
| POST | `/api/artwork/search-missing` | Start the single background job that fetches missing box fronts and optical-disc labels across the local library |
| POST | `/api/artwork/select` | Save a per-asset choice or return that asset to automatic resolution |
| GET / HEAD | `/api/artwork/media-job` | Current missing-artwork job status |
| GET / HEAD | `/artwork-cache/<hash>.png` | Serve a downloaded image from Aisles' cache |
| GET / HEAD | `/library-art/<root>/<token>` | Serve existing local artwork in place from a known root |

HEAD returns the GET status/headers without its body. There is no authentication
token in this local prototype. POST operations require the exact header
`Content-Type: application/json`. If an `Origin` header is supplied, it must
equal `http://` plus the request's Host header (normally
`http://127.0.0.1:8766`). No cross-origin access is configured. POST paths must
be used exactly, without a trailing slash or query string.

## Library response and game key

`GET /api/library` returns JSON:

```json
{
  "generatedAt": "2026-10-19T00:00:00.000Z",
  "platforms": [
    {
      "id": "ps2",
      "name": "PlayStation 2",
      "games": []
    }
  ]
}
```

The empty array above is structural, not a report of the current collection.
Real game records include `platform`, `path`, `title`, `id`, `region`,
`coverUrl`, `artKind`, `source`, and `artwork`. Some adapters also return
revision, genre or publisher. `artwork.key` is the opaque `gameKey` required by
the POST endpoints. Always obtain it from this response; it is SHA-256 of the
platform plus the resolved, lowercased local launch path, not a provider ID or
game serial. Moving a game changes its key in the current prototype.

Local scan results are cached for two minutes. `refresh=1` bypasses that cache;
it does not discard manual choices, retry online searches, or delete images.
Library JSON uses `Cache-Control: no-cache`.

## Search missing artwork

```http
POST /api/artwork/search
Content-Type: application/json

{"gameKey":"<artwork.key from the library response>"}
```

The body contains only `gameKey`. Clients cannot specify a URL, arbitrary file
path, provider, title or region here; the server derives those from the scanned
game. The operation waits for its bounded provider requests and returns the
artwork-state object below with HTTP 200 and `Cache-Control: no-store`.
Concurrent searches for the same game share one in-flight operation.

### Missing box and optical-disc job

`POST /api/artwork/search-missing` accepts the same JSON header and
same-origin rules as the other POST routes. Its body is an empty JSON object:

```json
{}
```

It returns **202 Accepted** immediately, for example:

```json
{"running":true,"completed":0,"total":31,"failed":0}
```

The server scans every game whose `frontCover` is still generated and every
non-DS game whose `discLabel` is still generated. It searches those missing
assets in one job; DS cartridge labels remain excluded because a generic
full-cartridge source needs sticker preparation. A second request while it runs
returns the same job snapshot. `GET /api/artwork/media-job` reports its latest
`{running, completed, total, failed}` fields.

For a box front or disc label, candidate ordering is provider ordering followed
by result ordering. Once a candidate has downloaded and matches the local
platform and either the exact game ID or title plus region, the first usable
candidate is used automatically. A known printed-serial or edition conflict is
still excluded.

This operation searches asset types currently resolving to generated art. Local
emulator covers and saved non-generated choices retain priority. Explicitly
calling it retries lookup; normal selection in the UI automatically calls it
only when a game has not been searched before and online lookup is enabled.
The stored `searchedAt` also records unsuccessful searches, preventing repeated
automatic requests each time that game is clicked.

Example response when nothing suitable was found:

```json
{
  "key": "<same opaque game key>",
  "searchTitle": "Example Game",
  "region": "North America",
  "searchedAt": "2026-10-19T00:00:00.000Z",
  "errors": [],
  "searching": false,
  "resolved": {
    "frontCover": {
      "source": "generated",
      "url": null,
      "match": "no safe match — generated artwork"
    },
    "discLabel": {
      "source": "generated",
      "url": null,
      "match": "no safe match — generated artwork"
    }
  },
  "candidates": []
}
```

DS uses `cartridgeLabel` instead of `discLabel`. Successful resolved assets have
local URLs; the renderer never loads provider URLs directly. Candidates may
include these fields:

| Field | Meaning |
|---|---|
| `id` | Opaque selection ID, e.g. `launchbox-873660`; use the returned value |
| `kind` | `frontCover`, `discLabel`, or `cartridgeLabel` |
| `source`, `page`, `sourceUrl` | Provider name, source page and original image URL |
| `title`, `platform`, `region` | Matching metadata |
| `exactId`, `printedId` | Lookup/verified printed identifier when known; may be absent |
| `file`, `url` | Local hashed PNG filename and `/artwork-cache/…` URL |
| `width`, `height` | Decoded source dimensions |
| `match` | Resolution reason, or candidate eligibility/review status |
| `conflict`, `qualityNote` | Known serial/edition issue, or low-resolution review note |
| `editionUnverified` | Disc edition/disc number has not been established |
| `preparationRequired` | Full-cart artwork still needs sticker extraction |
| `labelRect` | Optional sticker UV crop `[x, y, width, height]` in source pixels, measured from top-left |

`resolved` values for local/generated assets have fewer fields. The prototype
may return `searching: true` in the POST result because the snapshot is built
just before clearing its in-flight entry; completion of the HTTP response means
the operation finished. Do not poll based solely on that transient field.

Provider failures (404, timeout, decoding failure, unavailable title match) are
normally returned in `errors` with **HTTP 200** and existing/generated artwork
retained. An empty candidate list is a valid outcome. An exact provider ID does
not mean its printed serial was independently inspected.

## Save an artwork choice

```http
POST /api/artwork/select
Content-Type: application/json

{
  "gameKey": "<artwork.key>",
  "kind": "frontCover",
  "candidateId": "automatic"
}
```

| `candidateId` | Effect |
|---|---|
| An ID from that game's candidates | Persist a manual selection for that asset |
| `automatic` | Remove the override and recompute normal lookup precedence; does not itself search online |
| `generated` | Persist a deliberate generated-art override |

`kind` must be `frontCover` plus the platform's medium type (`cartridgeLabel`
for DS, `discLabel` for the other workshop platforms). Selection returns the
same artwork-state shape as search. Choices are saved to the local index and
survive rescans and server restarts.

Manual selection can accept low-resolution or conflicting artwork after the UI
shows the candidate. It cannot accept another game's candidate, an invalid
asset type, a missing cached file, or a cartridge candidate still marked
`preparationRequired`.

## Image serving and persistence

`/artwork-cache/<hash>.png` accepts only 64 lowercase hexadecimal characters
followed by `.png`. The hash is SHA-256 of the provider image URL. Responses use
`image/png`, `X-Content-Type-Options: nosniff`, and a one-day browser cache.

`/library-art/<root>/<token>` accepts root names `ps1`, `ps2`, `ps3`, `ds`,
`wii`, and `wiiCustom`. The token is the base64url-encoded path relative to that
root, supplied by the library API. The resolved path must stay inside the known
root and reference an existing file. Original images use their existing PNG,
JPEG or WebP type and `Cache-Control: no-cache`.

Downloads are stored in ignored `.cache/artwork/` as validated PNGs, alongside
`index.json` containing candidate metadata and per-game selections.
`AISLES_ARTWORK_CACHE` overrides that directory, primarily for isolated tests.
The current hash is URL-based rather than content-based; explicitly retrying a
provider URL can update its file. No automatic expiration or garbage collection
is implemented.

## Local API status codes

| Status | Current behavior |
|---|---|
| 200 | Library/state/image returned; inspect artwork `errors` for upstream failures |
| 400 | Invalid JSON, invalid choice/type, or another exception in a POST handler; JSON `{ "error": "…" }` |
| 403 | POST Content-Type or supplied Origin rejected; empty body |
| 404 | Unknown game key, unresolved local image token, or missing cached image; empty body |
| 405 | Unsupported HTTP method; empty body |
| 413 | POST body exceeds 4,096 bytes; empty body |
| 500 | Local library scan fails; JSON `{ "error": "…" }` |

## External provider URLs

These are server-side requests made by the current adapter. They are not new
endpoints exposed by Aisles.

### GameTDB: exact game identifier

```text
GET https://art.gametdb.com/{system}/{type}/{locale}/{gameId}.png
```

| Variable | Current adapter values |
|---|---|
| `system` | `ps3` or `wii` |
| `type` | `cover` for `frontCover`; `disc` for `discLabel` |
| `locale` | `US` for North America; `EN` for Europe; `JA` for Japan |
| `gameId` | Scanned uppercase alphanumeric ID, 6–9 characters, e.g. `BCUS98148` or `RMCE01` |

Examples exercised during development:

```text
https://art.gametdb.com/ps3/disc/US/BCUS98148.png
https://art.gametdb.com/wii/disc/US/RMCE01.png
```

Metadata/provenance pages use `https://www.gametdb.com/PS3/{gameId}` or
`https://www.gametdb.com/Wii/{gameId}`. The adapter does not parse those pages.
It attempts only the locale above, not every possible language or artwork
variant. Missing images are valid: the tested BCUS98148 US cover returned 404,
while its disc returned a 160 × 160 PNG (usable by the disc-first policy, but
still marked as low resolution for review).
GameTDB exact lookup for PS1/PS2/DS/Xbox 360 is **not implemented**.

### LaunchBox: title, platform and region fallback

```text
GET https://gamesdb.launchbox-app.com/games/results?id={encodedTitleStem}
GET https://gamesdb.launchbox-app.com/games/images/{numericGameId}-{slug}
GET https://images.launchbox-app.com/{imageFilenameFromGallery}
```

Search and gallery responses are **HTML**, not a documented JSON API. Search
results supply `/games/details/{id}-{slug}` links; the adapter uses their
corresponding `/games/images/{id}-{slug}` pages. Image URLs and image IDs are
read from gallery attributes, never fabricated from game names.

Discovery query examples:

```text
https://gamesdb.launchbox-app.com/games/results?id=Cars
https://gamesdb.launchbox-app.com/games/results?id=Cooking%20Mama%203
```

The search stem is the part before a colon or spaced hyphen. Returned records
must still match the **full normalized title and platform**. Title normalization
uses Unicode NFKD, removes trademark symbols, lowercases, and drops non-ASCII
letters/digits. DS uses a cleaned ROM filename rather than its abbreviated
header title; a leading `Disney/Pixar` prefix is removed from other platforms.
There is no general fuzzy-title match.

| Aisles platform | Required LaunchBox platform name |
|---|---|
| `ps1` | `Sony Playstation` |
| `ps2` | `Sony Playstation 2` |
| `ps3` | `Sony Playstation 3` |
| `wii` | `Nintendo Wii` |
| `ds` | `Nintendo DS` |
| `xbox360` | `Microsoft Xbox 360` |

Gallery types map `Box - Front` → `frontCover`, `Disc` → `discLabel`, and
`Cart - Front` → `cartridgeLabel`. Image region must equal the mapped local
region (`North America`, `Europe`, or `Japan`). Unknown regions are not guessed.
At most two matching game pages are examined, with at most three alternatives
per missing asset type **per page**. Parsed candidates are deduplicated by image
ID. No pagination or exhaustive artwork harvest is implemented.

Box fronts and disc labels use the first usable candidate in provider/result
order. LaunchBox disc images default to
edition/disc-number review; whole-cart images require extraction, except the
two specifically inspected DS image IDs with crop presets. See the sample
audit for known conflicts. Neither LibRetro nor OPL is currently queried.

## Upstream request limits

- HTTPS only; allowed download hosts are `art.gametdb.com`,
  `gamesdb.launchbox-app.com`, and `images.launchbox-app.com`.
- Redirects are rejected. Each request has a 12-second timeout and a 12 MiB
  response limit. Requests are serialized with a 250 ms gap after completion;
  the entire search may therefore take longer than 12 seconds.
- User-Agent: `Aisles-Workshop/0.1`. No credentials or API keys are required by
  the current adapter.
- Images must decode as PNG, JPEG or WebP, with a 32-megapixel input limit.
  Either dimension below 384 pixels prevents automatic selection for box fronts
  and cartridge labels; the missing-disc job may still use a low-resolution
  optical-disc candidate as its first usable label, while retaining the review
  note.
- Selection and rendering use cached local images. Provider HTML changes or
  unavailable image URLs produce reported lookup failures and generated art.
