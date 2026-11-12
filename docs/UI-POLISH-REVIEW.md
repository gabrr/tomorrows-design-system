# UI/UX polish review — 2026-11-11

Scope: the user-provided component-library/rail screenshot and the corresponding desktop controls. Reviewed by standalone Codex CLI UI/UX workers using images only, then checked in the Codex in-app browser. No native subagent API, repository-source payload, cloud deployment or live experiment/AI request was used for the reviews.

## 1. Original screen — issues confirmed

The user crop was saved unchanged as the supplied reference (local reference; not distributed). The inset focus outline was reproduced in the actual app at its normal 1280×720 preview size. The crop alone was not treated as evidence of a mobile viewport.

!Actual before state (local reference; not distributed)

**Not fully polished yet.** The visual direction is coherent, but the search focus treatment, uneven control alignment, and inconsistent icons make this feel unfinished. These findings apply only to the visible crop.

Suggested dimensions below are **CSS targets**, not measurements inferred from screenshot pixels.

1. **Fix the search focus ring — highest priority, confirmed.**  
   The blue outline surrounds an inset area, leaving the search icon outside and crossing the field’s border. Apply focus styling to the entire field with `:focus-within`; remove any competing inner outline.  
   **Acceptance:** One continuous ring encloses the icon and input, follows the field radius, and causes no layout shift.

2. **Standardize control geometry and padding — confirmed.**  
   The select chevron sits too close to its right edge, while the search icon looks undersized beside the input text. Use a shared control height, such as **48px**, **16px horizontal padding**, **20px icons**, and a **12px icon-to-text gap**.  
   **Acceptance:** Select and search share edges, height, radius, and text alignment; trailing icons have consistent clearance.

3. **Tighten the panel’s hierarchy and spacing — confirmed.**  
   The large heading, prominent count badge, description, and generous vertical gaps compete for attention and push the component list downward. Use a consistent spacing scale: **24px panel padding**, **24px between sections**, **8px between labels and controls**, and **16px between related controls**. Make the count visually secondary.  
   **Acceptance:** The heading leads, the description supports it, and filters read as one compact group.

4. **Unify the toolbar icons — confirmed visual inconsistency.**  
   The plus, gear, clock, and thin undo/redo arrows differ noticeably in weight and visual size. Use one icon family with **20–24px icons**, consistent strokes, and **44–48px button targets**.  
   **Acceptance:** Icons appear equally weighted and centered; undo and redo are recognizable at normal desktop zoom. Verify accessible names and disabled states in the browser.

5. **Simplify border and radius treatments — confirmed.**  
   The panel, toolbar, header, fields, badge, selected button, and focus ring create several competing outlines. Define a small radius system—for example, **12px controls** and **20px floating panels**—with one neutral border treatment and blue reserved for interaction emphasis.  
   **Acceptance:** Neutral boundaries recede; the focused or selected control is immediately identifiable.

6. **Verify contrast and keyboard usability — browser verification required.**  
   Muted text, thin undo/redo strokes, and subtle borders may have insufficient contrast. The screenshot alone cannot establish contrast ratios, CSS target sizes, or keyboard behavior.  
   **Acceptance:** Normal text reaches **4.5:1**, meaningful icons and control indicators reach **3:1**, every icon button has an accessible name, and keyboard focus remains visible and unclipped.

The crop does **not** establish viewport overflow or justify a mobile redesign. No files were inspected or changed.

## 2. Repaired controls — visual pass

The search wrapper owns one continuous focus boundary enclosing icon and input. Search/select share 44px height, aligned edges and 10px Time System control radii. Licensed Phosphor Regular icons replace mixed glyphs; rail icons are 20px with 44px named targets. The count is secondary, redundant generic row descriptions are omitted while meaningful descriptions/tooltips remain, and the list scrolls independently below fixed controls. Existing Time System semantic colors and radius roles are preserved.

!Accepted light repair (local reference; not distributed)

The standalone reviewer compared the user crop, actual before image and actual after image together. It reported:

The after image is sufficiently polished for this bounded component-library and rail scope.

- **Search focus — Pass.** The broken inset outline in the crop and desktop before is replaced by one clean outline around the full search field.
- **Control padding and geometry — Pass.** Search and preset controls align, with balanced icon spacing and consistent heights.
- **Panel hierarchy and density — Pass.** The quieter count, clearer instruction, compact rows, and restrained category heading make the library easier to scan.
- **Rail icons — Pass.** Stroke weight, scale, and placement are substantially more consistent. Undo and redo now read clearly.
- **Borders and radii — Pass.** The competing outlines are resolved while preserving the existing Time System radius roles.
- **Contrast and keyboard behavior — Requires runtime testing.** The screenshot shows no obvious major contrast problem, but cannot establish contrast compliance, focus visibility across states, tab order, or keyboard operation.

**No remaining concrete material visual defect is evident in the after image.** This is a visual pass for the requested scope; it does not certify accessibility or the rest of the app.

## 3. Interaction and access — bounded runtime checks passed

Fifteen in-app checks are recorded in [the runtime evidence](../web/evidence/polish-audit.json). Search matching, empty-state recovery and clearing back to all 150 entries worked. Tab moved to the first filtered result with visible focus. Escape closed the panel and returned focus to Components. Selecting a deep catalog item kept filters stationary; filtering afterward reset list scroll to zero. A keyboard focus change dismissed the utilities menu. Adding a component and Undo restored expected node counts. No console errors were recorded.

!Keyboard focus (local reference; not distributed)

!Dark appearance (local reference; not distributed)

Measured light/dark semantic text and icon pairs exceeded 4.5:1; focus and input-border pairs exceeded 3:1. The lowest tested input boundary was 3.52:1 in light mode; light focus was 5.68:1. This is not full WCAG certification, a screen-reader audit, forced-colors verification, or approval of uninspected app screens.

The existing release command passed 109 Python tests and eight history invariants; current JavaScript modules passed syntax checks, along with 44 integrity probes, pricing-provenance and tiny-value checks. The existing 57-browser suite was not rerun through a separate browser engine in this bounded in-app audit. Temporary preview tabs and server are shut down after verification, as requested by the user.
