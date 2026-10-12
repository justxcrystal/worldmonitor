# Satellites at Home — setup and use

This modification adds a **Satellites at Home** panel to WorldMonitor's full dashboard. It calculates orbital passes over a location you enter. It does not measure radio signals, identify signals directed at an address, or establish targeting.

## Run on your computer

1. Install Node.js 24 and extract this archive.
2. Open a terminal inside the extracted `worldmonitor-main` folder.
3. Run `npm ci`, then `npm run dev`.
4. Open the local URL printed in the terminal and navigate to `/dashboard`.
5. Find **Satellites at Home**. If needed, enable it in Settings → Panels and save the layout.
6. Enter latitude, longitude, and altitude in meters, then choose **Save location & track**. West longitude is negative. If you do not know altitude, zero provides an approximate sea-level calculation.

This is a source project, not an installed or hosted application. Existing WorldMonitor services retain their original configuration requirements. The new panel does not require its Redis/API credentials.

## Orbital data

The public refresh button requests CelesTrak's space-stations TLE catalog:
https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle

This small catalog is not a list of all satellites. For other satellites, download a recent standard two- or three-line TLE text file and use **Import satellite orbital data**. Imports are limited to 1 MB and 100 unique valid objects. Invalid checksums and records are rejected. Orbital epochs more than 14 days old or more than one day in the future are excluded. The public feed may be unavailable or blocked by network/CORS restrictions; file import remains available.

The panel shows current direction (azimuth: 0° north, 90° east), elevation, and range for objects above 10°, plus predicted windows over the next 24 hours. Predictions are sampled every 30 seconds; very short windows can be missed. Times use your browser's time zone. A window already in progress is labeled, and one extending beyond the forecast is marked as continuing. Ground obstructions and visual illumination are not modeled. Refresh to calculate a new window.

## Privacy

Coordinates are saved only in this browser's local storage and are used locally for orbit calculations. The public catalog request contains no coordinates. **Clear location** removes the saved coordinates. Imported TLE files remain local and are not persisted between visits. Source and orbit epoch labels distinguish current feed data from retained/imported predictions.

## Verification

Passed:
- `npm run typecheck`
- `npm run lint:boundaries`
- `node --experimental-strip-types --test tests/home-satellites.test.mts` (3 calculation/input tests)
- `npx vitest run --config vitest.dom.config.mts tests/dom/home-satellite-panel.test.mts` (2 DOM interaction tests with a mocked base panel and failed feed)

Calculation checks include overhead look-angle geometry, pass thresholds/order, stale data exclusion, checksum validation, and cancellation. DOM checks exercise location save/restore/clear, feed failure, and coordinate privacy in the catalog request.

Browser verification could not run: Chromium was absent and its download returned an invalid archive in this environment. Desktop/mobile visual layout and complete dashboard interaction are therefore unverified. A scoped browser drive is included at `.agents/skills/verify-worldmonitor/steps/home-satellites.mjs` for use when Chromium is available. Live CelesTrak data access was not verified.

The archive has no Git metadata. Upstream preflight reports repository/base/GitHub identity blockers, so no upstream PR or deployment was attempted. Checks above are local archive checks.
