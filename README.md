# kuviot

*folk flowers, endlessly* ✿

kuviot is a procedural flower generator in the spirit of Polish folk art (Łowicz-style wycinanki paper cuts) and Russian Khokhloma painting. Press a button and you get a new bloom. Like it? Breed it.

The idea is to feel more like a toy than a tool: a few friendly sliders, pretty palettes, and lots of happy accidents.

## What it does

- **Flower mode:** a single bloom on a stem.
- **Bush mode:** a whole bouquet of flowers on a branching stem, with tendrils and swirly flourishes. Can be mirror-symmetric like a tree of life, and framed as a bush, a panel or a bookmark.
- **Wallpaper mode:** a seamless repeating pattern.
- **Breeding:** every flower has a 3×3 grid of offspring. Pick one to make it the parent of the next generation. The Mutation slider decides how wild the children get.
- **Macro sliders** instead of a hundred knobs: Lushness, Openness, Petals, Curl, plus Density and Flourish for layouts.
- **Curated palettes** inspired by traditional folk colors.
- **Sharing and export:** copy a link that recreates the exact flower, or save it as SVG or PNG.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | New bloom |
| `C` | Shuffle colors |
| `L` | Shuffle layout |
| `B` | Switch mode |
| `Z` | Undo |
| `1`–`9` | Pick an offspring |

## Running it

You need [Node.js](https://nodejs.org/).

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

To build a static version into `dist/`:

```sh
npm run build
```

## How it's built

Plain TypeScript and SVG, bundled with Vite. No frameworks.

| File | What's in it |
| --- | --- |
| `src/main.ts` | UI, modes, breeding, undo, sharing and export |
| `src/bloom.ts` | Generates a single flower |
| `src/bush.ts` | Bouquet layout and the stem tree |
| `src/ornaments.ts` | Tendrils, brush strokes and swirls |
| `src/tile.ts` | Seamless wallpaper tiles |
| `src/palettes.ts` | Color palettes |
| `src/geometry.ts` | Shape and path helpers |
| `src/rng.ts` | Seeded randomness, so the same link always gives the same flower |

## Ideas for later

Rosettes, borders, a paper-cut mode, roosters and birds, and saving favorites.

---

*Kuviot* is Finnish for "patterns".
