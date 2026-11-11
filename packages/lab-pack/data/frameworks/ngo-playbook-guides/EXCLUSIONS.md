# Exclusions

Ideas and frameworks this library deliberately did not build a skill around, and why. Recording an exclusion is as important as recording a source — it makes "we didn't include this" a documented decision rather than a silent gap. This is a living document.

## Universal, one-size-fits-all indicator checklists

We do not offer a skill that hands out a fixed set of "standard" indicators for a program type regardless of country or context. `sdg-alignment-mapper`'s own reference data shows why: Malaysia alone judges 7 of the UN's 234 global indicators not relevant to its context and has 16 with no current national data source — indicator applicability is inherently context-dependent, not universal. A skill that ignored this and just handed out a generic indicator list would produce confident-sounding but potentially wrong output.

## Logframe as a fixed, unrevisable document

The logframe format itself is included (`logframe-toc-builder`) because it's a donor-mandated standard, not because it's uncontested. Evaluators writing about adaptive management (see Vogel, 2012, in `docs/EVIDENCE.md`) argue that rigid, linear logframes can obscure complex, non-linear program dynamics — the real causal pathway a program follows often doesn't match the tidy chain drawn at the proposal stage. We don't exclude the logframe format itself, since funders require it, but the skill's Known Limitations section flags this critique explicitly and treats the assumptions/risks column as the place that complexity should keep surfacing, rather than presenting the logframe as fixed once written.

## Results-Based Management (RBM) as a mandatory umbrella framework

We are not building a skill that forces every program into a single RBM orthodoxy. RBM is influential and partly reflected in the logframe/indicator skills we do have, but treating it as the one correct lens would conflict with the point above — some programs (e.g., emergent, community-led, or adaptive programs) are legitimately better served by lighter-touch or narrative-based M&E approaches. If a program genuinely doesn't fit a logframe, the honest answer is to say so, not to force-fit one.

---

*This is a living document. Add an entry whenever a skill idea is considered and deliberately not built, or when a widely-used framework is deliberately left out of a skill's methodology.*
