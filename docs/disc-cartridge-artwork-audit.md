# Disc and cartridge artwork sample audit

Implementation follow-up: `library-workshop-5` now implements the fallback policy
in `PLAN.md` §3.3.1. Direct GameTDB artwork-host access succeeded even though the
website pages failed: the BCUS98148 disc was 160 × 160, so it requires review
rather than automatic assignment. The two DS samples now have prototype UV crop
presets and exact-code matching. The remaining findings below describe the
original sample audit; see `docs/library-workshop.md` for current behavior. For the
DS sticker extraction process specifically, see `docs/ds-cartridge-sticker-review.md`.

Checked 2026-10-19 against the current local scanner. Scope: two installed PS3 games, two of twelve installed DS games, and one Xbox 360 reference sample. The scanner currently reports no Xbox 360 games; Crackdown is a source-quality reference, not a detected library entry.

Unmodified sample images and their source URLs, image IDs, byte sizes and measured dimensions are in `artifacts/artwork-audit/manifest.json`. Filenames use the target local game ID for comparison; this does **not** certify that the source image is an exact release match. No sample has been applied to the workshop.

| Target | Candidate | Measured size | Review decision |
|---|---|---|---|
| PS3 LittleBigPlanet, BCUS98148 | LaunchBox North American Disc | 800 × 800 PNG | Reject automatic assignment: printed serial BCUS-98199 differs from the local title ID. This is a visible mismatch; equivalence has not been established. |
| PS3 LittleBigPlanet 2, BCUS98245 | LaunchBox North American Disc | 722 × 722 PNG | Hold for edition verification: image explicitly says Special Edition. Local title/region metadata alone does not establish that this artwork is appropriate. |
| DS Mario Kart DS, AMCE | LaunchBox North American Cart - Front | 517 × 564 PNG | Accept as a preparation candidate: printed NTR-AMCE-USA matches the local four-character game code. Full cartridge is included; isolate the sticker before texturing the 3D cart. |
| DS Cooking Mama 3, B3CE | LaunchBox North American Cart - Front | 517 × 564 PNG | Accept as a preparation candidate: printed NTR-B3CE-USA matches the local game code. Full cartridge is included; isolate sticker. |
| Xbox 360 Crackdown, reference only | LaunchBox North American Disc | 811 × 811 PNG | Suitable visual reference for a disc texture. No local release identity was available to validate assignment. |

## Visual suitability

All five files decode as PNGs and have alpha channels. An alpha channel alone does not establish a clean mask. Disc samples include photographed/scanned hub rings and rim shading; the 3D geometry must retain its own center hole and map the artwork concentrically. The Crackdown sample also needs its padding/mask checked before use.

DS samples show readable labels, with visible scan/print texture. They are reasonable shelf/inspection candidates but do not provide unlimited close-up detail. The label sits approximately within x=43..472, y=20..495 in the Mario Kart sample; these are visual estimates, not approved production crop coordinates. The sticker's clipped/rounded corners need a mask, rather than stretching the entire cart photo over the label plane. Preparation and an actual 3D render check remain outstanding.

## Source access findings

- GameTDB exposes a PS3 record for BCUS98148, but live page requests in this audit failed. Disc availability for BCUS98148 and BCUS98245 is **unverified**, not absent. Do not infer it from the existence of metadata or from another game's artwork.
- LaunchBox image pages and the five original image downloads were accessible. Their image galleries classify type and region, but this sample demonstrates that those fields alone do not verify the product serial or edition.
- A general supported JSON REST API has not been established. The LaunchBox creator documented `Metadata.zip` with XML and separate image downloads; validate the current schema/access before implementing an adapter.

## Recommendation for Aisles

Keep GameTDB as a PS3/Wii candidate source, with exact-identifier artwork checked per game. Use LaunchBox as a DS cartridge source and a PS3/Xbox disc fallback, subject to release verification. Keep front cover, disc label, and cartridge label as separate assets.

Before automatic assignment, retain provider game ID, image ID/URL, platform, asset type, region, edition, disc number, local game ID, printed ID when verified, and review status. Missing or conflicting release evidence must fall back to generated art or a manual choice. Download only selected assets into a local cache; never fetch images in the render loop.

Next implementation should start with the two verified DS codes, prepare the sticker textures and inspect them on the existing 3D cartridge. Resolve the PS3 edition/serial mismatches before applying those images. Xbox title matching cannot be tested against the library until a game is detected.

## Sources

- https://gamesdb.launchbox-app.com/games/images/786-littlebigplanet
- https://gamesdb.launchbox-app.com/games/images/14975-littlebigplanet-2
- https://gamesdb.launchbox-app.com/games/images/6545-mario-kart-ds
- https://gamesdb.launchbox-app.com/games/images/20268-cooking-mama-3-shop-chop
- https://gamesdb.launchbox-app.com/games/images/6872-crackdown
- https://www.gametdb.com/PS3/BCUS98148
- https://forums.launchbox-app.com/topic/30123-launchbox-games-db-external-scraper/
