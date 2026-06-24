# Our Constellation — Chae Young (채영)

Interactive birthday web app: 12 memory stars, Korean voice notes, bilingual EN/KO.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown (usually http://localhost:5173).

### Preview without voice notes or full playthrough

| URL | What you see |
|-----|----------------|
| `/?preview=sky` | Night sky, star 1 ready |
| `/?preview=sky&step=4` | Sky at Star 4 (broken line, "The Almost") |
| `/?preview=sky&step=5` | After reconnect (Star 5) |
| `/?preview=finale` | 채영 morph + birthday message |

Example: http://localhost:5174/?preview=sky&step=4

## Build for deploy

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to Netlify, Vercel, or GitHub Pages.

## Add your content

### Photo metadata pipeline

Add memory photos under `public/assets/` using `.jpg`, `.jpeg`, `.png`, `.webp`, or `.heic` if the local Sharp runtime can read it. Then regenerate the photo map:

```bash
npm run photos:metadata
```

If npm is unavailable on this machine, the same command is:

```bash
node scripts/generate-photo-metadata.mjs
```

The script scans supported images, reads EXIF dates/camera/dimensions/GPS when present, detects exact and likely duplicate files, assigns photos to chapters from existing `public/content.json` mappings first, then filename/date/GPS-region clues. It writes:

- `src/data/photoMetadata.json`: private raw metadata, including exact GPS if present.
- `public/data/photoMetadata.public.json`: sanitized data used by the website. Exact GPS coordinates are removed.

Manual chapter assignments are preserved by listing images in each chapter's `visual` block inside `public/content.json`. Duplicate files are never deleted; the generated JSON marks a `duplicateGroup` and chooses one `isPrimary` image for the main constellation.

### Voice notes (required — 12 files)

Record in Korean and save as:

```
public/assets/audio/s01.mp3
public/assets/audio/s02.mp3
...
public/assets/audio/s12.mp3
```

mp3 or m4a both work. Update paths in `public/content.json` if you use different names.

### Photos & screenshots

Replace placeholder SVGs or update paths in `public/content.json`:

| Star | Suggested file |
|------|----------------|
| 1 | `public/assets/01-flyer.jpg` |
| 3 | `public/assets/03-message-screenshot.png` |
| 4 | `public/assets/04-cancelled-screenshot.png` |
| 5 | `public/assets/05-meeting.jpg` |
| 7 | `public/assets/07-adventures.jpg` |
| 9 | `public/assets/09-korea.jpg` |
| 10 | `public/assets/10-her-world.jpg` |

Edit each star's `visual.src` in `content.json` after adding real files.

### Edit text

All copy lives in `public/content.json` — titles, messages, birthday finale. No code changes needed.

### Reset progress

The finale screen has a ↺ button, or clear `localStorage` key `chaeyoung-constellation-v1`.

## Story order

Stars connect in order s1 → s2 → … → s12. Star 4 draws a broken line; Star 5 reconnects. After Star 12, stars morph into **채영** and the birthday message appears.
