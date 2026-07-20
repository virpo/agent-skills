# Proof Matrix

Choose the smallest route that proves the artifact's actual job. Add variants only when they can change the verdict.

| Artifact | Inspect before | Meaningful variants | Functional proof | Quality proof | Honest blocker |
|---|---|---|---|---|---|
| Web or app UI | Running interface at the real route | Desktop, actual mobile width, dark mode, waiting, empty, error, selected, disabled, success | Focused tests plus real interaction flow | Comparable screenshots and visual inspection | App, backend, auth, data, or browser unavailable |
| Browser extension | Installed extension in target browser and host page | Popup size, host-page surfaces, permissions, quota, loading, failure | Build/install smoke and host interaction | Screenshots at true extension dimensions | Cannot install, authenticate, or reach host state |
| Deck or slides | Rendered slides, not source text alone | Representative opening, explanation, proof, transition, closing; then every slide | Export/build and timing checks | Montage plus per-slide inspection for outliers | Renderer, source assets, animation surface, or fonts unavailable |
| Document or PDF | Rendered pages | Dense pages, tables, images, headers/footers, first and final page | File opens, links/forms work, structural validator passes | Page images inspected for wrapping, clipping, hierarchy, and rhythm | Required renderer, font, source, or target format unavailable |
| Image or media | Final export at target dimensions | Crop, background, light/dark placement, representative frames, duration | File metadata and playback/open check | Pixel-level or frame-level inspection at intended size | Source, codec, target dimensions, or playback unavailable |
| Device or desktop app | Real running state on the target device/app | Connected/disconnected, waiting, failure, focused/unfocused, relevant OS size | Device action and live state/log confirmation | Screenshot, screen recording, or photo of real output | Device, app session, permission, or connection unavailable |
| Physical or maker object | Current render plus dimensions and tolerances | Critical fits, material, orientation, assembly, expected load or use | Geometry/manufacturing checks and measured prototype | Photo/video of the produced object in use | No print, material, measurement, or physical test available |
| CLI or setup flow | Real terminal run from a clean or representative environment | First run, existing dependency, conflict, auth failure, retry, cancellation | Exit codes and end-to-end command result | Prompt clarity, progress, error recovery, and final handoff inspected | Clean environment, account, permission, or dependency unavailable |

## Comparison rules

- Match viewport, zoom, content, state, and crop for UI screenshots.
- Match slide/page number and renderer for deck or document comparisons.
- Match device, app version, connection state, and focus for hardware or desktop output.
- Match dimensions, material, orientation, and measurement method for physical comparisons.
- Keep the north star visible during review when one was supplied.

## Verdict rules

- **Pass:** The intended job is clear, functional checks pass, inspected variants support the verdict, and no material issue remains.
- **Repeat:** The pass improved the artifact but visible or behavioral issues remain within the authorized scope.
- **Blocked:** A missing real surface, state, dependency, permission, device, physical test, or user decision prevents a supported verdict.
