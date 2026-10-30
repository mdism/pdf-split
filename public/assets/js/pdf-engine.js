/* PDF engine shared by PDF Split and PDF Merge: tells scanned pages from digital ones and writes pages
   out as they are, compressed or enhanced. pdf-lib copies and writes pages; pdf.js draws pages that are
   turned into fresh images. Everything happens in this tab and nothing is sent anywhere. */
(function () {
  const L = window.PDFLib;
  const { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFNumber, PDFBool, PDFRef } = L;
  const N = s => PDFName.of(s);
  const VENDOR = new URL('assets/vendor/pdfjs/', document.baseURI).href;
  const MAX_PX = 14e6;          // largest canvas we draw (phones refuse much more)
  const TEXT_CHARS = 20;        // fewer readable characters than this and the page counts as scanned

  /** Strength presets. dpi: resolution scanned pages are redrawn at. maxPx: longest side kept for pictures. */
  const COMPRESS = {
    light:    { dpi: 150, q: 0.80, maxPx: 2400 },
    balanced: { dpi: 120, q: 0.65, maxPx: 1800 },
    strong:   { dpi: 96,  q: 0.50, maxPx: 1300 },
  };
  const ENHANCE = {
    standard: { dpi: 200, q: 0.85 },
    high:     { dpi: 300, q: 0.90 },
  };

  let pdfjsLoad = null;
  function pdfjs() {
    if (!pdfjsLoad) pdfjsLoad = import(VENDOR + 'pdf.min.js').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.js';
      return lib;
    }, () => {
      pdfjsLoad = null;
      throw new Error('The PDF reader could not load. Check your connection and reload the page.');
    });
    return pdfjsLoad;
  }

  /* ---------- opening ---------- */

  /** Read a File into { file, lib } (pdf-lib). pdf.js and the page types load later, only when needed. */
  async function open(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let lib;
    try {
      lib = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      if (/encrypt/i.test(e.message)) throw new Error(`"${file.name}" is password-protected. Remove the password first, then try again.`);
      throw new Error(`"${file.name}" could not be read as a PDF.`);
    }
    return { file, bytes, lib, pages: lib.getPageCount(), js: null, types: null };
  }

  function jsDoc(src) {
    if (!src.js) src.js = pdfjs().then(lib => lib.getDocument({
      data: src.bytes.slice(),           // pdf.js hands its copy to the worker
      isEvalSupported: false,
      standardFontDataUrl: VENDOR + 'standard_fonts/',
      cMapUrl: VENDOR + 'cmaps/',
      cMapPacked: true,
    }).promise);
    return src.js;
  }

  function close(src) {
    if (src && src.js) src.js.then(d => d.destroy()).catch(() => {});
  }

  /* ---------- scanned or digital ---------- */

  /** Image streams a page draws (including ones inside forms), as [ref, stream] pairs. */
  function pageImages(resources, depth = 0, found = []) {
    if (!(resources instanceof PDFDict) || depth > 4) return found;
    const xo = resources.lookup(N('XObject'));
    if (!(xo instanceof PDFDict)) return found;
    for (const [, ref] of xo.entries()) {
      const obj = xo.context.lookup(ref);
      const dict = obj && obj.dict;
      if (!(dict instanceof PDFDict)) continue;
      const type = dict.get(N('Subtype'));
      if (type === N('Image')) found.push([ref, obj]);
      else if (type === N('Form')) pageImages(dict.lookup(N('Resources')), depth + 1, found);
    }
    return found;
  }

  function isOneBit(dict) {
    const mask = dict.lookup(N('ImageMask')), bpc = dict.lookup(N('BitsPerComponent'));
    return (mask instanceof PDFBool && mask.asBoolean()) || (bpc instanceof PDFNumber && bpc.asNumber() === 1);
  }

  /**
   * 'scanned' or 'digital' for every page, worked out once per file. A page is scanned when it shows a
   * picture but has almost no real text (a scan that was OCR'd keeps its text, so it counts as digital).
   */
  function pageTypes(src, onProgress) {
    if (!src.types) src.types = (async () => {
      const doc = await jsDoc(src);
      const out = [];
      for (let i = 0; i < src.pages; i++) {
        let chars = 0;
        try {
          const page = await doc.getPage(i + 1);
          const text = await page.getTextContent();
          for (const it of text.items) chars += (it.str || '').replace(/\s+/g, '').length;
          page.cleanup();
        } catch (e) { /* unreadable text layer: decide by pictures alone */ }
        const hasPicture = pageImages(src.lib.getPage(i).node.Resources()).length > 0;
        out.push(chars < TEXT_CHARS && hasPicture ? 'scanned' : 'digital');
        if (onProgress) onProgress(i + 1, src.pages);
      }
      return out;
    })();
    else if (onProgress) src.types.then(t => onProgress(t.length, t.length));
    return src.types;
  }

  /* ---------- pixels ---------- */

  const luma = (d, i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;

  function toGray(d) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d, i);
  }

  /** Clean up a scanned page: black text darker, paper white, edges a little sharper. */
  function enhancePixels(img) {
    const d = img.data, total = d.length / 4;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[luma(d, i)]++;

    let acc = 0, black = 0;
    for (; black < 255; black++) { acc += hist[black]; if (acc > total * 0.005) break; }
    black = Math.min(black, 90);

    // The paper is the strongest bright tone; push it (and anything lighter) to white.
    let paper = 128;
    for (let v = 129; v < 256; v++) if (hist[v] > hist[paper]) paper = v;
    let white;
    if (hist[paper] > total * 0.02) white = paper - 10;
    else { acc = 0; for (white = 255; white > 0; white--) { acc += hist[white]; if (acc > total * 0.005) break; } }
    white = Math.max(white, black + 60);

    const lut = new Uint8ClampedArray(256), span = white - black;
    for (let v = 0; v < 256; v++) {
      const t = Math.min(1, Math.max(0, (v - black) / span));
      lut[v] = Math.round(255 * Math.pow(t, 1.15)); // a touch darker in the middle, so faint text reads
    }
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    sharpen(img, 0.5);
  }

  /** Light unsharp mask (cross-shaped Laplacian), skipping the 1px border. */
  function sharpen(img, amount) {
    const { width: w, height: h, data: d } = img;
    const src = new Uint8ClampedArray(d), row = w * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * row + x * 4;
        for (let c = 0; c < 3; c++) {
          const k = i + c, v = src[k];
          d[k] = v + amount * (4 * v - src[k - 4] - src[k + 4] - src[k - row] - src[k + row]);
        }
      }
    }
  }

  /** Otsu's threshold on gray pixels: the cut that best separates ink from paper. */
  function otsu(d) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
    const total = d.length / 4;
    let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
    let wB = 0, sumB = 0, best = 0, cut = 128;
    for (let v = 0; v < 256; v++) {
      wB += hist[v]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += v * hist[v];
      const diff = sumB / wB - (sum - sumB) / wF, between = wB * wF * diff * diff;
      if (between > best) { best = between; cut = v; }
    }
    return cut + 1;
  }

  /** 1-bit black-and-white image packed for PDF (1 = white in DeviceGray), zlib-compressed. */
  function packBits(img) {
    const { width: w, height: h, data: d } = img;
    const cut = otsu(d), rowBytes = (w + 7) >> 3, bits = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] >= cut) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
    return window.fflate.zlibSync(bits, { level: 9 });
  }

  const toJpeg = (canvas, q) => new Promise((res, rej) =>
    canvas.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error('This browser could not make the image.')), 'image/jpeg', q));

  /* ---------- redrawing a page as an image ---------- */

  /** Draw page i with pdf.js and return the finished image for the new PDF. */
  async function renderPage(src, i, opts) {
    const doc = await jsDoc(src);
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const preset = opts.mode === 'enhance' ? ENHANCE[opts.enhance] : COMPRESS[opts.level];
    let dpi = preset.dpi;
    if (opts.mode === 'enhance') dpi = Math.max(dpi, Math.min(opts.srcDpi || 0, 300));
    if (opts.color === 'bw') dpi = Math.max(dpi, 200); // 1-bit pages need more dots than grey ones to stay readable
    let scale = dpi / 72;
    const px = base.width * base.height * scale * scale;
    if (px > MAX_PX) scale *= Math.sqrt(MAX_PX / px);
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (opts.mode === 'enhance') enhancePixels(img);
    if (opts.color !== 'color') toGray(img.data);

    const out = { wPt: base.width, hPt: base.height, w: canvas.width, h: canvas.height };
    if (opts.color === 'bw') {
      out.bits = packBits(img);
      out.size = out.bits.length;
    } else {
      ctx.putImageData(img, 0, 0);
      out.jpeg = await toJpeg(canvas, preset.q);
      out.size = out.jpeg.length;
    }
    canvas.width = canvas.height = 0; // free the memory now, not at garbage collection
    return out;
  }

  /** Add a new page to `out` showing a rendered image across the whole page. */
  async function addImagePage(out, r, ours) {
    const page = out.addPage([r.wPt, r.hPt]);
    if (r.jpeg) {
      const im = await out.embedJpg(r.jpeg);
      ours.add(im.ref);
      page.drawImage(im, { x: 0, y: 0, width: r.wPt, height: r.hPt });
      return;
    }
    const dict = out.context.obj({
      Type: 'XObject', Subtype: 'Image', Width: r.w, Height: r.h,
      ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'FlateDecode',
    });
    const ref = out.context.register(PDFRawStream.of(dict, r.bits));
    ours.add(ref);
    const name = page.node.newXObject('Bw', ref);
    page.pushOperators(
      L.pushGraphicsState(),
      L.concatTransformationMatrix(r.wPt, 0, 0, r.hPt, 0, 0),
      L.drawObject(name),
      L.popGraphicsState(),
    );
  }

  /* ---------- shrinking pictures inside digital pages ---------- */

  function components(cs) {
    if (cs === N('DeviceRGB') || cs === N('CalRGB')) return 3;
    if (cs === N('DeviceGray') || cs === N('CalGray')) return 1;
    if (cs instanceof PDFArray) {
      const kind = cs.lookup(0);
      if (kind === N('CalRGB')) return 3;
      if (kind === N('CalGray')) return 1;
      if (kind === N('ICCBased')) {
        const n = cs.lookup(1) && cs.lookup(1).dict && cs.lookup(1).dict.lookup(N('N'));
        return n instanceof PDFNumber ? n.asNumber() : 0;
      }
    }
    return 0; // CMYK, indexed, separation and the like are left alone
  }

  /** Undo PNG row filters (Predictor 10-15), 8 bits per component. */
  function unpredict(data, w, h, comps) {
    const row = w * comps, out = new Uint8Array(row * h);
    if (data.length < (row + 1) * h) return null;
    for (let y = 0; y < h; y++) {
      const f = data[y * (row + 1)], s = y * (row + 1) + 1, o = y * row;
      for (let x = 0; x < row; x++) {
        const raw = data[s + x];
        const a = x >= comps ? out[o + x - comps] : 0;
        const b = y ? out[o - row + x] : 0;
        const c = x >= comps && y ? out[o - row + x - comps] : 0;
        let v;
        if (f === 0) v = raw;
        else if (f === 1) v = raw + a;
        else if (f === 2) v = raw + b;
        else if (f === 3) v = raw + ((a + b) >> 1);
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        else return null;
        out[o + x] = v;
      }
    }
    return out;
  }

  /** ASCII85Decode (the "<~ … ~>" text encoding some PDF makers wrap images in). */
  function ascii85(b) {
    const out = new Uint8Array(Math.ceil(b.length * 4 / 5) + 4);
    let n = 0, cnt = 0, o = 0, i = 0;
    if (b[0] === 0x3c && b[1] === 0x7e) i = 2;
    const put = (v, k) => { for (let s = 0; s < k; s++) out[o++] = (v >>> (24 - 8 * s)) & 255; };
    for (; i < b.length; i++) {
      const c = b[i];
      if (c === 0x7e) break;
      if (c <= 0x20) continue;
      if (c === 0x7a && cnt === 0) { put(0, 4); continue; }
      if (c < 33 || c > 117) return null;
      n = n * 85 + (c - 33);
      if (++cnt === 5) { put(n, 4); n = 0; cnt = 0; }
    }
    if (cnt) { for (let k = cnt; k < 5; k++) n = n * 85 + 84; put(n, cnt - 1); }
    return out.subarray(0, o);
  }

  /** ASCIIHexDecode. */
  function asciiHex(b) {
    const out = new Uint8Array((b.length >> 1) + 1);
    let o = 0, hi = -1;
    for (const c of b) {
      if (c === 0x3e) break;
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v < 0) continue;
      if (hi < 0) hi = v; else { out[o++] = hi * 16 + v; hi = -1; }
    }
    if (hi >= 0) out[o++] = hi * 16;
    return out.subarray(0, o);
  }

  /** Turn one image stream into something drawable, or null when it is a kind we don't touch. */
  async function decodeImage(stream, w, h, comps) {
    const dict = stream.dict, ctx = dict.context;
    let filters = dict.lookup(N('Filter'));
    filters = filters instanceof PDFArray ? filters.asArray().map(f => ctx.lookup(f)) : filters ? [filters] : [];
    let parms = dict.lookup(N('DecodeParms'));
    let data = stream.contents;

    for (let k = 0; k < filters.length && data; k++) {
      const f = filters[k], last = k === filters.length - 1;
      if (f === N('ASCII85Decode')) data = ascii85(data);
      else if (f === N('ASCIIHexDecode')) data = asciiHex(data);
      else if (f === N('DCTDecode') && last) return createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
      else if (f === N('FlateDecode') && last) {
        data = window.fflate.unzlibSync(data);
        const p = parms instanceof PDFArray ? ctx.lookup(parms.get(k)) : parms;
        if (p instanceof PDFDict) {
          const pred = p.lookup(N('Predictor'));
          const v = pred instanceof PDFNumber ? pred.asNumber() : 1;
          if (v >= 10) data = unpredict(data, w, h, comps);
          else if (v !== 1) return null;
        }
      } else return null;
    }
    if (!data || !filters.length) return null;

    const bpc = dict.lookup(N('BitsPerComponent'));
    if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8 || data.length < w * h * comps) return null;
    const img = new ImageData(w, h), d = img.data;
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      const k = i * 4;
      if (comps === 3) { d[k] = data[j]; d[k + 1] = data[j + 1]; d[k + 2] = data[j + 2]; }
      else d[k] = d[k + 1] = d[k + 2] = data[j];
      d[k + 3] = 255;
    }
    return createImageBitmap(img);
  }

  /** Re-save large pictures in `out` as smaller JPEGs. Text, drawings and our own new images are untouched. */
  async function shrinkPictures(out, opts, ours, onProgress) {
    const preset = COMPRESS[opts.level];
    const masks = new Set();
    const images = [];
    for (const [ref, obj] of out.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype')) !== N('Image')) continue;
      for (const key of ['SMask', 'Mask']) { const m = obj.dict.get(N(key)); if (m instanceof PDFRef) masks.add(m.tag); }
      images.push([ref, obj]);
    }
    let n = 0;
    for (const [ref, stream] of images) {
      if (onProgress) onProgress(++n, images.length);
      if (ours.has(ref) || masks.has(ref.tag)) continue;
      const dict = stream.dict;
      const isMask = dict.lookup(N('ImageMask'));
      if ((isMask instanceof PDFBool && isMask.asBoolean()) || dict.has(N('Decode')) || dict.has(N('Matte'))) continue;
      const wN = dict.lookup(N('Width')), hN = dict.lookup(N('Height'));
      if (!(wN instanceof PDFNumber) || !(hN instanceof PDFNumber)) continue;
      const w = wN.asNumber(), h = hN.asNumber();
      if (w * h < 40000) continue; // icons and logos: not worth it
      const comps = components(dict.lookup(N('ColorSpace')));
      if (comps !== 1 && comps !== 3) continue;

      let bmp;
      try { bmp = await decodeImage(stream, w, h, comps); } catch (e) { bmp = null; }
      if (!bmp) continue;

      const k = Math.min(1, preset.maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      const ctx = canvas.getContext('2d', { willReadFrequently: opts.color !== 'color' });
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      if (opts.color !== 'color' || comps === 1) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        toGray(img.data);
        ctx.putImageData(img, 0, 0);
      }
      let jpeg;
      try { jpeg = await toJpeg(canvas, preset.q); } catch (e) { continue; }
      const cw = canvas.width, ch = canvas.height;
      canvas.width = canvas.height = 0;
      if (jpeg.length >= stream.contents.length * 0.9) continue; // not worth losing quality for

      const nd = dict.clone(out.context);
      nd.set(N('Filter'), N('DCTDecode'));
      nd.delete(N('DecodeParms'));
      nd.set(N('Width'), PDFNumber.of(cw));
      nd.set(N('Height'), PDFNumber.of(ch));
      nd.set(N('BitsPerComponent'), PDFNumber.of(8));
      nd.set(N('ColorSpace'), N('DeviceRGB'));
      nd.delete(N('Length'));
      out.context.assign(ref, PDFRawStream.of(nd, jpeg));
    }
  }

  /* ---------- building the output ---------- */

  /**
   * Make one PDF from `parts`: [{ src, indices }] (zero-based page numbers, in output order).
   * opts: { mode: original|compress|enhance, level, enhance, color: color|gray|bw, pageType: auto|scanned|digital }
   * onProgress(text) gets short status lines. Returns the PDF bytes.
   */
  async function build(parts, opts, onProgress = () => {}) {
    const out = await PDFDocument.create();
    const ours = new Set();
    const total = parts.reduce((s, p) => s + p.indices.length, 0);
    let done = 0;

    for (const { src, indices } of parts) {
      let types = null;
      if (opts.mode !== 'original' && opts.pageType === 'auto') {
        types = await pageTypes(src, (a, b) => onProgress(`Checking pages ${a} of ${b}…`));
      }
      // Decide every page first, then copy the kept ones in one go so shared fonts are copied once.
      const plan = [];
      for (const i of indices) {
        onProgress(`Page ${++done} of ${total}…`);
        const redraw = opts.mode !== 'original' && opts.pageType !== 'digital' && (opts.pageType === 'scanned' || types[i] === 'scanned');
        let img = null;
        if (redraw) {
          const pics = pageImages(src.lib.getPage(i).node.Resources());
          // A black-and-white scan (1 bit per pixel) stays black and white: colour would only make it bigger.
          const oneBit = pics.length > 0 && pics.every(([, st]) => isOneBit(st.dict));
          // Enhancing never lowers the resolution the scan already has (up to 300 dpi).
          const pg = src.lib.getPage(i), longPt = Math.max(pg.getWidth(), pg.getHeight());
          const srcDpi = Math.max(0, ...pics.map(([, st]) => {
            const w = st.dict.lookup(N('Width')), h = st.dict.lookup(N('Height'));
            return w instanceof PDFNumber && h instanceof PDFNumber ? Math.max(w.asNumber(), h.asNumber()) / (longPt / 72) : 0;
          }));
          img = await renderPage(src, i, { ...opts, srcDpi, color: oneBit ? 'bw' : opts.color });
          if (opts.mode === 'compress') {
            // Only use the redrawn page if it is really smaller than the pictures it replaces.
            const before = pics.reduce((s, [, st]) => s + (st.contents ? st.contents.length : 0), 0);
            if (img.size >= before) img = null;
          }
        }
        plan.push({ i, img });
      }
      const keep = plan.filter(p => !p.img).map(p => p.i);
      const copied = keep.length ? await out.copyPages(src.lib, keep) : [];
      let k = 0;
      for (const p of plan) {
        if (p.img) await addImagePage(out, p.img, ours);
        else out.addPage(copied[k++]);
      }
    }

    if (opts.mode === 'compress') await shrinkPictures(out, opts, ours, (a, b) => onProgress(`Compressing pictures ${a} of ${b}…`));
    onProgress('Saving…');
    return out.save({ useObjectStreams: true });
  }

  /* ---------- the options panel (same markup in both tools) ---------- */

  const HINTS = {
    original: 'Pages are copied exactly as they are. Fastest, nothing changes.',
    compress: 'Makes the file smaller. Scanned pages are redrawn at a lower resolution and big pictures are re-saved; text in digital pages stays sharp and selectable.',
    enhance: 'Cleans up scanned pages: whiter paper, darker text, sharper edges. Digital pages are already sharp, so they are kept as they are.',
  };

  /** Wire the options card. Returns a function that reads the current choices. */
  function optionsPanel(root) {
    const opts = { mode: 'original', level: 'balanced', enhance: 'standard', color: 'color', pageType: 'auto' };
    const q = s => root.querySelector(s);
    const paint = () => {
      q('[data-show=compress]').hidden = opts.mode !== 'compress';
      q('[data-show=enhance]').hidden = opts.mode !== 'enhance';
      q('[data-show=changed]').hidden = opts.mode === 'original';
      q('.hint').textContent = HINTS[opts.mode];
    };
    root.querySelectorAll('.seg[data-opt]').forEach(seg => seg.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      opts[seg.dataset.opt] = b.dataset.v;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      paint();
    }));
    root.querySelectorAll('select[data-opt]').forEach(sel => sel.addEventListener('change', () => { opts[sel.dataset.opt] = sel.value; }));
    paint();
    return () => ({ ...opts });
  }

  /** "12 pages · 10 scanned, 2 digital" */
  function describeTypes(types) {
    const s = types.filter(t => t === 'scanned').length, d = types.length - s;
    if (!s) return 'digital (text)';
    if (!d) return 'scanned (image)';
    return `${s} scanned, ${d} digital`;
  }

  window.PdfEngine = { open, close, pageTypes, build, optionsPanel, describeTypes };
})();
