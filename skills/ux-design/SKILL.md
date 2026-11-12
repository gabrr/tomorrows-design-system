---
name: ux-design
description: Design and inspect architecture editing, scenario playback, comparison, and factory status for comprehension and accessibility.
---

# Ux Design

Load the product flow and affected screens, not the entire application history. Inspect actual rendered states and keyboard behavior before declaring a design usable.

Make building, configuring, running, pausing playback, inspecting and comparing discoverable. Show simulation time, seed/model version, units and assumptions beside results. Distinguish pending, failed, missing and estimated data. Rounded displays must preserve exported values; do not present uncalibrated percentiles as measured infrastructure performance. Factory status must distinguish worker exit, review, checks and integrated acceptance.

Provide keyboard and single-pointer alternatives for dragging nodes, connecting edges and editing timelines. Use visible focus, programmatic labels, text alongside color, accessible error/status messages and readable tables for canvas metrics. Check contrast, zoom and narrow viewports. Modal focus enters, remains contained and returns to its trigger.

Adapted from the local fluid-design skill: track direct manipulation promptly, let interactions interrupt transitions, preserve spatial context, adapt to coarse pointers, and honor reduced motion. Keep springs optional; avoid adding a library just for motion. Reduced-motion playback still communicates progress through static frames and text. Playback animation must not change the simulated result.

Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [APG dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Fluid-design adaptation is design guidance, not conformance evidence.
