# Phase 6: RetroAchievements account and progress

Aisles now links one RetroAchievements account and fills the ACHIEVEMENTS row in the
game details rail for the platforms whose emulators support it. The account is optional:
with no credentials the rail keeps its original *supported, not linked* state, and
without a confident game match it says **Linked** without inventing `0 of 0`.

![The RetroAchievements account page in Settings](../artifacts/phase6/settings-retroachievements.png)

## Scope

| Console | Emulator | RetroAchievements |
|---|---|---|
| PS1 | DuckStation | supported; system ID `12` |
| PS2 | PCSX2 | supported; system ID `21` |
| GameCube | Dolphin | supported; system ID `16` |
| Wii | Dolphin | supported; system ID `19` |
| DS | DeSmuME | not supported |
| 3DS | Citra | not supported |
| PS3 | RPCS3 | not supported |
| Xbox 360 | Xenia | not supported |

The support boundary is the same one recorded in `PLAN.md` §3.4. It is enforced in
`Domain/RetroAchievementsSupport.cs`; no other table decides which platform can show
progress.

## Linking an account

**Settings → RetroAchievements** contains the username and web API key fields. The key
is the one generated in the RetroAchievements control panel under **Keys**; it is not the
account password.

- **Test connection** calls `API_GetUserProfile.php` and reports the account name and
  total points. Testing does not save anything.
- **Save & rescan** writes the account and refreshes the library so the rail picks up the
  new state.
- **Unlink** clears both the username and key; saving then removes the account file and
  returns the rail to *supported, not linked*.

Credentials live at `%LOCALAPPDATA%\Aisles\retroachievements.json`, beside
`settings.json`, with the schema version and only the username and key. The file is
deleted when the account is cleared, so no stale key is left behind. The key is never
returned to the web layer, written to logs, or committed to the repository. It is stored
in the user's Windows profile without additional encryption; the file relies on the
profile's normal filesystem permissions.

## How a game is resolved

The first pass deliberately avoids `rcheevos` hashing. The host matches a local game
against the cached RetroAchievements game list using two keys derived from the game title
and file name:

1. **Normalized name** — case, punctuation, accents, articles, studio prefixes
   (`Disney`, `DreamWorks`, `Nickelodeon`, `WWE`) and attached system suffixes
   (`PS2`, `GC`, `Wii`, etc.) are folded away.
2. **Compact name** — the same string with spaces removed.

An exact normalized title match wins. File names are the fallback, which is what lets
`GranTurismo4PS2.iso` meet *Gran Turismo 4* and `Shrek the Third (USA).iso` meet
*Shrek the Third*. A compact match is accepted only when the candidate is at least three
characters long. If two different RetroAchievements games tie for the best score, the
game is treated as ambiguous and left unmatched rather than showing another game's
progress.

Matching intentionally does not try to interpret abbreviations. `MGS2-PS2.ISO` is not
silently expanded to *Metal Gear Solid 2*. That remains future work, along with
`rcheevos` hashing if title matching proves insufficient across a larger library.

## API traffic and caches

| Request | Endpoint | Cache |
|---|---|---|
| Account test | `API_GetUserProfile.php?u=...` | none |
| System game list | `API_GetGameList.php?i=<system>&f=1&h=0` | `games-<systemId>.json` for 7 days |
| Game progress | `API_GetGameInfoAndUserProgress.php?g=<game>&u=...` | in memory for 5 minutes |

Requests are serialized and spaced at least 350 ms apart. A fresh game-list cache avoids
the request entirely; if the API is unavailable but a cached list exists, the stale list
is kept rather than blanking the rail. Progress is fetched only when a game is selected,
not while building the library payload. Matches stay in memory for 30 minutes and are
cleared whenever the account changes.

The game-list cache lives under
`%LOCALAPPDATA%\Aisles\RetroAchievements\`. The API key is passed to the Web API as the
`y` query parameter required by RetroAchievements, and the username is also sent as `z`
and, where the endpoint expects it, `u`.

## Rail behaviour

The rail keeps its three states and its stable height:

| State | What the row shows |
|---|---|
| `notSupported` | *Not supported on this platform* + reason |
| `notLinked` | *Supported · not linked* + *Add account in Settings* |
| `linked` with progress | *N of M achievements* + earned points + filled progress track |
| `linked` without progress | **Linked** + *Loading progress*, *No match* or *Unavailable* + empty track |

![A linked game with no progress yet: no fabricated 0 of 0](../artifacts/phase6/rail-linked-no-progress-crop.png)

The library payload carries the cheap state from the progress cache. Selecting a game
sends its local play/identity data immediately and refreshes achievements asynchronously,
so the 3D stage and the rest of the rail never wait on the network. A response is applied
only if its game is still selected.

If the API rejects the saved key, the service records the rejection and returns
`notLinked` with *Reconnect in Settings*. This prevents the rail from claiming progress
from an account that no longer authenticates. Correcting the key and saving clears the
rejection; a successful **Test connection** with the same saved credentials also clears
it.

## Verification

- `dotnet build Aisles.slnx -c Debug`: 0 warnings, 0 errors.
- Settings/domain tests pass, including account-file round-trip and removal, system IDs,
  matcher ambiguity and compact title matches, profile/game-list/progress parsing, disk
  cache reuse and stale-cache fallback, auth classification, and the service's
  `notLinked`/`linked`/`notSupported` states.
- Workshop tests: 13 passed.
- Runtime, via the WebView2 DevTools protocol:
  - The Settings navigation and account editor rendered at the shipped window size.
  - **Test connection** reached the real RetroAchievements API with a deliberately
    invalid key and rendered *RetroAchievements rejected the saved username or web API
    key.* in the error state.
  - Saving those test credentials wrote the local account file, and the rail then flipped
    to *not linked* with *Reconnect in Settings* after the API rejected them.
  - **Unlink** plus save removed the file and restored *Supported · not linked*.
- The linked-without-progress rail state was exercised with a scripted `gameDetails`
  payload to verify the **Linked** row and empty track. A live linked account with real
  progress was not available, so that state remains unverified against a real account.
- No credentials or API keys are present in the repository. The automated tests use a
  fake `HttpMessageHandler`.

## Still open

- Live linked-account evidence with real achievement progress.
- `rcheevos` hash matching for abbreviations, region variants and titles the normalizer
  cannot reconcile.
- Achievement lists, recent unlocks and per-achievement detail; the rail shows aggregate
  progress only.
- Optional refresh of the account's total points in Settings after the first test; the
  saved linked state currently does not persist a points snapshot.
