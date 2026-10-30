/* PDF Split: picks pages out of one PDF and hands them to the shared engine. Runs only in the browser. */
(function () {
  const { dropZone, formatBytes, download, baseName, vetFiles, say } = window.Tool;
  const Engine = window.PdfEngine;
  const $ = s => document.querySelector(s);
  const card = $('#card'), drop = $('#drop'), err = $('#err'), status = $('#status');
  const readOpts = Engine.optionsPanel($('#opts'));
  let src = null, mode = 'extract';

  const HINTS = {
    extract: 'Commas between parts, dashes for ranges, "end" for the last page. All of them go into one PDF, in the order you type.',
    ranges: 'Each part becomes its own PDF, e.g. 1-3, 4-6, 7-end gives three files.',
  };

  dropZone(drop, async files => {
    const { ok, problems } = await vetFiles(files.slice(0, 1), { kinds: ['pdf'], maxMB: 150, maxCount: 1 });
    say(err, problems.join(' '));
    say(status, '');
    if (!ok[0]) { card.hidden = false; return; }
    try {
      Engine.close(src);
      src = await Engine.open(ok[0]);
    } catch (e) { src = null; card.hidden = false; return say(err, e.message); }
    $('#fileName').textContent = src.file.name;
    const info = `${formatBytes(src.file.size)} · ${src.pages} page${src.pages > 1 ? 's' : ''}`;
    $('#fileInfo').textContent = info + ' · checking pages…';
    const mine = src;
    Engine.pageTypes(src).then(
      types => { if (src === mine) $('#fileInfo').textContent = `${info} · ${Engine.describeTypes(types)}`; },
      () => { if (src === mine) $('#fileInfo').textContent = info; });
    $('#range').value = '';
    card.hidden = false; drop.hidden = true;
  });

  $('#again').addEventListener('click', () => {
    Engine.close(src);
    src = null; card.hidden = true; drop.hidden = false; say(err, ''); say(status, '');
  });

  function setMode(m) {
    mode = m;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === m));
    $('#modeRange').hidden = !(m === 'extract' || m === 'ranges');
    $('#modeChunks').hidden = m !== 'chunks';
    $('#rangeHint').textContent = HINTS[m] || '';
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode('extract');

  /** "1-3, 5, 9-7" → [[0,1,2],[4],[8,7,6]] (zero-based, one list per part). Throws on anything out of range. */
  function parseRanges(text, count) {
    const parts = text.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Type the pages you want, for example 1-3, 5.');
    return parts.map(part => {
      const m = part.match(/^(\d+|end)\s*(?:-\s*(\d+|end))?$/i);
      if (!m) throw new Error(`"${part}" is not a page or range.`);
      const num = s => (s.toLowerCase() === 'end' ? count : +s);
      const a = num(m[1]), b = m[2] ? num(m[2]) : a;
      if (a < 1 || b < 1 || a > count || b > count) throw new Error(`Page ${Math.max(a, b)} does not exist. This PDF has ${count} pages.`);
      const step = a <= b ? 1 : -1, out = [];
      for (let p = a; p !== b + step; p += step) out.push(p - 1);
      return out;
    });
  }

  function groupsFor(count) {
    if (mode === 'extract') return [parseRanges($('#range').value, count).flat()];
    if (mode === 'ranges') return parseRanges($('#range').value, count);
    const size = mode === 'each' ? 1 : Math.max(1, parseInt($('#chunk').value, 10) || 1);
    const groups = [];
    for (let i = 0; i < count; i += size) groups.push([...Array(Math.min(size, count - i)).keys()].map(k => k + i));
    return groups;
  }

  const label = g => (g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`);

  $('#go').addEventListener('click', async () => {
    if (!src) return;
    const btn = $('#go'), text = btn.textContent;
    say(err, ''); say(status, '');
    const name = baseName(src.file.name), opts = readOpts();
    let groups;
    try { groups = groupsFor(src.pages); } catch (e) { return say(err, e.message); }

    btn.disabled = true; btn.textContent = 'Working…';
    try {
      const files = [];
      for (const [n, g] of groups.entries()) {
        const prefix = groups.length > 1 ? `File ${n + 1} of ${groups.length}: ` : '';
        const bytes = await Engine.build([{ src, indices: g }], opts, line => say(status, prefix + line));
        files.push([groups.length === 1 && mode === 'extract' ? `${name}-pages.pdf` : `${name}-page-${label(g)}.pdf`, bytes]);
      }
      const size = files.reduce((s, [, b]) => s + b.length, 0);
      if (files.length === 1) {
        download(new Blob([files[0][1]], { type: 'application/pdf' }), files[0][0]);
      } else {
        const zip = {};
        for (const [fname, bytes] of files) zip[fname] = [bytes, { level: 0 }];
        download(new Blob([window.fflate.zipSync(zip)], { type: 'application/zip' }), `${name}-split.zip`);
      }
      say(status, `Done: ${files.length} file${files.length > 1 ? 's' : ''}, ${formatBytes(size)} in total (the original is ${formatBytes(src.file.size)}).`);
    } catch (e) {
      say(status, '');
      say(err, e.message || 'Something went wrong while splitting.');
    }
    btn.textContent = text; btn.disabled = false;
  });
})();
