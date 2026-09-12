# Drive layout

SKILLS_INDEX.md is the lightweight registry. Each entry points to a published
skill package or its SKILL.md. Full skill instructions are lazy-loaded from
Drive only when selected. Sync jobs should compare canonical local content
with the published copy, report conflicts, and never silently overwrite local
source.
