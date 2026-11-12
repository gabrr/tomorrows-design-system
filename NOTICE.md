# Third-party notices

Tomorrow’s Design System is MIT licensed. Its identity and product screenshots are its own; it is not affiliated with or endorsed by Meta.

- **Astryx core and Neutral theme** — Meta Platforms, Inc.; MIT. The pinned package version is recorded in package-lock.json. [Upstream](https://github.com/meta/astryx); license in licenses/ASTRYX-LICENSE.txt and the distributed UI assets.
- **React / React DOM** — MIT. Runtime notices are retained in web/assets/app.js.LEGAL.txt.
- **Lucide icons** — license notices are retained in the installed package and bundled legal notices.
- **Phosphor icon asset** — MIT. The favicon asset's license is retained at web/icons/PHOSPHOR-LICENSE.txt.

Dependency versions and transitive dependencies are recorded in package-lock.json. Review their individual license files when redistributing modified builds. Build tooling is not shipped in the Python wheel.

The frontend build also emits full license texts for dependencies contributing to the runtime bundle in `web/assets/THIRD-PARTY-NOTICES.txt`. The same file ships in the wheel. `licenses/runtime-packages.json` records the exact package versions, local license sources and text hashes. Missing texts fail the build instead of silently dropping notices. StyleX's npm package omits its license file; the retained fallback is the official upstream MIT text, with retrieval provenance in `licenses/STYLEX-SOURCE.json`.
