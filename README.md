# Hidden Thread

Hidden Thread is a free, mobile-friendly daily word game. Season One contains
60 original puzzles: 20 Easy, 20 Moderate, and 20 Hard.

## Publish free with GitHub Pages

1. Create a new public GitHub repository, for example `hidden-thread`.
2. Upload every file in this folder to the **root** of that repository.
3. Open the repository’s **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. GitHub will provide a public URL such as
   `https://YOUR-USERNAME.github.io/hidden-thread/`.

All site links are relative, so the game works on a GitHub project URL without
editing paths.

For the strongest LinkedIn preview, once the final GitHub Pages address is
known, change the `og:image` value in `index.html` from the relative
`./social-card.png` path to its complete public address, for example:

```html
<meta
  property="og:image"
  content="https://YOUR-USERNAME.github.io/hidden-thread/social-card.png"
/>
```

The included 1200 × 630 social card is already sized for link sharing.

## Daily schedule

The first puzzle is scheduled for July 24, 2026. The game rotates through Easy,
Moderate, and Hard, releasing one puzzle per local calendar day. The setting is
near the top of `game.js`:

```js
const LAUNCH_UTC = Date.UTC(2026, 6, 24);
```

JavaScript months begin at zero, so `6` means July. Change the date before
launching if needed.

## Add more puzzles

Open `puzzles.js` and append another puzzle object. Each board is 6 × 8, so the
Master Thread and theme words must contain exactly **48 letters total** after
spaces and punctuation are removed. Every answer should:

- contain at least four letters;
- use recognizable English;
- be original and fit its clue cleanly;
- appear only once within its puzzle.

Update the cache name in `sw.js` whenever you publish changed files:

```js
const CACHE_NAME = "hidden-thread-v2";
```

That ensures returning players receive the newest version.

## Advertising

The page contains a clearly marked advertising placeholder, but no advertising
or tracking code is active. Apply to an advertising provider only after the
public site is complete and has useful original content.

After approval:

1. Add the provider’s verified script in the marked section of `index.html`.
2. Replace the placeholder with the approved responsive ad unit.
3. Update the Privacy page so it accurately explains cookies, advertising,
   consent, and any analytics.
4. Add a real contact method and confirm the About, Privacy, and Terms content.
5. Test the layout on phones before enabling ads publicly.

Never encourage players to click advertisements and never place ads where they
could be mistaken for game controls.

## Local preview

Because the game uses JavaScript modules, preview it through a small local web
server instead of double-clicking `index.html`. One option is:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Ownership

Hidden Thread is an independent original project and is not affiliated with The
New York Times. The Season One puzzle text and Hidden Thread branding are
reserved for the project owner and should not be republished without permission.
