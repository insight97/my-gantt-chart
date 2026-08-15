# Default task color palette research

Date: 2026-08-15

## Recommendation

Use the following **Radix Step 8-derived soft source palette** for the eight stored task colors, while keeping the existing white mixes for the larger timeline surfaces:

| App name | Recommended stored base | Source token   |
| -------- | ----------------------- | -------------- |
| 藍色     | `#5eb1ef`               | Radix Blue 8   |
| 青色     | `#53b9ab`               | Radix Teal 8   |
| 綠色     | `#5bb98b`               | Radix Green 8  |
| 紫色     | `#be93e4`               | Radix Purple 8 |
| 橘色     | `#ec9455`               | Radix Orange 8 |
| 紅色     | `#eb8e90`               | Radix Red 8    |
| 金色     | `#d5ae39`               | Radix Yellow 8 |
| 灰色     | `#b9bbc6`               | Radix Slate 8  |

This is the best fit for the app's current rendering pipeline: the raw values are lighter and softer than the current muted/dark values, while the existing `35%`, `29%`, and `11%` white mixes turn them into light macaron surfaces without adding a shared pink or gray cast. Radix assigns Step 8 to stronger UI borders and focus rings, while Step 9 is its highest-chroma solid color. Using Step 8 as this app's stored decorative source hue is therefore an intentional adaptation that avoids Step 9's stronger accent appearance while retaining enough color for the existing white mixes ([Radix scale roles](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [official Radix sRGB values](https://github.com/radix-ui/colors/blob/main/src/light.ts)).

Do **not** store already near-white pastel colors while retaining the current white mixes. That applies the lightening twice, leaving large surfaces nearly indistinguishable from white. If a true pastel primitive palette is preferred, the mix percentages would also need to rise substantially or be removed; that is a broader visual-system change.

## Scope and current rendering

The current stored defaults are in [`src/task-colors.ts`](../../src/task-colors.ts):

`#2f75bb`, `#4f9aa3`, `#5d9b63`, `#8b6fb5`, `#d48b45`, `#c85f5f`, `#c09a38`, `#6f7f8f`.

The stored color is currently used in two different ways:

- Directly for 28 px picker swatches and 8 px task identity dots (`src/styles.css:859-866`, `src/styles.css:1487-1497`).
- As a source hue mixed with white for Daily Distribution segments (`35%`, `src/styles.css:704`), filled allocation cells (`29%`, `src/styles.css:1251`), and allocation windows (`11%`, `src/styles.css:1217`).

The drop-preview inline background is overridden by `background: #eaf4f8 !important`, so it does not materially constrain this palette (`src/styles.css:1284-1296`).

Under CSS Color 5, when the second percentage is omitted, it receives the remainder. Therefore:

```css
color-mix(in srgb, var(--task-color) 35%, #fff)
```

