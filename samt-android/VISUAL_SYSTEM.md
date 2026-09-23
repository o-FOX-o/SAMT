# SAMT visual system contract

SAMT means direction/bearing. The interface should express that idea without
forcing one aesthetic on every user. Visual choices are presentation only: they
must never change domain/runtime semantics, stored factual history, scheduling,
completion rules or backup safety.

## Independent axes

### Layout

Exactly five first-party layouts ship with the app.

1. **Simple** — flat, dense and deliberately quiet. Lists and direct progress;
   minimal decoration.
2. **Orbit** — SAMT's signature navigation layout. Bearings, rings, arcs and
   cyclic geometry.
3. **Command** — information-dense operational modules, compact controls and
   strong numeric hierarchy.
4. **Journal** — narrow chronological pages, generous rhythm and a personal
   record/timeline feel.
5. **Matrix** — spatial tiles and a mosaic workspace with live priorities and
   large progress figures.

Changing layout must not change the stored SAMT state except the visual setting.

### Appearance

- Follow phone
- Light
- Dark
- Neon

Light, Dark and Neon are generated from the current palette. Neon is not a
separate hard-coded colour theme: it is a very dark neutral surface system with
high-chroma accents and restrained glow.

### Colour

Built-in colour palettes are reusable systems rather than page-specific skins.
A palette contains:

- primary
- secondary
- accent
- neutral
- success
- warning
- danger

The current library includes SAMT, Ocean, Forest, Ember, Royal, Sand, Mono,
Rose, Arctic, Copper, Midnight Neon and Solar.

Categories/domains have **no compulsory colour mapping**. A user can optionally
assign a colour to a Category; otherwise it uses the active visual system
without implying that Religion must be green, Health blue, and so on.

### Writing style

- Clean
- Technical
- Editorial
- Minimal
- Display

Writing style is independent from layout, appearance and colour.

## Contrast rules

Generated visual tokens use relative luminance/contrast calculations.

- normal body text target: at least 7:1 where practical
- minimum normal-text contrast: 4.5:1
- large text / major UI graphics: at least 3:1
- primary-button foreground is selected from a light/dark candidate by measured
  contrast against the active accent
- a custom palette must never intentionally create same-lightness foreground and
  background tokens

Decorative glow must never be required to read text.

## Ready presets

SAMT ships five complete presets:

- **Celestial** — Orbit + Dark + SAMT palette + Editorial
- **Terminal** — Command + Dark + Forest palette + Technical
- **Paper** — Journal + Light + Sand palette + Editorial
- **Pulse** — Matrix + Neon + Midnight Neon palette + Technical
- **Bare** — Simple + Light + Mono palette + Minimal

A ready preset is only a starting combination. Each axis remains editable after
application.

## Style preset file

Style presets are portable and separate from full SAMT data backups.

```json
{
  "format": "samt-style-preset",
  "version": 1,
  "name": "Celestial",
  "layout": "orbit",
  "appearance": "dark",
  "typography": "editorial",
  "paletteId": "samt",
  "palette": {
    "primary": "#147d86",
    "secondary": "#385970",
    "accent": "#c39a52",
    "neutral": "#65758a",
    "success": "#2f8f6a",
    "warning": "#c8872f",
    "danger": "#c45360"
  },
  "categoryColors": {},
  "effects": {
    "density": "comfortable",
    "motion": "subtle",
    "glow": "low"
  }
}
```

Import must validate layout, appearance, typography and all seven colours before
changing current settings. A style import must never replace Actions, Blocks,
Runs, Logs, History or other factual/runtime data.

## Verification

The automated visual checks must cover:

- all five layouts render on a phone-sized viewport without horizontal overflow
- palette switching updates generated tokens
- Light, Dark and Neon retain safe text contrast
- style preset export/import round-trips
- the UI smoke test captures a preview image for every layout
- the Android release APK still builds after visual changes
