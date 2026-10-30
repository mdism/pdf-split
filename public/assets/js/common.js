/* Shared helpers for the shaikhismail.com free tools: theme toggle, drop zones, downloads. */
(function () {
  // GitHub Pages can't send X-Frame-Options, so refuse to run inside someone else's frame (clickjacking).
  // Browsers may block the redirect, so the page is hidden either way.
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    try { window.top.location = window.self.location.href; } catch (e) { /* stay hidden */ }
    return;
  }

  const root = document.documentElement;
  const KEY = 'theme';
  try { const t = localStorage.getItem(KEY); if (t) root.dataset.theme = t; } catch (e) {}

  const btn = document.getElementById('themeBtn');
  if (btn) {
    const isDark = () => root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const paint = () => { btn.textContent = isDark() ? '☀' : '☾'; btn.title = isDark() ? 'Light theme' : 'Dark theme'; };
    btn.addEventListener('click', () => {
      root.dataset.theme = isDark() ? 'light' : 'dark';
      try { localStorage.setItem(KEY, root.dataset.theme); } catch (e) {}
      paint();
    });
    paint();
  }

  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  /** Wire a <label class="drop"> containing an <input type=file> to a callback receiving File[]. */
  function dropZone(label, onFiles) {
    const input = label.querySelector('input[type=file]');
    input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => label.addEventListener(ev, e => { e.preventDefault(); label.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => label.addEventListener(ev, e => { e.preventDefault(); label.classList.remove('over'); }));
    label.addEventListener('drop', e => { if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

  /* Real file type from the first bytes, so a renamed .exe or a broken file is refused before we parse it. */
  const SIGNATURES = {
    jpeg: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
    png:  b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
    webp: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
    pdf:  b => { for (let i = 0; i + 4 < b.length; i++) if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2D) return true; return false; },
  };

  const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', pdf: 'PDF' };
  const listKinds = k => k.length > 1 ? k.slice(0, -1).map(x => LABEL[x]).join(', ') + ' or ' + LABEL[k[k.length - 1]] : LABEL[k[0]];

  /**
   * Keep only files that really are one of `kinds`, are under `maxMB`, and fit in `maxCount`.
   * Returns { ok: File[], problems: string[] } with plain-language reasons for anything refused.
   */
  async function vetFiles(files, { kinds, maxMB, maxCount }) {
    const ok = [], problems = [];
    for (const f of files) {
      if (ok.length >= maxCount) { problems.push(`Only ${maxCount} files at a time, so the rest were skipped.`); break; }
      if (f.size > maxMB * 1024 * 1024) { problems.push(`${f.name} is larger than ${maxMB} MB.`); continue; }
      const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
      if (!kinds.some(k => SIGNATURES[k](head))) { problems.push(`${f.name} is not a ${listKinds(kinds)} file.`); continue; }
      ok.push(f);
    }
    return { ok, problems };
  }

  /** Show a message in `el` as plain text (never HTML), or hide it when empty. */
  function say(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  window.Tool = { dropZone, formatBytes, download, baseName, vetFiles, say };

  /* ============ BOT CHECK (Cloudflare Turnstile) ============
     The tool stays locked until Turnstile passes AND our verify Worker confirms the token with Cloudflare.
     The Worker's address lives in one place, /api/config.json on the landing site, so it is never repeated per tool.
     Nothing is stored: the check runs again on every page load. */
  const SITE_KEY = /(^|\.)shaikhismail\.com$/.test(location.hostname)
    ? '0x4AAAAAAFn0JTqaGdgJmHqL'   // production key (public by design; the secret stays on the server)
    : '1x00000000000000000000AA';  // Cloudflare's always-pass test key for local development
  const area = document.querySelector('[data-gated]');
  const gate = document.getElementById('gate');

  if (area && gate) {
    const state = gate.querySelector('.gate-state');
    const box = gate.querySelector('.gate-widget');
    const lock = on => { area.inert = on; area.classList.toggle('locked', on); };
    const tell = (text, cls) => { state.textContent = text; state.className = 'gate-state ' + (cls || ''); };

    if (location.protocol === 'file:') {
      gate.hidden = true; // opened straight from disk while developing: no server to verify against
    } else {
      lock(true);
      let widgetId = null;

      const verifyUrl = fetch('/api/config.json', { credentials: 'omit', cache: 'no-cache' })
        .then(r => r.json()).then(c => c.verifyUrl);

      const verify = token => {
        tell('Checking…');
        verifyUrl
          .then(url => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), credentials: 'omit', cache: 'no-store' }))
          .then(r => r.json())
          .then(res => {
            if (!res.ok) throw new Error('rejected');
            lock(false);
            tell('✓ Verified. You can use the tool.', 'good');
            setTimeout(() => { gate.hidden = true; }, 1800);
          })
          .catch(() => {
            tell('The check did not pass. Please try again.', 'err');
            if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
          });
      };

      window.__onTurnstileLoad = () => {
        widgetId = window.turnstile.render(box, {
          sitekey: SITE_KEY,
          theme: 'auto',
          callback: verify,
          'expired-callback': () => tell('The check expired. Please tick it again.', 'warn'),
          'error-callback': () => { tell('The bot check could not run. Reload the page, or turn off blockers for this site.', 'err'); return true; },
        });
        tell('Complete the check to unlock the tool. It usually passes on its own.');
      };

      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__onTurnstileLoad';
      s.async = true;
      s.onerror = () => tell('The bot check could not load. Check your connection, or turn off blockers for this site, then reload.', 'err');
      document.head.appendChild(s);
    }
  }
})();
