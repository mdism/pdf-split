# Security

This tool is a static page on GitHub Pages at https://tools.shaikhismail.com/pdf-split/: no server code, no database, no forms, no uploads.
Files and inputs are processed only in the visitor's browser.

## What protects it

- **Content Security Policy** (a `<meta>` tag in each page): only scripts, styles, fonts and images from this site and Cloudflare Turnstile can load, and the page may only talk to this site and the bot-check Worker (`connect-src 'self' https://*.workers.dev`).
- **Bot check**: Cloudflare Turnstile must pass before the tool unlocks. A Cloudflare Worker (code in the [mdism.github.io](https://github.com/mdism/mdism.github.io) repo) confirms each token with Cloudflare, checks the hostname and origin, and stores nothing. The Turnstile secret lives only in Cloudflare, never in a repo.
- **HTTPS only**: enforced by GitHub Pages.
- **No framing**: the page refuses to run inside another site's frame (clickjacking).
- **No other third parties**: libraries and the font are served from this repo, not a CDN. No analytics, no cookies set by us.
- **In the code**: user-supplied text is always written with `textContent`, never as HTML; use `Tool.vetFiles()` to check files by their real signature and size before reading them.

## Reporting a problem

Email hello@shaikhismail.com. Please do not open a public issue for a security problem.
