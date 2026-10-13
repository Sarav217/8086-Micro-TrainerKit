/* 8086 Trainer Kit Simulator - user interface */
(function () {
  'use strict';
  const { Trainer, REGNAMES, hex } = window.TrainerKit;
  const ASM = window.Asm8086;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const h4 = (v) => hex(v, 4), h2 = (v) => hex(v, 2);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  const parseHex = (s) => { const v = parseInt(String(s).trim().replace(/h$/i, ''), 16); return isNaN(v) ? null : v; };

  /* ===================== settings / machine ===================== */
  const DEFAULTS = { clockHz: 5000000, ramKB: 64, ppi1: 0x00, ppi2: 0x08, lcdBase: 0x10, powerOnRam: 'zero', strictLcd: false, stackTop: 0x7FFE, defaultSeg: 0x0000, defaultOff: 0x8000, monitor: 'console' };
  let cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(store.get('s8086_cfg', '{}'))); } catch (e) { /* ignore */ }
  const M = new Trainer(cfg);
  window.M = M; // handy for experimenting in the browser console
  let speedSetting = 1;
  let paused = false;
  let typingToken = 0;
  let dirty = true, inspDirty = true;
  let lastAsm = null;
  M.listeners.push(() => { dirty = true; inspDirty = true; });

  function applySpeed() { M.cfg.speed = speedSetting === 'max' ? Infinity : speedSetting; }

  /* ===================== board graphic ===================== */
  function buildBoard() {
    const chip = (x, y, w, h, name, sub) => {
      let pins = '';
      const n = Math.max(4, Math.floor((w - 10) / 11));
      for (let i = 0; i < n; i++) {
        const px = x + 6 + i * ((w - 12) / n);
        pins += `<rect x="${px.toFixed(1)}" y="${y - 5}" width="6" height="6" fill="#c9c9c0"/><rect x="${px.toFixed(1)}" y="${y + h - 1}" width="6" height="6" fill="#c9c9c0"/>`;
      }
      return `<g>${pins}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#15181c" stroke="#000"/>` +
        `<path d="M${x},${y + h / 2 - 6} a6,6 0 0 1 0,12" fill="#2a2e34"/>` +
        `<text x="${x + w / 2}" y="${y + h / 2 - 1}" text-anchor="middle" fill="#d8dce2" font-family="monospace" font-size="12" font-weight="bold">${name}</text>` +
        `<text x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle" fill="#8d96a3" font-family="monospace" font-size="9">${sub || ''}</text></g>`;
    };
    const header = (x, y, label, n) => {
      let p = '';
      for (let i = 0; i < n; i++) p += `<rect x="${x + 4 + i * 8}" y="${y + 4}" width="5" height="5" fill="#d6b34a"/><rect x="${x + 4 + i * 8}" y="${y + 13}" width="5" height="5" fill="#d6b34a"/>`;
      return `<g><rect x="${x}" y="${y}" width="${n * 8 + 8}" height="22" fill="#0e0e0e" stroke="#000"/>${p}` +
        `<text x="${x}" y="${y - 5}" fill="#e8f0d8" font-family="monospace" font-size="10">${label}</text></g>`;
    };
    let traces = '';
    for (let i = 0; i < 14; i++) traces += `<path d="M0,${195 + i * 20} H900" stroke="#0f4f29" stroke-width="1" opacity=".5"/>`;
    const svg = `<svg viewBox="0 0 900 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="8086 trainer board">
      <rect width="900" height="470" fill="#1b6b3a"/>${traces}
      <rect x="6" y="6" width="888" height="458" rx="10" fill="none" stroke="#e8f0d8" stroke-width="1.5" opacity=".6"/>
      <circle cx="20" cy="20" r="6" fill="#0b2e18"/><circle cx="880" cy="20" r="6" fill="#0b2e18"/><circle cx="20" cy="450" r="6" fill="#0b2e18"/><circle cx="880" cy="450" r="6" fill="#0b2e18"/>
      <text x="450" y="188" text-anchor="middle" fill="#e8f0d8" font-family="Georgia,serif" font-size="22" font-weight="bold" letter-spacing="2">SASTHA'S 8086 TRAINER</text>
      <rect x="205" y="158" width="490" height="2" fill="#e8f0d8" opacity=".5"/>
      <g id="rstBtn" style="cursor:pointer" tabindex="0" role="button" aria-label="RESET button">
        <rect x="808" y="40" width="56" height="56" rx="6" fill="#0b2e18"/><circle cx="836" cy="68" r="19" fill="#8e1f17" stroke="#000" stroke-width="2"/><circle id="rstCap" cx="836" cy="66" r="15" fill="#d9372b"/>
      </g>
      <text x="836" y="112" text-anchor="middle" fill="#e8f0d8" font-family="monospace" font-size="11">RESET</text>
      <circle id="ledPwr" cx="60" cy="50" r="6" fill="#ff3030"/><text x="75" y="54" fill="#e8f0d8" font-family="monospace" font-size="10">PWR</text>
      <circle id="ledRun" cx="60" cy="80" r="6" fill="#1d3a1d"/><text x="75" y="84" fill="#e8f0d8" font-family="monospace" font-size="10">RUN</text>
      <circle id="ledHalt" cx="60" cy="110" r="6" fill="#3a2d10"/><text x="75" y="114" fill="#e8f0d8" font-family="monospace" font-size="10">HALT</text>
      ${chip(30, 215, 200, 56, 'D8086AC-2', 'CPU')}${chip(250, 215, 80, 56, '8284', 'CLOCK')}${chip(350, 215, 80, 56, '74HC138', 'DECODER')}
      ${chip(450, 215, 80, 56, '74LS373', 'LATCH')}${chip(550, 215, 80, 56, '74LS373', 'LATCH')}${chip(650, 215, 90, 56, '74LS245', 'BUFFER')}
      <rect x="770" y="228" width="60" height="28" rx="8" fill="#b8bcc2" stroke="#555"/><text x="800" y="246" text-anchor="middle" font-family="monospace" font-size="10" fill="#222">15MHz</text>
      ${chip(30, 300, 170, 56, '27C256', 'MONITOR EPROM')}${chip(220, 300, 170, 56, '27C256', 'MONITOR EPROM')}
      ${chip(410, 300, 170, 56, '62256', 'RAM  32K')}${chip(600, 300, 170, 56, '62256', 'RAM  32K')}
      ${chip(30, 385, 170, 56, '82C55', 'PPI  #1')}${chip(220, 385, 170, 56, '82C55', 'PPI  #2')}
      ${header(430, 395, 'J6  PORT A/B/C  (PPI 1)', 20)}${header(430, 430, 'J8  PORT A/B/C  (PPI 2)', 20)}
      <text x="880" y="455" text-anchor="end" fill="#e8f0d8" font-family="monospace" font-size="9" opacity=".7">illustration, not to scale</text>
    </svg>`;
    $('#board').insertAdjacentHTML('afterbegin', svg);
    const rb = $('#rstBtn');
    const press = () => { cancelTyping(); paused = false; M.key('RESET'); };
    rb.addEventListener('click', press);
    rb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(); } });
  }

  /* ===================== LCD ===================== */
  const lcdCanvas = $('#lcd');
  const lcdCtx = lcdCanvas.getContext('2d');
  const DOT = 4, CW = 24, RH = 32, PADX = 6, PADY = 6, ROWGAP = 14;
  lcdCanvas.width = 16 * CW + 2 * PADX; lcdCanvas.height = 2 * RH + ROWGAP + 2 * PADY;
  function cgGlyph(code) {
    const base = (code & 7) * 8, cols = [0, 0, 0, 0, 0];
    for (let r = 0; r < 8; r++) { const b = M.lcd.cgram[base + r]; for (let c = 0; c < 5; c++) if (b & (1 << (4 - c))) cols[c] |= (1 << r); }
    return cols;
  }
  let lastBlink = -1;
  function renderLcd(t) {
    const L = M.lcd, ctx = lcdCtx, v = L.view();
    ctx.fillStyle = '#9db81c'; ctx.fillRect(0, 0, lcdCanvas.width, lcdCanvas.height);
    const phase = Math.floor(t / 500) % 2;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
      const code = v.rows[r][c];
      let cols = code < 16 ? cgGlyph(code) : window.LCDFont.glyph(code);
      const blinkHere = v.cursor && v.cursor.row === r && v.cursor.col === c;
      const inv = blinkHere && v.cursor.blink && phase === 1;
      const ux = PADX + c * CW, uy = PADY + r * (RH + ROWGAP);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 8; y++) {
        let on = !!(cols[x] & (1 << y)) && y < 7;
        if (blinkHere && v.cursor.underline && y === 7) on = true;
        if (inv && y < 7) on = true;
        ctx.fillStyle = on ? '#16240a' : 'rgba(60,85,10,0.14)';
        ctx.fillRect(ux + x * DOT, uy + y * DOT, DOT - 1, DOT - 1);
      }
    }
    L.dirty = false; lastBlink = phase;
  }

  /* ===================== keypad ===================== */
  const KEYS = [
    ['RESET', 'RESET', 'rst'], ['MEM', 'MEM', 'fn'], ['REG', 'REG', 'fn'], ['GO', 'GO', 'fn'], ['STEP', 'STEP', 'fn'], ['SEG', 'SEG', 'fn'], ['PREV', 'PREV', 'fn'], ['NEXT', 'NEXT', 'fn'],
    ...'01234567'.split('').map(k => [k, k, '']), ...'89ABCDEF'.split('').map(k => [k, k, '']),
    ['CLR', 'CLR', 'wide'], ['ENTER', 'ENTER', 'wide ent'],
  ];
  function buildKeypad() {
    const kp = $('#keypad');
    KEYS.forEach(([k, label, cls]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'key ' + cls; b.textContent = label; b.dataset.key = k;
      b.addEventListener('click', () => pressKey(k));
      kp.appendChild(b);
    });
  }
  function pressKey(k) {
    if (k === 'RESET') { cancelTyping(); paused = false; }
    else if (paused && M.mon.mode === 'RUN') return;
    M.key(k);
  }
  function flashKey(k) {
    const b = $(`#keypad [data-key="${k}"]`); if (!b) return;
    b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 110);
  }
  const KMAP = { Enter: 'ENTER', ArrowRight: 'NEXT', ArrowLeft: 'PREV', Delete: 'CLR', Backspace: 'CLR', Escape: 'RESET', ':': 'SEG', ';': 'SEG' };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($('#helpDlg').open) return;
    const tg = e.target, tag = tg && tg.tagName;
    if ((tag === 'INPUT' && tg.id !== 'kbCapture') || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    if (M.cfg.monitor === 'console') {
      let ck = null;
      if (e.key === 'Enter') ck = 'Enter'; else if (e.key === 'Backspace') ck = 'Backspace'; else if (e.key === 'Escape') ck = 'Esc';
      else if (e.key === 'Delete') ck = 'Clear'; else if (e.key.length === 1) ck = e.key;
      if (!ck) return;
      e.preventDefault();
      if (paused && M.mon.mode === 'RUN') return;
      M.con(ck); return;
    }
    let k = null;
    if (KMAP[e.key]) k = KMAP[e.key];
    else if (/^[0-9a-fA-F]$/.test(e.key)) k = e.key.toUpperCase();
    else if (/^[mMrRgGsS]$/.test(e.key)) k = { M: 'MEM', R: 'REG', G: 'GO', S: 'STEP' }[e.key.toUpperCase()];
    if (!k) return;
    e.preventDefault(); flashKey(k); pressKey(k);
  });

  const cap = $('#kbCapture');
  cap.addEventListener('input', () => {
    const v = cap.value; cap.value = '';
    if (M.cfg.monitor === 'console' && !(paused && M.mon.mode === 'RUN')) for (const ch of v) M.con(ch);
  });
  ['#board', '#lcdWindow'].forEach(sl => $(sl).addEventListener('click', () => { try { cap.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }));
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail > 0 && !b.closest('dialog')) setTimeout(() => b.blur(), 0); });
  function updateHint() {
    $('.keyhint').innerHTML = M.cfg.monitor === 'console'
      ? 'Type on your keyboard, right on the LCD: <b>A8000</b> Enter = enter a program (one instruction per line, empty line = finish), <b>G8000</b> = run, <b>M8500</b> = look at / change memory, <b>R</b> registers, <b>U8000</b> list program, <b>D</b> dump, <b>T</b> single-step. Numbers are hex. <b>Esc</b> leaves a prompt. The keypad keys type the same letters.'
      : 'Click the keys, or type on your keyboard: <b>0-9, A-F</b>, <b>M</b> MEM, <b>R</b> REG, <b>G</b> GO, <b>S</b> STEP, <b>Enter</b>, <b>&larr; &rarr;</b> PREV/NEXT, <b>:</b> SEG, <b>Del</b> CLR, <b>Esc</b> RESET.';
  }

  /* ===================== run controls ===================== */
  function cancelTyping() { typingToken++; }
  function doPause() {
    const m = M.mon;
    if (m.mode === 'RUN') { paused = !paused; M.status = paused ? 'PAUSED (click Resume to continue)' : `RUNNING ${h4(M.cpu.s[1])}:${h4(M.cpu.ip)}`; M.emit(); }
    else if (m.mode === 'HALT' && !M.cpu.halted && M.breakHit) { paused = false; M.startRun(M.cpu.s[1], M.cpu.ip); }
  }
  function doStep() {
    const m = M.mon, c = M.cpu;
    cancelTyping();
    if (m.mode === 'RUN') {
      paused = true; M.execOne();
      if (c.halted) M.onHaltInstruction();
      else if (m.mode === 'RUN') M.status = `PAUSED - stepped to ${h4(c.s[1])}:${h4(c.ip)}`;
      M.emit(); return;
    }
    if (c.halted) { M.status = 'CPU is halted. Press RESET.'; M.emit(); return; }
    if (m.mode === 'HALT') m.mode = 'STEP';
    if (m.mode !== 'STEP') M.key('STEP');
    M.key('STEP');
  }
  function prepareKit(res) {
    M.reset(false);
    M.loadImage(res.image);
    M.cpu.s[1] = res.entry.cs; M.cpu.ip = res.entry.ip;
  }
  function loadAndRun() {
    const res = assemble(true); if (!res) return;
    cancelTyping(); paused = false;
    try { prepareKit(res); } catch (e) { showMsgs([{ line: 0, msg: e.message }], null); return; }
    if (M.mon.con) { M.mon.con.goSeg = res.entry.cs; M.mon.con.goOff = res.entry.ip; }
    M.startRun(res.entry.cs, res.entry.ip);
  }
  function loadOnly() {
    const res = assemble(true); if (!res) return;
    cancelTyping(); paused = false;
    try { prepareKit(res); } catch (e) { showMsgs([{ line: 0, msg: e.message }], null); return; }
    if (M.cfg.monitor === 'console') { M.conNotice(`LOADED ${totalBytes(res)} BYTES`, res.entry.cs, res.entry.ip); M.status = `Loaded ${totalBytes(res)} bytes. Type G${h4(res.entry.ip)} and press Enter to run.`; M.emit(); return; }
    M.key('GO');
    M.mon.seg = res.entry.cs; M.mon.off = res.entry.ip; M.show();
    M.status = `Loaded ${totalBytes(res)} bytes. Press GO, GO to run.`; M.emit();
  }
  function totalBytes(res) { return res.image.reduce((a, c) => a + c.bytes.length, 0); }
  function typeIn() {
    const res = assemble(true); if (!res) return;
    cancelTyping(); paused = false;
    const token = typingToken;
    if (M.cfg.monitor === 'console') return typeInConsole(res, token);
    M.reset(false);
    M.cpu.s[1] = res.entry.cs; M.cpu.ip = res.entry.ip;
    const seq = [];
    const hexKeys = (v, n) => hex(v, n).split('');
    for (const ch of res.image) {
      if (!ch.bytes.length) continue;
      const seg = ch.segBase & 0xFFFF, off = ch.off & 0xFFFF;
      seq.push('MEM');
      if (seg !== 0) { seq.push('SEG', 'CLR', ...hexKeys(seg, 4).filter((_, i, a) => true), 'SEG'); }
      seq.push('CLR', ...hexKeys(off, 4), 'ENTER');
      ch.bytes.forEach((b) => { seq.push(...hexKeys(b, 2), 'NEXT'); });
    }
    seq.push('GO');
    let i = 0;
    const speedMs = ch => (seq.length > 400 ? 3 : seq.length > 120 ? 8 : 30);
    const stepFn = () => {
      if (token !== typingToken) return;
      if (i >= seq.length) {
        M.mon.seg = res.entry.cs; M.mon.off = res.entry.ip; M.show();
        M.status = `Typed ${totalBytes(res)} bytes. Press GO, GO to run.`; M.emit(); return;
      }
      const k = seq[i++]; flashKey(k); M.key(k);
      if (i % 20 === 0 || i === seq.length) M.status = `Typing in program... ${Math.round(i * 100 / seq.length)}%`;
      setTimeout(stepFn, speedMs());
    };
    stepFn();
  }

  function typeInConsole(res, token) {
    M.reset(false);
    M.cpu.s[1] = res.entry.cs; M.cpu.ip = res.entry.ip;
    const seq = [], hk = (v, n) => hex(v, n).split('');
    for (const ch of res.image) {
      if (!ch.bytes.length) continue;
      seq.push('M'); if ((ch.segBase & 0xFFFF) !== 0) seq.push(...hk(ch.segBase & 0xFFFF, 4), ':');
      seq.push(...hk(ch.off & 0xFFFF, 4), 'Enter');
      ch.bytes.forEach(b => seq.push(...hk(b, 2), 'Enter'));
      seq.push('Esc');
    }
    let i = 0;
    const delay = seq.length > 600 ? 2 : seq.length > 200 ? 6 : 25;
    const stepFn = () => {
      if (token !== typingToken) return;
      if (i >= seq.length) { M.conNotice(`TYPED ${totalBytes(res)} BYTES`, res.entry.cs, res.entry.ip); M.status = `Typed ${totalBytes(res)} bytes into memory. Type G${h4(res.entry.ip)} and press Enter to run.`; M.emit(); return; }
      M.con(seq[i++]); setTimeout(stepFn, delay);
    };
    stepFn();
  }

  /* ===================== editor ===================== */
  const src = $('#src'), gutter = $('#gutter');
  let errLines = new Set();
  function updateGutter() {
    const n = src.value.split('\n').length;
    let h = '';
    for (let i = 1; i <= n; i++) h += `<div${errLines.has(i) ? ' class="err"' : ''}>${i}</div>`;
    gutter.innerHTML = h; gutter.scrollTop = src.scrollTop;
  }
  src.addEventListener('input', () => { store.set('s8086_src', src.value); errLines = new Set(); updateGutter(); });
  src.addEventListener('scroll', () => { gutter.scrollTop = src.scrollTop; });
  src.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const s = src.selectionStart, t = src.selectionEnd;
      src.setRangeText('        ', s, t, 'end'); src.dispatchEvent(new Event('input'));
    }
  });
  const sel = $('#exampleSel');
  (function fillExamples() {
    const groups = {};
    window.EXAMPLES.forEach(ex => { (groups[ex.group] = groups[ex.group] || []).push(ex); });
    Object.keys(groups).forEach(g => {
      const og = document.createElement('optgroup'); og.label = g;
      groups[g].forEach(ex => { const o = document.createElement('option'); o.value = ex.id; o.textContent = ex.title; og.appendChild(o); });
      sel.appendChild(og);
    });
  })();
  sel.addEventListener('change', () => {
    const ex = window.EXAMPLES.find(e => e.id === sel.value); if (!ex) return;
    src.value = ex.source; store.set('s8086_src', src.value); store.set('s8086_ex', ex.id);
    errLines = new Set(); updateGutter(); lastAsm = null; showMsgs(null, null, 'Example loaded. Press "Run program", or "Type in with keypad" to see the kit way.');
  });
  function gotoLine(n) {
    const lines = src.value.split('\n'); let pos = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    src.focus(); src.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
    src.scrollTop = Math.max(0, (n - 4) * 18.75);
  }

  /* ---- assemble + outputs ---- */
  function assemble(quiet) {
    const seg = parseHex($('#loadSeg').value), off = parseHex($('#loadOff').value);
    store.set('s8086_seg', $('#loadSeg').value); store.set('s8086_off', $('#loadOff').value);
    let res;
    try { res = ASM.assemble(src.value, { loadSeg: seg === null ? 0 : seg, defaultOrg: off === null ? 0x8000 : off }); }
    catch (e) { res = { ok: false, errors: [{ line: 0, msg: 'Internal assembler error: ' + e.message }], listing: [], image: [] }; }
    lastAsm = res;
    errLines = new Set(res.errors.map(e => e.line));
    updateGutter();
    showMsgs(res.ok ? null : res.errors, res);
    if (!res.ok) { setOutTab('msgs'); return null; }
    if (!res.image.length || !totalBytes(res)) { showMsgs([{ line: 0, msg: 'The program produced no code.' }], res); return null; }
    return res;
  }
  let outTab = 'msgs', msgOverride = null;
  function setOutTab(t) {
    outTab = t;
    document.querySelectorAll('#outTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    renderOut();
  }
  function showMsgs(errors, res, text) {
    msgOverride = text || null; outTab = 'msgs';
    document.querySelectorAll('#outTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === 'msgs')));
    renderOut(errors);
  }
  function renderOut(errors) {
    const pane = $('#outPane'), res = lastAsm;
    if (!errors && res && !res.ok) errors = res.errors;
    if (outTab === 'msgs') {
      if (errors && errors.length) {
        pane.innerHTML = `<div class="bad">${errors.length} error${errors.length > 1 ? 's' : ''} - nothing was loaded</div>` +
          errors.map(e => `<div><a href="#" data-line="${e.line}" class="bad">${e.line ? 'Line ' + e.line + ': ' : ''}${esc(e.msg)}</a></div>`).join('');
        pane.querySelectorAll('a[data-line]').forEach(a => a.addEventListener('click', (ev) => { ev.preventDefault(); const n = +a.dataset.line; if (n) gotoLine(n); }));
      } else if (res && res.ok) {
        pane.innerHTML = `<div class="ok">Assembled with no errors.</div>` +
          `<div>${totalBytes(res)} bytes in ${res.image.length} block${res.image.length > 1 ? 's' : ''}; start address ${h4(res.entry.cs)}:${h4(res.entry.ip)}</div>` +
          res.image.map(c => `<div class="dim">${h4(c.segBase)}:${h4(c.off)}  (${hex(c.phys, 5)}h)  ${c.bytes.length} bytes</div>`).join('');
      } else pane.innerHTML = `<div class="dim">${esc(msgOverride || 'Write a program, then press Assemble, Run program or Load into kit.')}</div>`;
      return;
    }
    if (!res) { pane.innerHTML = '<div class="dim">Assemble the program first.</div>'; return; }
    if (outTab === 'listing') {
      pane.innerHTML = '<table><tr><th>Line</th><th>Addr</th><th>Bytes</th><th>Source</th></tr>' + res.listing.map(e => {
        const b = e.bytes.length ? e.bytes.slice(0, 8).map(h2).join(' ') + (e.bytes.length > 8 ? ' ..' : '') : '';
        const bad = errLines.has(e.no) ? ' class="lst-err"' : '';
        return `<tr${bad}><td class="dim">${e.no}</td><td>${e.bytes.length ? h4(e.off || 0) : ''}</td><td>${b}</td><td>${esc(e.text)}</td></tr>`;
      }).join('') + '</table>';
    } else if (outTab === 'code') {
      let h = '<div style="margin-bottom:8px"><button class="btn" id="dlHex">Download Intel HEX</button> <button class="btn" id="dlBin">Download .bin</button></div>';
      res.image.forEach(c => {
        h += `<div class="ok">${h4(c.segBase)}:${h4(c.off)}  (${hex(c.phys, 5)}h)  ${c.bytes.length} bytes</div><table>`;
        for (let i = 0; i < c.bytes.length; i += 16) {
          const row = c.bytes.slice(i, i + 16);
          h += `<tr><td class="dim">${h4((c.off + i) & 0xFFFF)}</td><td>${row.map(h2).join(' ')}</td></tr>`;
        }
        h += '</table>';
      });
      pane.innerHTML = h;
      $('#dlHex', pane).addEventListener('click', () => download('program.hex', intelHex(res.image), 'text/plain'));
      $('#dlBin', pane).addEventListener('click', () => download('program.bin', binImage(res.image), 'application/octet-stream'));
    } else if (outTab === 'syms') {
      const keys = Object.keys(res.syms || {}).sort();
      pane.innerHTML = keys.length ? '<table><tr><th>Symbol</th><th>Value</th><th>Kind</th></tr>' +
        keys.map(k => `<tr><td>${esc(k)}</td><td>${h4(res.syms[k].v & 0xFFFF)}</td><td class="dim">${esc(res.syms[k].kind || '')}</td></tr>`).join('') + '</table>' : '<div class="dim">No symbols.</div>';
    }
  }
  function download(name, data, type) {
    const blob = new Blob([data], { type }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function intelHex(image) {
    const out = []; let upper = -1;
    const rec = (len, addr, type, data) => {
      let sum = len + (addr >> 8) + (addr & 255) + type; data.forEach(b => sum += b);
      out.push(':' + h2(len) + h4(addr) + h2(type) + data.map(h2).join('') + h2((-sum) & 255));
    };
    image.forEach(c => {
      let i = 0;
      while (i < c.bytes.length) {
        const a = (c.phys + i) & 0xFFFFF, u = a >> 16, low = a & 0xFFFF;
        if (u !== upper) { rec(2, 0, 4, [u >> 8, u & 255]); upper = u; }
        const n = Math.min(16, c.bytes.length - i, 0x10000 - low);
        rec(n, low, 0, c.bytes.slice(i, i + n)); i += n;
      }
    });
    rec(0, 0, 1, []);
    return out.join('\r\n') + '\r\n';
  }
  function binImage(image) {
    let lo = Infinity, hi = -1; image.forEach(c => { lo = Math.min(lo, c.phys); hi = Math.max(hi, c.phys + c.bytes.length - 1); });
    const a = new Uint8Array(hi - lo + 1); image.forEach(c => a.set(c.bytes, c.phys - lo)); return a;
  }

  /* ===================== inspector ===================== */
  const pane = $('#inspPane');
  let inspTab = store.get('s8086_tab', 'regs');
  const FLAGS = [['O', 0x0800], ['D', 0x0400], ['I', 0x0200], ['T', 0x0100], ['S', 0x0080], ['Z', 0x0040], ['A', 0x0010], ['P', 0x0004], ['C', 0x0001]];
  const REGSHOW = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'SS', 'ES', 'IP', 'FL'];
  const prevRegs = {};
  const TABS = {};

  TABS.regs = {
    build() {
      pane.innerHTML = '<div class="regs" id="regGrid"></div><div class="flags" id="flagRow"></div><div class="sect">Next instruction</div><div class="mono" id="nextIns"></div><div class="sect">Stack (top of SS:SP)</div><div class="mono" id="stackView"></div><div class="sect">Timing</div><div class="mono" id="timing"></div><p class="hint">Click a value to edit it (hex). Click a flag to toggle it.</p>';
      const g = $('#regGrid');
      REGSHOW.forEach(n => {
        const d = document.createElement('div'); d.className = 'reg'; d.id = 'rg' + n;
        d.innerHTML = `<label>${n}</label><input type="text" maxlength="4" data-reg="${n}" aria-label="${n} register"><span class="sub"></span>`;
        g.appendChild(d);
      });
      g.addEventListener('change', (e) => {
        const n = e.target.dataset.reg; if (!n) return;
        const v = parseHex(e.target.value); if (v !== null) { M.setReg(n, v); M.show(); }
        M.emit();
      });
      $('#flagRow').addEventListener('click', (e) => {
        const f = e.target.closest('.flag'); if (!f) return;
        M.cpu.setF(M.cpu.getF() ^ (+f.dataset.m)); M.emit();
      });
    },
    update() {
      REGSHOW.forEach(n => {
        const v = M.getReg(n), inp = $('#rg' + n + ' input');
        if (document.activeElement !== inp) inp.value = h4(v);
        const row = $('#rg' + n);
        row.classList.toggle('chg', prevRegs[n] !== undefined && prevRegs[n] !== v);
        prevRegs[n] = v;
        const sub = $('.sub', row);
        if (n === 'AX' || n === 'BX' || n === 'CX' || n === 'DX') sub.textContent = `${n[0]}H=${h2(v >> 8)} ${n[0]}L=${h2(v & 255)}`;
        else if (n === 'FL') sub.textContent = '';
        else sub.textContent = '';
      });
      const f = M.cpu.getF();
      $('#flagRow').innerHTML = FLAGS.map(([ch, m]) => `<span class="flag${f & m ? ' on' : ''}" data-m="${m}" title="${ch} flag">${ch}=${f & m ? 1 : 0}</span>`).join('');
      const d = M.dis(M.cpu.s[1], M.cpu.ip);
      $('#nextIns').textContent = `${h4(M.cpu.s[1])}:${h4(M.cpu.ip)}  ${d.text}`;
      let st = '';
      for (let i = 0; i < 6; i++) { const o = (M.cpu.r[4] + i * 2) & 0xFFFF; st += `${h4(M.cpu.s[2])}:${h4(o)}  ${h4(M.cpu.rws(M.cpu.s[2], o))}${i === 0 ? '  <- SP' : ''}\n`; }
      $('#stackView').innerHTML = `<pre style="margin:0">${st}</pre>`;
      $('#timing').textContent = `${M.cpu.cycles} clocks = ${(M.cpu.cycles / M.cfg.clockHz * 1000).toFixed(3)} ms @ ${(M.cfg.clockHz / 1e6)} MHz\n${M.cpu.instrCount} instructions executed`;
      $('#timing').style.whiteSpace = 'pre';
    },
  };

  let memSeg = 0, memOff = 0x9000, memEditing = false;
  const chgMap = new Map(); let memSnap = null, memSnapKey = '';
  TABS.mem = {
    build() {
      pane.innerHTML = `<div class="memtools"><input class="hex4" id="mSeg" value="${h4(memSeg)}" aria-label="segment"> : <input class="hex4" id="mOff" value="${h4(memOff)}" aria-label="offset"><button class="btn" id="mGo">Show</button>
        <button class="btn" data-p="cs">CS:IP</button><button class="btn" data-p="ds">DS:0</button><button class="btn" data-p="ss">SS:SP</button><button class="btn" data-p="9000">0000:9000</button><button class="btn" data-p="8000">0000:8000</button></div>
        <div id="memTbl"></div><p class="hint">Click a byte to change it. Highlighted bytes changed recently.</p>`;
      const go = () => { const s = parseHex($('#mSeg').value), o = parseHex($('#mOff').value); if (s !== null) memSeg = s & 0xFFFF; if (o !== null) memOff = o & 0xFFFF; TABS.mem.update(true); };
      $('#mGo').addEventListener('click', go);
      pane.querySelectorAll('#mSeg,#mOff').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
      pane.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
        const p = b.dataset.p, c = M.cpu;
        if (p === 'cs') { memSeg = c.s[1]; memOff = c.ip & 0xFFF0; } else if (p === 'ds') { memSeg = c.s[3]; memOff = 0; }
        else if (p === 'ss') { memSeg = c.s[2]; memOff = c.r[4] & 0xFFF0; } else { memSeg = 0; memOff = parseInt(p, 16); }
        $('#mSeg').value = h4(memSeg); $('#mOff').value = h4(memOff); TABS.mem.update(true);
      }));
      $('#memTbl').addEventListener('click', (e) => {
        const td = e.target.closest('.b'); if (!td || memEditing) return;
        memEditing = true; const a = +td.dataset.a;
        td.innerHTML = `<input class="edit" maxlength="2" value="${td.textContent}">`;
        const inp = $('input', td); inp.focus(); inp.select();
        const done = (commit) => {
          if (!memEditing) return; memEditing = false;
          if (commit) { const v = parseHex(inp.value); if (v !== null) { M.cpu.wb(a, v & 255); } }
          M.emit();
        };
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(false));
      });
    },
    update(force) {
      if (memEditing && !force) return;
      memEditing = false;
      const c = M.cpu, now = performance.now(), base = ((memSeg << 4) + memOff) & 0xFFFFF;
      const key = base + ':' + M.cfg.ramKB;
      const snap = new Uint8Array(256);
      for (let i = 0; i < 256; i++) snap[i] = c.rb((base + i) & 0xFFFFF);
      if (memSnap && key === memSnapKey) for (let i = 0; i < 256; i++) if (snap[i] !== memSnap[i]) chgMap.set((base + i) & 0xFFFFF, now + 1500);
      memSnap = snap; memSnapKey = key;
      let h = '<table class="memtbl">';
      for (let r = 0; r < 16; r++) {
        h += `<tr><td class="addr">${h4(memSeg)}:${h4((memOff + r * 16) & 0xFFFF)}</td><td>`;
        let asc = '';
        for (let i = 0; i < 16; i++) {
          const a = (base + r * 16 + i) & 0xFFFFF, v = snap[r * 16 + i];
          const ch = chgMap.has(a) && chgMap.get(a) > now ? ' chg' : '';
          h += `<span class="b${ch}" data-a="${a}">${h2(v)}</span>`;
          asc += v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : '.';
        }
        h += `</td><td class="asc">${asc}</td></tr>`;
      }
      $('#memTbl').innerHTML = h + '</table>';
    },
  };

  let disFollow = true, disSeg = 0, disOff = 0x8000;
  TABS.dis = {
    build() {
      pane.innerHTML = `<div class="memtools"><label class="inline"><input type="checkbox" id="dFollow" ${disFollow ? 'checked' : ''}> follow CS:IP</label>
        <input class="hex4" id="dSeg" value="${h4(disSeg)}" aria-label="segment"> : <input class="hex4" id="dOff" value="${h4(disOff)}" aria-label="offset"><button class="btn" id="dGo">Show</button></div>
        <div id="disTbl"></div><p class="hint">Click the dot at the left of an instruction to set or clear a breakpoint. A running program stops there; use Resume to continue.</p>`;
      $('#dFollow').addEventListener('change', (e) => { disFollow = e.target.checked; TABS.dis.update(); });
      $('#dGo').addEventListener('click', () => {
        const s = parseHex($('#dSeg').value), o = parseHex($('#dOff').value);
        if (s !== null) disSeg = s & 0xFFFF; if (o !== null) disOff = o & 0xFFFF; disFollow = false; $('#dFollow').checked = false; TABS.dis.update();
      });
      $('#disTbl').addEventListener('click', (e) => {
        const bp = e.target.closest('.bp'); if (!bp) return;
        const a = +bp.dataset.a; if (M.breakpoints.has(a)) M.breakpoints.delete(a); else M.breakpoints.add(a);
        TABS.dis.update();
      });
    },
    update() {
      const c = M.cpu;
      let seg, off;
      if (disFollow) { seg = c.s[1]; off = c.ip; } else { seg = disSeg; off = disOff; }
      let h = '<table class="distbl">';
      let o = off;
      for (let i = 0; i < 22; i++) {
        const d = M.dis(seg, o), a = ((seg << 4) + o) & 0xFFFFF;
        const bytes = []; for (let k = 0; k < d.len; k++) bytes.push(h2(M.cpu.rbs(seg, o + k)));
        const isPc = seg === c.s[1] && o === c.ip;
        h += `<tr class="${isPc ? 'pc' : ''}"><td class="bp${M.breakpoints.has(a) ? ' on' : ''}" data-a="${a}"></td><td class="a">${h4(seg)}:${h4(o)}</td><td class="by">${bytes.join(' ').padEnd(17)}</td><td>${esc(d.text)}</td></tr>`;
        o = (o + d.len) & 0xFFFF;
      }
      $('#disTbl').innerHTML = h + '</table>';
      if (M.breakpoints.size) $('#disTbl').insertAdjacentHTML('beforeend', `<p class="hint">Breakpoints: ${[...M.breakpoints].map(a => hex(a, 5) + 'h').join(', ')} <a href="#" id="bpClear">clear all</a></p>`);
      const cl = $('#bpClear'); if (cl) cl.addEventListener('click', (e) => { e.preventDefault(); M.breakpoints.clear(); TABS.dis.update(); });
    },
  };

  TABS.io = {
    build() {
      const a1 = cfgHex(M.cfg.ppi1, 2), a2 = cfgHex(M.cfg.ppi2, 2);
      pane.innerHTML = `<div class="ppi"><h3>8255 #1 <span class="addr">ports ${a1} ${cfgHex(M.cfg.ppi1 + 2, 2)} ${cfgHex(M.cfg.ppi1 + 4, 2)} ctrl ${cfgHex(M.cfg.ppi1 + 6, 2)}</span></h3><div id="ppi0"></div></div>
        <div class="ppi"><h3>8255 #2 <span class="addr">ports ${a2} ${cfgHex(M.cfg.ppi2 + 2, 2)} ${cfgHex(M.cfg.ppi2 + 4, 2)} ctrl ${cfgHex(M.cfg.ppi2 + 6, 2)}</span></h3><div id="ppi1"></div></div>
        <div class="ppi"><h3>LCD <span class="addr">cmd ${cfgHex(M.cfg.lcdBase, 2)}  data ${cfgHex(M.cfg.lcdBase + 2, 2)}</span></h3><div id="lcdInfo" class="mono"></div></div>
        <p class="hint">Round red lights = port bits driven by your program (outputs). Square buttons = input pins: click to toggle a switch that your program reads with IN.</p>`;
      pane.onclick = (e) => {
        const b = e.target.closest('.bit.in'); if (!b) return;
        const p = M.ppi[+b.dataset.p]; p.setPin(+b.dataset.port, +b.dataset.bit, !((p.pins[+b.dataset.port] >> +b.dataset.bit) & 1)); M.emit();
      };
    },
    update() {
      for (let k = 0; k < 2; k++) {
        const p = M.ppi[k]; let h = '';
        ['A', 'B', 'C'].forEach((nm, port) => {
          const st = p.portState(port);
          const bits = [];
          for (let b = 7; b >= 0; b--) {
            const s = st[b];
            bits.push(`<span class="bit ${s.dir === 'in' ? 'in' : 'out'}${s.v ? ' on' : ''}" data-p="${k}" data-port="${port}" data-bit="${b}" title="P${nm}${b} ${s.dir === 'in' ? 'input pin' : 'output'}">${b}</span>`);
          }
          const val = st.reduce((a, s, i) => a | (s.v << i), 0);
          h += `<div class="prow"><span class="pn">Port ${nm}</span><div class="bits">${bits.join('')}</div><span class="pv">${h2(val)}h</span></div>`;
        });
        h += `<div class="pv mono">control word ${h2(p.ctrl)}h</div>`;
        $('#ppi' + k).innerHTML = h;
      }
      const L = M.lcd;
      $('#lcdInfo').innerHTML = `${esc(L.text()[0])}<br>${esc(L.text()[1])}<br><span class="dim">display ${L.dispOn ? 'on' : 'off'}, cursor ${L.cursorOn ? 'on' : 'off'}, blink ${L.blinkOn ? 'on' : 'off'}, AC=${h2(L.ac)}h${L.dropped ? `, <span style="color:var(--warn)">${L.dropped} writes dropped (LCD was busy)</span>` : ''}</span>`;
    },
  };
  const cfgHex = (v, n) => hex(v, n) + 'h';

  TABS.trace = {
    build() {
      pane.innerHTML = `<label class="inline"><input type="checkbox" id="trOn" ${M.traceEnabled ? 'checked' : ''}> record executed instructions</label><div id="trView" class="tr" style="margin-top:8px"></div>`;
      $('#trOn').addEventListener('change', (e) => { M.traceEnabled = e.target.checked; });
    },
    update() {
      const t = M.trace.slice(-60);
      $('#trView').textContent = t.length ? t.map(r => `${h4(r.cs)}:${h4(r.ip)}  ${r.text.padEnd(26)} AX=${h4(r.ax)} BX=${h4(r.bx)} CX=${h4(r.cx)} DX=${h4(r.dx)}`).join('\n') : (M.traceEnabled ? 'No instructions recorded yet.' : 'Tick the box, then step or run to record.');
    },
  };

  TABS.set = {
    build() {
      const c = M.cfg;
      pane.innerHTML = `<div class="setgrid">
        <label>CPU clock (MHz)</label><input id="sClk" value="${c.clockHz / 1e6}">
        <label>RAM size (KB)</label><select id="sRam">${[16, 32, 64, 128, 256, 512, 1024].map(k => `<option${k === c.ramKB ? ' selected' : ''}>${k}</option>`).join('')}</select>
        <label>8255 #1 base (hex)</label><input id="sP1" value="${hex(c.ppi1, 2)}">
        <label>8255 #2 base (hex)</label><input id="sP2" value="${hex(c.ppi2, 2)}">
        <label>LCD command port (hex)</label><input id="sLcd" value="${hex(c.lcdBase, 2)}">
        <label>RAM at power on</label><select id="sPow"><option value="zero"${c.powerOnRam === 'zero' ? ' selected' : ''}>zeros</option><option value="ff"${c.powerOnRam === 'ff' ? ' selected' : ''}>FF</option><option value="random"${c.powerOnRam === 'random' ? ' selected' : ''}>random</option></select>
        <label>Monitor stack (SP)</label><input id="sSp" value="${hex(c.stackTop, 4)}">
        <label>Default CS : IP</label><span><input class="hex4" id="sSeg" value="${hex(c.defaultSeg, 4)}"> : <input class="hex4" id="sOff" value="${hex(c.defaultOff, 4)}"></span>
        <label>Monitor style</label><select id="sMon"><option value="console"${c.monitor === 'console' ? ' selected' : ''}>Console: type A8000, G8000, M8500</option><option value="keypad"${c.monitor === 'keypad' ? ' selected' : ''}>Hex keypad: MEM / GO / STEP keys</option></select>
        <label>LCD busy strict</label><label class="inline"><input type="checkbox" id="sStrict" ${c.strictLcd ? 'checked' : ''}> ignore writes while busy</label>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" id="sApply">Apply and power cycle</button><button class="btn" id="sDef">Defaults</button></div>
      <p class="setnote">The LCD is wired at the command port (status read as well); data is at command port + 2. Each 8255 uses four even addresses: A, B, C, control. These addresses are assumptions, so match them to your lab manual. "Strict" makes the LCD drop commands sent before its busy time has elapsed, like the real controller, so a program with missing delays will show garbage.</p>`;
      $('#sApply').addEventListener('click', () => {
        const n = {
          clockHz: Math.max(0.1, parseFloat($('#sClk').value) || 5) * 1e6, ramKB: +$('#sRam').value,
          ppi1: (parseHex($('#sP1').value) || 0) & 0xFFF8, ppi2: (parseHex($('#sP2').value) || 0) & 0xFFF8, lcdBase: (parseHex($('#sLcd').value) || 0x10) & 0xFFFC,
          powerOnRam: $('#sPow').value, monitor: $('#sMon').value, strictLcd: $('#sStrict').checked, stackTop: (parseHex($('#sSp').value) || 0x7FFE) & 0xFFFF,
          defaultSeg: (parseHex($('#sSeg').value) || 0) & 0xFFFF, defaultOff: (parseHex($('#sOff').value) || 0) & 0xFFFF,
        };
        applyCfg(n);
      });
      $('#sDef').addEventListener('click', () => applyCfg(Object.assign({}, DEFAULTS)));
    },
    update() {},
  };
  function applyCfg(n) {
    Object.assign(M.cfg, n); store.set('s8086_cfg', JSON.stringify(Object.assign({}, M.cfg, { speed: undefined })));
    cancelTyping(); paused = false; M.powerOn(); applySpeed(); TABS.set.build(); updateHint();
  }

  function setInspTab(t) {
    inspTab = TABS[t] ? t : 'regs'; store.set('s8086_tab', inspTab);
    document.querySelectorAll('#inspTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === inspTab)));
    pane.onclick = null; memEditing = false;
    TABS[inspTab].build(); TABS[inspTab].update(true);
  }
  function renderInsp() { inspDirty = false; if (memEditing) return; const a = document.activeElement; if (a && pane.contains(a) && a.tagName === 'INPUT' && a.type === 'text' && inspTab !== 'regs' && inspTab !== 'mem') return; TABS[inspTab].update(); }

  /* ===================== status ===================== */
  let lastStatus = '';
  function renderStatus() {
    const m = M.mon, c = M.cpu;
    let s = M.status || '';
    if (paused && m.mode === 'RUN') s = 'PAUSED - ' + s.replace(/^PAUSED[^-]*- ?/, '');
    const modeTxt = m.mode === 'RUN' ? (paused ? 'PAUSED' : 'RUN') : m.mode;
    const line = `[${modeTxt}] ${s}\nCS:IP ${h4(c.s[1])}:${h4(c.ip)}   ${(c.cycles / M.cfg.clockHz * 1000).toFixed(2)} ms`;
    if (line !== lastStatus) { $('#status').textContent = line; lastStatus = line; }
    const run = m.mode === 'RUN' && !paused;
    $('#ledRun').setAttribute('fill', run ? '#43ff6a' : '#1d3a1d');
    $('#ledHalt').setAttribute('fill', m.mode === 'HALT' ? '#ffb020' : '#3a2d10');
    $('#btnPause').textContent = (m.mode === 'RUN' && paused) || (m.mode === 'HALT' && M.breakHit) ? 'Resume' : 'Pause';
    $('#btnPause').disabled = !(m.mode === 'RUN' || (m.mode === 'HALT' && M.breakHit));
  }

  /* ===================== main loop ===================== */
  let last = performance.now(), lastInsp = 0;
  function frame(t) {
    const dt = Math.min(100, t - last); last = t;
    if (!paused && M.mon.mode === 'RUN') M.tick(dt);
    const phase = Math.floor(t / 500) % 2;
    if (M.lcd.dirty || dirty || (phase !== lastBlink && M.lcd.view().cursor)) { renderLcd(t); }
    if (dirty) { renderStatus(); dirty = false; }
    else if (M.mon.mode === 'RUN') renderStatus();
    if ((inspDirty || M.mon.mode === 'RUN') && t - lastInsp > (M.mon.mode === 'RUN' ? 150 : 40)) { lastInsp = t; renderInsp(); }
    requestAnimationFrame(frame);
  }

  /* ===================== init ===================== */
  function init() {
    buildBoard(); buildKeypad(); updateHint();
    $('#loadSeg').value = store.get('s8086_seg', '0000'); $('#loadOff').value = store.get('s8086_off', '8000');
    const savedSrc = store.get('s8086_src', null);
    if (savedSrc) { src.value = savedSrc; sel.value = store.get('s8086_ex', ''); }
    else { const ex = window.EXAMPLES.find(e => e.id === 'lcdhello') || window.EXAMPLES[0]; src.value = ex.source; sel.value = ex.id; }
    updateGutter(); showMsgs(null, null);
    applySpeed();
    $('#btnRun').addEventListener('click', loadAndRun);
    $('#btnLoad').addEventListener('click', loadOnly);
    $('#btnType').addEventListener('click', typeIn);
    $('#btnAsm').addEventListener('click', () => { if (assemble()) { /* messages already shown */ } });
    $('#btnPause').addEventListener('click', doPause);
    $('#btnStep').addEventListener('click', doStep);
    $('#btnReset').addEventListener('click', () => { cancelTyping(); paused = false; M.key('RESET'); });
    $('#btnPower').addEventListener('click', () => { cancelTyping(); paused = false; M.powerOn(); });
    $('#speed').addEventListener('change', (e) => { speedSetting = e.target.value === 'max' ? 'max' : +e.target.value; applySpeed(); });
    document.querySelectorAll('#outTabs button').forEach(b => b.addEventListener('click', () => setOutTab(b.dataset.tab)));
    document.querySelectorAll('#inspTabs button').forEach(b => b.addEventListener('click', () => setInspTab(b.dataset.tab)));
    setInspTab(inspTab);
    renderLcd(0); renderStatus();
    requestAnimationFrame(frame);
    window.__app = { M, pressKey, assemble, loadAndRun, loadOnly, typeIn, doStep, doPause, get paused() { return paused; } };
  }
  init();
})();
