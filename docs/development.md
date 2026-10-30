# Aisles developer guide

The main [README](../README.md) covers installation and everyday use. This guide
collects the implementation details needed to work on the current application.

## Architecture and source layout

Aisles uses WinUI 3, .NET 10, and WebView2. The native host serves `wwwroot` over
the virtual origin `https://aisles.local`. WebView2 data lives under
`%LOCALAPPDATA%\Aisles\WebView2`.

| Path | Purpose |
|---|---|
| `Aisles.slnx` | Application solution |
| `src/Aisles.App/` | Native shell, scanner, artwork, launcher, and message bridge |
| `src/Aisles.App/consoles.json` | Default console catalog and launch templates |
| `src/Aisles.App/wwwroot/stage.js` | Application state, browsing views, settings, and game details |
| `src/Aisles.App/wwwroot/pixel-ui.js` | Pixel console lineup, shelf cases, paging, and selection |
| `src/Aisles.App/wwwroot/media-presets.js` | Shared physical-media dimensions |
| `src/Aisles.App/wwwroot/art/pixel-ui/` | Store artwork, sprites, and fonts |
| `tests/Aisles.Settings.Tests/` | Settings and domain regression checks |
| `tools/` | Branding and focused frontend test utilities |
| `docs/screenshots/` | README screenshots |

The project disables `AppendPlatformToOutputPath` so solution and explicit x64
builds share `src/Aisles.App/bin/Debug/net10.0-windows10.0.19041.0/`.
The build copies the default catalog and web assets beside the executable.

## Checks

```powershell
dotnet build Aisles.slnx -c Debug
dotnet run --project tests/Aisles.Settings.Tests/Aisles.Settings.Tests.csproj -c Release
npm test
```

For UI changes, use the [accessibility checklist](accessibility-regression-checklist.md)
and verify Shelf, Covers, and List in the native app. Parser and settings tests do
not substitute for launching real games through each emulator.

## Releases

[The release workflow](../.github/workflows/release.yml) runs on pushes to `main`
and manual dispatch. It tests the domain project, publishes a self-contained
`win-x64` build, and packages it with [Inno Setup](../installer/Aisles.iss).
Versions follow `1.0.<GitHub run number>`. The workflow creates a GitHub Release
with `Aisles-Setup-<version>.exe` and a commit-derived `changes.md`.

## Branding

`assets/Aisles.ico` combines a detailed mark for larger sizes with a simplified
vector mark for 16/24/32/48 pixels. Rebuild it with `node tools/build-icon.js`;
the `PLAN` array controls the source selection. The icon contains DIB entries
and a PNG-compressed 256-pixel image with alpha.

The app embeds the icon in `Aisles.exe`, assigns it to the native window, and
uses it as the web favicon. Build/publish links branding into `wwwroot/branding`.
Source concepts and comparisons remain under `prototype/icon-*`.

## Implementation references

- [Metadata discovery](emulator-metadata-audit.md)
- [RetroAchievements integration](retroachievements.md)
- [PS3 trophies](ps3-trophies.md)

The frontend uses HTML/CSS and pixel-art assets. `media-presets.js` contains the
shared case and cartridge proportions used by Shelf, Covers, and the selected-game
display. Historical phase plans, 3D workshops, and visual audits live in Git history
rather than in the active documentation set.
