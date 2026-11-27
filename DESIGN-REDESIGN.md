# Redesign 2026-11: "The price label"

## Why
The old UI reads as machine-made: pills everywhere, soft gradient hero with a glow, circled step numbers, blurry drop shadows, one sans-serif at one weight, tiny grey text. People comparing medicine prices need trust and fast scanning, not decoration.

## References (what we take from each)
- **Mark Cuban Cost Plus Drugs (costplusdrugs.com).** Prices are shown as a plain breakdown, there is almost no decoration, and the price is the hero. → Lead with the number; prices as receipts.
- **GoodRx (goodrx.com).** A drug page shows a table of prices with the cheapest one marked clearly. → Alternatives as a ranked price table, cheapest flagged.
- **NHS.uk design system (service-manual.nhs.uk).** Large readable type, plain language, and warning callouts with a thick coloured left bar. → Doctor/pharmacist warning style, accessibility.
- **GOV.UK design system.** Square, high-contrast controls; a black focus ring on yellow; no shadows; things that work on cheap phones. → Inputs, buttons, focus states.
- **A real Pakistani medicine pack and its printed MRP sticker / pharmacy receipt.** A monospace price, a "Rs" prefix, a dashed tear line, and dotted leaders between name and price. → The signature "price label" component that makes the site feel local and specific.
- **Dawaai.pk / Marham (Pakistani health sites).** Local trust cues: the green pharmacy cross, Urdu Nastaliq next to English, phone and WhatsApp everywhere. → The green accent, bilingual first, WhatsApp as a first-class action.

## System
- **Type.** IBM Plex Sans (400/500/600/700) for UI. IBM Plex Mono (500/600) for every price, count, date and registration number, using tabular figures. Noto Nastaliq Urdu for Urdu (keep). Body 16px min; secondary text 14px min at ≥4.5:1 contrast.
- **Colour (light).**
  - paper `#F6F5EF`, surface `#FFFFFF`, sunk `#EFEDE5`
  - ink `#121614`, ink-2 `#3B413D`, muted `#5E655F`
  - hairline `#DCD8CC`, hairline-strong `#BEB9AA`
  - brand pharmacy green `#0A6B3C` (hover `#08572F`), brand-tint `#E4F1E8`
  - save green = brand
  - warn amber bar `#B7791F` on `#FFF6DC`
  - danger `#B3261E`
  - focus: 3px `#121614` outline + `#FFD23F` halo
- **Colour (dark).** ink-black paper `#0F1210`, surface `#171B18`, hairline `#2A302B`, ink `#ECEFEA`, brand `#3FB874`. Same roles.
- **Shape.** Radius 4px (controls), 6px (cards). No pills, except tiny status tags (radius 3px). No gradients, glows or blur shadows. Use 1px hairlines. A shadow is allowed only on floating things (toast, assistant button, sticky bar): `0 1px 0 hairline, 0 6px 16px -8px rgba(0,0,0,.25)`.
- **Space.** 4px grid. Dense lists use 12px row padding. Sections are separated by a hairline plus 32–48px, not by cards inside cards.
- **Signature component: price label.** Box with 1px border, a dashed top "tear line", "MRP" caption in small caps, a big mono price, and the per-unit price under it. The savings row is a receipt line: name …… dotted leader …… price, with "−82%" in a filled brand tag.
- **Alternatives.** A table-like list: brand + maker on the left, unit price right-aligned in mono, a dotted leader between them, and a 3px brand bar on the left of the cheapest row.
- **Buttons.**
  - Primary: solid brand green, white text, 4px radius, 44px tall.
  - Secondary: 1px ink-2 border on surface.
  - WhatsApp: solid `#1F7A4D`, labelled "WhatsApp".
  - Text links are underlined on hover.
- **Chips → plain links.** Quick searches become a row of underlined text links separated by thin dividers.
- **Warning callout.** NHS style: 6px amber left bar, bold first line.
- **Mobile bottom nav.** Icons + labels, with a 3px brand bar on top of the active item. No floating pill.
- **Assistant button.** A compact square-ish button (6px radius) with an ink background, icon + "Ask".