means 35% of the opaque task color and 65% white. The same rule makes the other surfaces 29%/71% and 11%/89%. The specification defines `color-mix()` as interpolation in the named color space and explicitly defines omitted percentages ([CSS Color Module Level 5, `color-mix()`](https://www.w3.org/TR/css-color-5/#color-mix), [omitted percentage rules](https://www.w3.org/TR/css-color-5/#serializing-color-mix)).

## Breadth-first source scan

The initial scan covered six high-signal, first-party sources:

1. **W3C WCAG 2.2** for normative accessibility constraints. Normal text needs at least `4.5:1`; large text needs `3:1`; meaningful UI visuals and graphical objects need `3:1` against adjacent colors; color must not be the only visual means of conveying information ([WCAG 2.2 SC 1.4.1 and 1.4.3](https://www.w3.org/TR/WCAG22/#distinguishable), [WCAG 2.2 SC 1.4.11](https://www.w3.org/TR/WCAG22/#non-text-contrast)).
2. **W3C CSS Color Module Level 5** for the actual `color-mix()` semantics used by this app ([specification](https://www.w3.org/TR/css-color-5/#color-mix)).
3. **Radix Colors** for role-oriented UI scales and exact sRGB values. Radix separates background, border, solid, and text steps; Step 8 is a strong border/focus color, while Step 9 is the highest-chroma solid color ([Radix scale roles](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [Radix source values](https://github.com/radix-ui/colors/blob/main/src/light.ts)).
4. **IBM Design Language / Carbon** for a current graded palette, UI usage, and accessibility guidance. IBM supplies RGB/hex values and says small text should reach `4.5:1`, large text and graphical elements `3:1` ([IBM color specifications](https://www.ibm.com/design/language/color/#specifications), [IBM accessibility guidance](https://www.ibm.com/design/language/color/#accessibility), [Carbon color overview](https://carbondesignsystem.com/elements/color/overview/)).
5. **Material UI's first-party Material palette documentation** for the established `300` shade set and its exact hex values. MUI describes the Material palette as harmonious and also warns that WCAG 2.2 text contrast is `4.5:1`, higher than MUI's default `3:1` threshold ([MUI color palette](https://mui.com/material-ui/customization/color/)).
6. **ColorBrewer's maintained first-party data** for categorical pastel palettes. Its source marks `Pastel1` and `Pastel2` as qualitative schemes and provides exact RGB values ([ColorBrewer repository](https://github.com/axismaps/colorbrewer), [official palette JSON](https://github.com/axismaps/colorbrewer/blob/master/export/colorbrewer.json)).

The depth-first pass selected Radix, WCAG, and CSS Color as the strongest leads because this app needs (a) source hues that survive its existing white mixes without looking neon, (b) explicit UI role guidance, and (c) exact browser mixing behavior. IBM, Material, and ColorBrewer remain useful comparison points.

## Four concrete candidates

All candidates preserve the current order: 藍色 / 青色 / 綠色 / 紫色 / 橘色 / 紅色 / 金色 / 灰色.

| Candidate                         | Exact stored bases in app order                                                        | Direct-base contrast vs white | `#2b5263` text vs 35% mixed fill | Assessment                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------: | -------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Material 300                   | `#64b5f6`, `#4dd0e1`, `#81c784`, `#9575cd`, `#ffb74d`, `#e57373`, `#ffd54f`, `#90a4ae` |             `1.41:1`-`3.68:1` |                `5.68:1`-`7.42:1` | Friendly and familiar. Picker dots are soft, but the existing white mixes make several large fills very pale.                                                     |
| B. IBM luminous 40                | `#78a9ff`, `#08bdba`, `#42be65`, `#be95ff`, `#ff832b`, `#ff8389`, `#f1c21b`, `#a2a9b0` |             `1.68:1`-`2.46:1` |                `6.16:1`-`7.01:1` | Bright and luminous, but teal, orange, and gold are highly saturated and read closer to candy accents than soft macaron colors.                                   |
| C. Radix Step 8 **(recommended)** | `#5eb1ef`, `#53b9ab`, `#5bb98b`, `#be93e4`, `#ec9455`, `#eb8e90`, `#d5ae39`, `#b9bbc6` |             `1.91:1`-`2.48:1` |                `6.30:1`-`6.84:1` | Best two-stage result: visibly softer source dots and balanced hue-derived macaron fills after the current white mixes.                                           |
| D. ColorBrewer pastel hybrid      | `#b3cde3`, `#b3e2cd`, `#ccebc5`, `#decbe4`, `#fed9a6`, `#fbb4ae`, `#fff2ae`, `#cccccc` |             `1.13:1`-`1.72:1` |                `7.04:1`-`8.05:1` | Closest to literal pastel/macaron swatches, but becomes almost white after a 35% mix. It would work better only if the current white mixing were reduced/removed. |

Candidate A uses Material `300` shades (Deep Purple 300 for 紫色 and Blue Grey 300 for 灰色). Candidate C maps Radix's hue-specific Step 8 values to the app names, using Yellow rather than Amber for a gold that stays distinct from orange. Candidate D maps hue-appropriate values from ColorBrewer Pastel1/Pastel2; it is a UI adaptation, not an original ColorBrewer semantic mapping.

## Recommended palette: computed rendered colors and contrast

The following values were calculated by interpolating the opaque 8-bit sRGB channels at the percentages used in `src/styles.css`, rounding only the displayed hex result to the nearest 8-bit value. WCAG contrast was then calculated from relative luminance without rounding for pass/fail; displayed ratios are rounded to two decimals.

| Name | Stored base | 35% fill  | `#2b5263` on 35% | 29% fill  | `#24566a` on 29% | 11% fill  | 11% fill vs white | Base vs white |
| ---- | ----------- | --------- | ---------------: | --------- | ---------------: | --------- | ----------------: | ------------: |
| 藍色 | `#5eb1ef`   | `#c7e4f9` |         `6.38:1` | `#d0e8fa` |         `6.35:1` | `#edf6fd` |          `1.09:1` |      `2.33:1` |
| 青色 | `#53b9ab`   | `#c3e7e2` |         `6.37:1` | `#cdebe7` |         `6.36:1` | `#ecf7f6` |          `1.09:1` |      `2.36:1` |
| 綠色 | `#5bb98b`   | `#c6e7d6` |         `6.35:1` | `#cfebdd` |         `6.34:1` | `#edf7f2` |          `1.09:1` |      `2.40:1` |
| 紫色 | `#be93e4`   | `#e8d9f6` |         `6.30:1` | `#ece0f7` |         `6.34:1` | `#f8f3fc` |          `1.09:1` |      `2.48:1` |
| 橘色 | `#ec9455`   | `#f8dac4` |         `6.35:1` | `#f9e0ce` |         `6.34:1` | `#fdf3ec` |          `1.09:1` |      `2.35:1` |
| 紅色 | `#eb8e90`   | `#f8d7d8` |         `6.31:1` | `#f9dedf` |         `6.33:1` | `#fdf3f3` |          `1.09:1` |      `2.39:1` |
| 金色 | `#d5ae39`   | `#f0e3ba` |         `6.59:1` | `#f3e8c6` |         `6.57:1` | `#faf6e9` |          `1.08:1` |      `2.11:1` |
| 灰色 | `#b9bbc6`   | `#e7e7eb` |         `6.84:1` | `#ebebee` |         `6.75:1` | `#f7f8f9` |          `1.06:1` |      `1.91:1` |

Result: both current text-bearing mixed surfaces remain above WCAG AA's `4.5:1` normal-text threshold with the recommended palette; the lowest computed text pairing is `6.30:1`. The 11% allocation-window surface currently has no visible text; its low contrast against white is instead relevant only if that window itself must carry meaning.

## Decorative fills versus meaning-bearing color

- **Decorative/categorical fill:** A task hue can remain pale when the task name and hours are independently present as text. W3C's Understanding document says a graphic does not need non-text contrast when overlaid text conveys the same information or when it is aesthetic ([Understanding SC 1.4.11, required for understanding](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#required-for-understanding)). The Daily Distribution segments have task-name text/accessible names, so the fill can be treated as redundant grouping decoration only if the text remains available for every segment.
- **Meaning-bearing text:** The 10-11 px labels are normal text, not large text, so their foreground/background pair must be at least `4.5:1`. The computed recommended-palette range is `6.30:1`-`6.84:1` across the two actual text-bearing mixed-surface combinations.
- **Meaning-bearing graphical object or UI state:** If segment boundaries, color-picker circles, or selection/focus indicators are required to find/understand the control or chart, they need `3:1` against adjacent colors. All recommended raw colors are below `3:1` against white (`1.91:1`-`2.48:1`), and the current unselected swatch ring `#bac8d1` is about `1.71:1` against white. Palette choice alone therefore cannot make the color-only picker robustly conforming. A separate neutral boundary around approximately `#7a8994` would be about `3.60:1` against white, while the current selected outline `#2f75bb` is about `4.79:1`. W3C also notes that visible boundaries are not required when other visible content identifies a control, but author-supplied focus/state indicators still need sufficient contrast ([Understanding SC 1.4.11, controls and boundaries](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#user-interface-components)).
- **Allocation-window caveat:** The 11% fills are only `1.06:1`-`1.09:1` against white. If the colored allocation window is required to understand the scheduled date range, it cannot be treated as merely decorative and would need an additional sufficiently contrasting edge/pattern or an equivalent visible text representation. This is an existing visual-model question, not a regression unique to the recommended palette.
- **Color is not semantics by itself:** Keep task name, hours, `aria-label`, selection outline, and other non-color cues. WCAG 1.4.1 prohibits using color as the only means to convey information or state ([WCAG 2.2 Use of Color](https://www.w3.org/TR/WCAG22/#use-of-color)).

## Implementation implications (no application code changed in this research)

1. Change `DEFAULT_TASK_COLOR` and the eight `TASK_COLOR_OPTIONS` values for new selections and inherited/default tasks.
2. Decide explicitly whether existing tasks should change. Colors are persisted as raw hex values, so existing explicit selections will stay dark unless the implementation maps exact old built-in values to their new counterparts; custom hex values should remain untouched.
3. Keep the current `color-mix(..., #fff)` percentages initially. They are already acting as a purposeful surface-generation layer.
4. Update hard-coded fallback hues in `src/styles.css` if the implementation expects a consistent new default when `--task-color` is absent.
5. Test direct picker dots and task identity dots as well as the mixed Daily Distribution and allocation surfaces; testing only the stored array would miss the actual rendered effect.
6. Treat the low-contrast unselected swatch boundary as a separate accessibility follow-up unless the palette change is explicitly allowed to include that focused CSS adjustment.

## Sources

- [W3C, Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C, Understanding SC 1.4.11: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [W3C, CSS Color Module Level 5: `color-mix()`](https://www.w3.org/TR/css-color-5/#color-mix)
- [Radix Colors, Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- [Radix Colors, official light-scale values](https://github.com/radix-ui/colors/blob/main/src/light.ts)
- [IBM Design Language, Color](https://www.ibm.com/design/language/color/)
- [Carbon Design System, Color overview](https://carbondesignsystem.com/elements/color/overview/)
- [Material UI, Color](https://mui.com/material-ui/customization/color/)
- [Axis Maps / ColorBrewer repository](https://github.com/axismaps/colorbrewer)
- [ColorBrewer official palette data](https://github.com/axismaps/colorbrewer/blob/master/export/colorbrewer.json)
