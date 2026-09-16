---
title: Travel-day story template
hook: A concrete moment that makes today different
conflict: An obstacle grounded in the selected footage
resolution: What changed by the end of the day
production_note: Storyboard placeholders only. Before rendering, replace prompts with relative assets selected from the source manifest and Markcut vision metadata, add mandatory mood-matched BGM as a root-level audio background stream, and select narration by the voice contract in docs/architecture.md.
---
# video
width:1080 height:1920 fps:30 layout:series

## Hook
layout:parallel
- image prompt:"Storyboard placeholder: the day's most compelling observed moment" isBackground:true
- script "Replace with a hook grounded in the media manifest."

## Challenge
layout:parallel
- image prompt:"Storyboard placeholder: the obstacle and the people responding to it" isBackground:true
- script "Replace with what happened and why it mattered."

## Resolution
layout:parallel
- image prompt:"Storyboard placeholder: the outcome, with a detail connecting to the next episode" isBackground:true
- script "Replace with the observed result and an honest open question."
