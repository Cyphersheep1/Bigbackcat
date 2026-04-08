# BigBack Benny: Chonky Crossing 🐱🍔

A fully self-contained, portable HTML5 browser game starring **BigBack Benny** — the chonkiest cat on Solana. Cross as many lanes as possible without getting hit, eat food to grow, and try not to get squished!

**Play it live → [bigbackcat.fun](https://bigbackcat.fun)**

---

## 🎮 How to Play

Help BigBack Benny cross as many lanes as possible without getting hit by cars, food trucks, bikes, or rolling donuts.

### Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move Up | `↑` or `W` | Swipe Up / D-Pad ▲ |
| Move Down | `↓` or `S` | Swipe Down / D-Pad ▼ |
| Move Left | `←` or `A` | Swipe Left / D-Pad ◀ |
| Move Right | `→` or `D` | Swipe Right / D-Pad ▶ |

### Collectibles

| Item | Points | Effect |
|------|--------|--------|
| 🍔 Burger | +5 | Gains chonk |
| 🌮 Taco | +8 | Gains chonk |
| 🍕 Pizza | +10 | Gains chonk |
| ⭐ Special | +15 | Auto-triggers **Dash** |

### The Chonk Mechanic

Every time Benny eats something, he gets **bigger and slower**. The more you collect, the harder Benny is to maneuver — but the points add up fast! Watch the 🍔 **Chonk Meter** in the top-right corner.

### Dash Ability

Collect the glowing ⭐ special food item and Benny will automatically trigger a **food-coma dash** — a brief burst of speed to escape danger!

### Scoring

- **+1 per lane** advanced forward
- **Bonus points** for each collectible eaten
- Your high score is saved in your browser

---

## 🚀 How to Deploy

### Option 1: Open Locally (Instant Play)

Just double-click `index.html` in your file manager, or drag it into any browser window. No server needed.

### Option 2: GitHub Pages (Free Hosting)

1. Push the files to any GitHub repository
2. Go to **Settings → Pages**
3. Set **Source** to `Deploy from a branch`, pick `main`, folder `/` (root)
4. Click **Save** — your game will be live at `https://yourusername.github.io/yourrepo/`

### Option 3: Netlify / Vercel / Any Static Host

Drop the folder into Netlify's web UI, or deploy with any static hosting provider. No build step needed — just serve the files as-is.

---

## 🔄 How to Transfer to Another Repository

Because the game is completely self-contained (no dependencies, no external assets), moving it is trivial:

### Step-by-Step

1. **Copy the four files** into the root of your target repository:
   ```
   index.html
   style.css
   game.js
   README.md   ← (optional, update as needed)
   ```

2. **Commit and push:**
   ```bash
   git add index.html style.css game.js README.md
   git commit -m "Add BigBack Benny: Chonky Crossing game"
   git push
   ```

3. **Enable GitHub Pages** (or deploy to your host of choice).

4. **That's it.** The game works immediately in any repo, any folder, any host.

> ✅ No npm install, no build process, no CDN dependencies. Open `index.html` and it works.

---

## 🎨 How to Customize / Rebrand

All branding is defined as constants at the **very top of `game.js`** in the `BRAND` object:

```js
// ============================================================
// BRANDING — Edit these to customize / rebrand the game
// ============================================================
const BRAND = {
  GAME_TITLE:     'BigBack Benny: Chonky Crossing',
  CHARACTER_NAME: 'BigBack Benny',
  SHARE_URL:      'bigbackcat.fun',
  SHARE_MESSAGE:  (score) => `I scored ${score} points on BigBack Benny: Chonky Crossing! 🐱🍔 Play at bigbackcat.fun`,
  BG_COLOR:       '#2d5a1b',   // grass color
  ROAD_COLOR:     '#4a4a4a',   // road color
};
```

### Quick Customization Examples

| What to change | Where |
|---------------|-------|
| Game title | `BRAND.GAME_TITLE` in `game.js` and `<title>` + headings in `index.html` |
| Character name | `BRAND.CHARACTER_NAME` in `game.js` |
| Share URL (for the share button) | `BRAND.SHARE_URL` and `BRAND.SHARE_MESSAGE` in `game.js` |
| Grass color | `BRAND.BG_COLOR` in `game.js` |
| Road color | `BRAND.ROAD_COLOR` in `game.js` |
| Difficulty | `CFG.DIFF_RATE` — lower = harder, higher = easier |
| Max chonk levels | `CFG.MAX_CHONK` in `game.js` |
| Score per collectible | `CFG.BURGER_SCORE`, `CFG.TACO_SCORE`, etc. in `game.js` |

---

## 📁 File Structure

```
bigbackbenny/
├── index.html   ← Main entry point (open this to play)
├── style.css    ← All styles (screens, HUD, D-pad, responsive)
├── game.js      ← Complete game engine (all logic + canvas drawing)
└── README.md    ← This file
```

### Zero External Dependencies

- ✅ No CDN links
- ✅ No npm packages
- ✅ No external image files
- ✅ No external fonts
- ✅ All graphics drawn via HTML5 Canvas API
- ✅ Sound effects via Web Audio API (synthesized)
- ✅ All file references use relative paths (`./style.css`, `./game.js`)

---

## 🛠 Technical Details

- **Rendering:** HTML5 Canvas API with `requestAnimationFrame` game loop
- **Graphics:** All drawn programmatically — no image files
- **Audio:** Web Audio API with synthesized beeps/boops
- **Controls:** Keyboard (arrow keys + WASD) + Touch (swipe + on-screen D-pad)
- **Responsive:** Canvas scales to fit any screen size
- **Progressive difficulty:** Obstacles speed up as your score increases
- **High score:** Persisted in `localStorage`

---

## 🐱 About BigBack Benny

BigBack Benny is the chonkiest cat on the Solana blockchain. He loves eating, moving slowly, and getting squished by food trucks. Visit [bigbackcat.fun](https://bigbackcat.fun) to learn more.

> *"I'm still hungry..."* — Benny, every time
