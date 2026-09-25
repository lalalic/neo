# Shared UI vocabulary

Use these terms to turn taste into observable decisions. Pair a noun with a
verb, target, and constraint (for example, “mute secondary surface contrast on
mobile, keep 4.5:1 text contrast”).

## Structure and hierarchy

**Layout:** hero, container, full bleed, grid, bento, split, master-detail,
responsive/adaptive, breakpoint, safe area.

**Hierarchy:** visual hierarchy, primary/secondary/tertiary, emphasis, muted,
contrast, surface, elevation, spacing rhythm, visual density.

**Web components:** navbar, sidebar, card, CTA, tabs, accordion, dropdown,
context menu, tooltip, popover, modal/dialog, drawer, bottom sheet,
toast/snackbar, badge/chip, segmented control, carousel, lightbox, stepper,
breadcrumbs, command palette, empty/loading/error states.

## Motion and effects

transition, fade, slide, scale, reveal, scroll-triggered, scroll-driven,
parallax, stagger, spring, overshoot, damping, easing, shared-element
transition, morph, micro-interaction, scroll snap, sticky/pinning,
skeleton/shimmer, backdrop blur/glassmorphism, glow, gradients, spotlight,
mask reveal, magnetic button, tilt.

Use motion to explain a change or preserve spatial continuity. Specify trigger,
property, duration/easing, interruption behavior, and reduced-motion fallback;
do not scatter entrance animations across every element.

## iOS

NavigationStack, navigation bar, large title, tab bar, toolbar, sheet, detents,
full-screen cover, popover, alert, confirmation dialog, swipe actions, context
menu, interactive dismiss, edge-swipe back, reorder, haptics, SF Symbols,
Dynamic Type, Live Activity, Widget.

## AI and chat

composer, thread, streaming, thinking state, tool call/result, artifact, inline
action, quick reply, suggestion chip, citation, attachment,
human-in-the-loop, optimistic UI.

## Useful modification verbs

polish, audit, critique, distill, simplify, tighten, loosen, emphasize, mute,
elevate, flatten, bolder, quieter, animate, de-animate, align, balance,
soften, sharpen.

## Translate vague feedback

| Vague request | Concrete interpretation to test |
| --- | --- |
| “More premium” | Reduce competing emphasis, choose a deliberate type scale, clarify surface/elevation roles, and remove ornamental gradients unless the subject earns them. |
| “Cleaner” | Reduce nesting and simultaneous actions, tighten labels, align edges, and define empty/loading/error states. |
| “More lively” | Increase `motion_intensity` or accent contrast in one purposeful interaction; preserve hierarchy and reduced-motion behavior. |
| “Less generic” | Increase `design_variance` through subject-specific type, palette, composition, or interaction—not random novelty. |
