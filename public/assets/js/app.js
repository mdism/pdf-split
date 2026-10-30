/* PDF Split: tool logic. Runs only in the browser; never send the user's data anywhere. */
(function () {
  const { dropZone, formatBytes, vetFiles, say } = window.Tool;
  const $ = s => document.querySelector(s);

  dropZone($('#drop'), async files => {
    // Pick the kinds this tool accepts: 'jpeg', 'png', 'webp', 'pdf' (see common.js).
    const { ok, problems } = await vetFiles(files, { kinds: ['jpeg', 'png', 'webp', 'pdf'], maxMB: 40, maxCount: 1 });
    if (!ok.length) return say($('#out'), problems.join(' '));
    say($('#out'), `${ok[0].name} · ${formatBytes(ok[0].size)}. Replace this with what the tool does.`);
  });
})();
