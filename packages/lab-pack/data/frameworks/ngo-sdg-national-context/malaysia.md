# Malaysia / MySDG National Context

Seed reference for the `sdg-alignment-mapper` skill. This is a starting scaffold, **not** a complete indicator-by-indicator crosswalk. Populate it with verified data from the latest DOSM "Sustainable Development Goals (SDG) Indicators, Malaysia" report before relying on it for formal donor reporting or MySDG submissions.

## How Malaysia's framework differs from the UN global framework

- **Coverage gap.** The UN Global Indicator Framework has 234 unique indicators (post the March 2025 UNSC refinement). Malaysia reports 205 as available, 23 partially available (data exists but needs further methodological development), 16 not available, and 7 assessed as not relevant to the Malaysian context — 244 indicators total judged relevant, an ~82% availability rate. A straight 1:1 lookup between global and national indicators will hit gaps; always check status before asserting a national indicator exists.
- **Contextualised targets, not universal ones.** Malaysia's SDG Roadmap Phase II sets targets calibrated to national, regional, and local development priorities rather than adopting the UN's universal targets unmodified. Two programs with identical activities may map to different target thresholds globally vs. nationally.
- **Sub-national layer with no global equivalent.** DOSM publishes 84 state-level indicators and 26 district-level indicators. The UN global framework only reports at national level. If a program operates within a specific state, note that a more granular indicator may exist even where the global framework only has a national-level one.

## Status categories to use in mappings

- **Available** — Malaysia publishes this indicator nationally via DOSM.
- **Partially available** — data exists but is incomplete, or the methodology is still being developed.
- **Not available** — no current national data source.
- **Not applicable** — DOSM has assessed this global indicator as not relevant to the Malaysian context.

## National focal point

DOSM (Department of Statistics Malaysia) is the national focal point coordinating data collection from line ministries and agencies, and is the authoritative source for current indicator status. Point users there for anything beyond what this seed file covers — do not treat this file as final or complete.

## TODO before production use

- [ ] Pull the full indicator list from the latest DOSM SDG Indicators, Malaysia report and populate goal-by-goal availability status.
- [ ] Add a state/district indicator crosswalk for programs operating sub-nationally.
- [ ] Cross-check SDG Roadmap Phase II contextualised targets against the UN's universal targets where they diverge, and note the divergence per target rather than per goal.

## Sources

- DOSM, "Sustainable Development Goals (SDG) Indicators, Malaysia, 2024" — https://www.dosm.gov.my/portal-main/release-content/sustainable-development-goals-sdg-indicators--malaysia--state2024
- Economic Planning Unit, "SDG Roadmap for Malaysia Phase II: 2021–2025" — https://ekonomi.gov.my/sites/default/files/2024-09/SDGRoadmapforMalaysia_Phase2(2021-2025).pdf
