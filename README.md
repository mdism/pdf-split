# PDF Split

Pull pages out of a PDF, or cut it into separate files. Compress it to send by email or WhatsApp, or clean up a faint scan. Works on scanned and digital PDFs, and your file never leaves your device.

**Live:** https://tools.shaikhismail.com/pdf-split/ · part of the [free tools](https://tools.shaikhismail.com/) by [Mohammed Ismail Shaikh](https://shaikhismail.com)

- 100% client-side: files and numbers never leave your browser
- Nothing is uploaded or saved; anything held while processing is temporary and deleted afterwards
- No analytics or ads; Cloudflare Turnstile keeps bots out
- No build step, works on phones, light and dark theme

## How to use

1. Drop one PDF on the page (or tap to choose it). The tool reads it and says how many pages are scanned and how many are digital.
2. Choose **how to split**:
   - **Extract pages**: the pages you type go into one PDF, in the order you type them. Example: `1-3, 5, 8-end`.
   - **Each range as a file**: every part you type becomes its own PDF. Example: `1-3, 4-6, 7-end` gives three files.
   - **Every page**: one PDF per page.
   - **Every N pages**: one PDF for each block of N pages.
3. Choose the **output quality** (see below), then press **Split & download**. One file downloads as a PDF; several come together in a zip.

## Output quality options

The same options are in both PDF tools. Every page is first sorted into one of two kinds, automatically:

- **Digital** pages have real text (made in Word, a browser, a bank's system). Text stays sharp and selectable whatever you choose.
- **Scanned** pages are pictures of paper (from a scanner or a phone camera) with no real text on them. A scan that was OCR'd keeps its text layer, so it counts as digital.

| Option | What it does | Best for |
|---|---|---|
| **Keep original** (default) | Copies pages exactly. Nothing is re-encoded, so quality and size stay the same. | Most splits and merges |
| **Compress** | Scanned pages are redrawn at a lower resolution as JPEG. In digital pages, only large pictures are re-saved smaller; text and drawings are untouched. A page is only changed when that really makes it smaller. | Email and WhatsApp limits, upload forms |
| **Enhance** | Scanned pages are cleaned up: paper made white, faint text darker, edges sharper. The scan's own resolution is kept (at least 200 dpi). Digital pages are already sharp, so they are kept as they are. | Faint photocopies, phone photos of documents |

Extra choices once you pick Compress or Enhance:

| Choice | Values |
|---|---|
| **Strength** (Compress) | **Light** 150 dpi, high quality · **Balanced** 120 dpi (default) · **Strong** 96 dpi, smallest |
| **Sharpness** (Enhance) | **Standard** keeps the scan's resolution, at least 200 dpi · **Maximum** 300 dpi, bigger file |
| **Colour** | **Keep colour** · **Greyscale** (smaller) · **Black & white** (smallest, crisp text; best for text-only scans) |
| **Page type** | **Detect each page** (default) · **Treat all as scanned** (also redraw digital pages that contain pictures, e.g. a typed form with a photo) · **Treat all as digital** (never redraw a page; Compress only shrinks pictures) |

Black-and-white scans (1 bit per pixel) stay black and white, because adding colour would only make them bigger.
Password-protected PDFs are refused with a clear message; remove the password first.

## Run locally

Serve the folder (PDF reading uses JavaScript modules, which browsers block when the page is opened straight from disk):

```
cd public
python -m http.server 8080
```

## Project layout

```
public/                 Everything that gets published to /pdf-split/
├── index.html          The page
├── privacy.html        Privacy policy for this tool
└── assets/
    ├── fonts/          JetBrains Mono, self-hosted (OFL)
    ├── css/tool.css    Shared look (same tokens as shaikhismail.com)
    ├── js/common.js    Theme toggle, drop zone, download helpers, Turnstile gate
    ├── js/pdf-engine.js Scanned/digital detection, compress, enhance (same file in pdf-split and pdf-merge)
    ├── js/app.js       The tool's page logic
    └── vendor/         Third-party libraries, saved locally (no CDN)
scripts/bump_version.py Release helper
.github/workflows/pages.yml  Publishes public/ to tools.shaikhismail.com/pdf-split/
```

Third-party libraries, all saved in `public/assets/vendor/` (no CDN): [pdf-lib](https://pdf-lib.js.org) 1.17.1 (MIT) to read and write PDFs, [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 legacy build (Apache-2.0) to read page text and draw pages, [fflate](https://github.com/101arrowz/fflate) 0.8.2 (MIT) for zip files and image compression.

`pdf-engine.js` is shared with the other PDF tool: when you change it, copy it to both repos.

## How it is hosted

GitHub Pages, for free. Every push to `main` publishes `public/` (see `.github/workflows/pages.yml`).
Because the user site [mdism.github.io](https://github.com/mdism/mdism.github.io) has the custom domain tools.shaikhismail.com,
this repo appears at https://tools.shaikhismail.com/pdf-split/ automatically.

One-time, in this repo on GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **About (gear icon on the repo page) → Topics:** add `shaikhismail-tool`. That is what puts the tool on the landing page.

The repo name is the URL path, so keep it as `pdf-split`.

## Privacy and security

Nothing is uploaded, saved or tracked: see [PRIVACY.md](PRIVACY.md) (also published as `privacy.html`) and [SECURITY.md](SECURITY.md).

## Releasing

The version shows in the footer and links to CHANGELOG.md. Before each release:

```
python scripts/bump_version.py 1.4.0 "What changed"
```

## License

MIT, see [LICENSE](LICENSE).
