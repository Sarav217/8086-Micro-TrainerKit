/* =====================================================================
 *  8086 TRAINER KIT  -  machine model
 *  CPU + RAM/ROM map + HD44780 16x2 LCD + 2 x 8255 PPI + keypad monitor
 *
 *  Hardware inferred from the board photo (SASTHA'S 8086 TRAINER):
 *    NEC D8086AC-2 CPU, 8284 clock, 2 x 27C256 EPROM (64 KB), 2 x 62256 RAM (64 KB),
 *    2 x 82C55 PPI (connectors J6/J8/J9), 16x2 LCD (JHD162A), 74HC138 decoder.
 *  Port addresses / memory map below are ASSUMPTIONS (editable in Settings).
 * ===================================================================== */
(function (root) {
  'use strict';
  const CPU = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./cpu8086.js') : root.CPU8086;
  const ASM = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./asm8086.js') : root.Asm8086;
  const DIS = (typeof require !== 'undefined' && typeof module !== 'undefined') ? require('./dis8086.js') : root.Dis8086;

  const hex = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
  const pad16 = (s) => (s + '                ').slice(0, 16);

  /* ============================ HD44780 LCD ============================ */
  class LCD44780 {
    constructor(now, cyclesPerUs) {
      this.now = now || (() => 0);
      this.cpus = cyclesPerUs || 5;
      this.strict = false;                 // drop writes while busy (real chip behaviour)
      this.dropped = 0;
      this.reset();
    }
    reset() {
      this.ddram = new Uint8Array(128).fill(0x20);
      this.cgram = new Uint8Array(64);
      this.ac = 0; this.addrMode = 'dd';        // 'dd' | 'cg'
      this.shift = 0;
      this.entryInc = true; this.entryShift = false;
      this.dispOn = true; this.cursorOn = false; this.blinkOn = false;
      this.twoLine = true; this.font5x10 = false;
      this.busyUntil = 0; this.userOwned = false;
      this.dirty = true;
    }
    busy() { return this.now() < this.busyUntil; }
    setBusy(us) { this.busyUntil = this.now() + us * this.cpus; }
    status() { return (this.busy() ? 0x80 : 0) | (this.ac & 0x7F); }
    incAC(dir) {
      if (this.addrMode === 'cg') { this.ac = (this.ac + dir) & 0x3F; return; }
      this.ac = (this.ac + dir) & 0x7F;
      if (this.twoLine) {
        if (dir > 0 && this.ac === 0x68) this.ac = 0x00;
        if (dir < 0 && this.ac === 0x7F) this.ac = 0x67;
        if (dir > 0 && this.ac === 0x28) this.ac = 0x28;      // hidden region (accessible, not shown)
      } else {
        if (dir > 0 && this.ac === 0x50) this.ac = 0x00;
        if (dir < 0 && this.ac === 0x7F) this.ac = 0x4F;
      }
    }
    writeCmd(v, fromUser) {
      if (fromUser) { this.userOwned = true; if (this.strict && this.busy()) { this.dropped++; return; } }
      v &= 0xFF; this.dirty = true;
      if (v & 0x80) { this.addrMode = 'dd'; this.ac = v & 0x7F; this.setBusy(37); }
      else if (v & 0x40) { this.addrMode = 'cg'; this.ac = v & 0x3F; this.setBusy(37); }
      else if (v & 0x20) { this.twoLine = !!(v & 0x08); this.font5x10 = !!(v & 0x04); this.setBusy(37); }
      else if (v & 0x10) {
        const sc = v & 0x08, rl = v & 0x04;
        if (sc) { this.shift = (this.shift + (rl ? 1 : -1) + 40) % 40; }
        else { this.incAC(rl ? 1 : -1); }
        this.setBusy(37);
      }
      else if (v & 0x08) { this.dispOn = !!(v & 4); this.cursorOn = !!(v & 2); this.blinkOn = !!(v & 1); this.setBusy(37); }
      else if (v & 0x04) { this.entryInc = !!(v & 2); this.entryShift = !!(v & 1); this.setBusy(37); }
      else if (v & 0x02) { this.ac = 0; this.shift = 0; this.addrMode = 'dd'; this.setBusy(1520); }
      else if (v & 0x01) { this.ddram.fill(0x20); this.ac = 0; this.shift = 0; this.entryInc = true; this.addrMode = 'dd'; this.setBusy(1520); }
    }
    writeData(v, fromUser) {
      if (fromUser) { this.userOwned = true; if (this.strict && this.busy()) { this.dropped++; return; } }
      v &= 0xFF; this.dirty = true;
      if (this.addrMode === 'cg') this.cgram[this.ac & 0x3F] = v;
      else {
        this.ddram[this.ac & 0x7F] = v;
        if (this.entryShift) this.shift = (this.shift + (this.entryInc ? -1 : 1) + 40) % 40;
      }
      this.incAC(this.entryInc ? 1 : -1);
      this.setBusy(37);
    }
    readData() {
      let v;
      if (this.addrMode === 'cg') v = this.cgram[this.ac & 0x3F]; else v = this.ddram[this.ac & 0x7F];
      this.incAC(this.entryInc ? 1 : -1);
      this.setBusy(37);
      return v;
    }
    // monitor-side helper: write text directly (not "user" output)
    printLines(l1, l2) {
      this.ddram.fill(0x20); this.shift = 0; this.dispOn = true; this.twoLine = true; this.userOwned = false;
      for (let i = 0; i < 16; i++) {
        this.ddram[i] = (l1 || '').charCodeAt(i) || 0x20;
        this.ddram[0x40 + i] = (l2 || '').charCodeAt(i) || 0x20;
      }
      this.cursorOn = false; this.blinkOn = false; this.dirty = true;
    }
    setCursor(row, col) { this.cursorPos = { row, col }; this.cursorOn = true; this.blinkOn = true; this.ac = (row ? 0x40 : 0) + col; }
    // visible 2x16 as arrays of char codes
    view() {
      const rows = [[], []];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
        let a;
        if (this.twoLine) a = (r ? 0x40 : 0x00) + ((this.shift + c) % 40);
        else a = (this.shift + r * 16 + c) % 80;
        rows[r].push(this.dispOn ? this.ddram[a & 0x7F] : 0x20);
      }
      let cur = null;
      if (this.dispOn && (this.cursorOn || this.blinkOn) && this.addrMode === 'dd') {
        let r, c;
        if (this.twoLine) {
          if (this.ac < 0x28) { r = 0; c = (this.ac - this.shift + 40) % 40; }
          else if (this.ac >= 0x40 && this.ac < 0x68) { r = 1; c = (this.ac - 0x40 - this.shift + 40) % 40; }
        }
        if (r !== undefined && c < 16) cur = { row: r, col: c, underline: this.cursorOn, blink: this.blinkOn };
      }
      return { rows, cursor: cur };
    }
    text() { const v = this.view(); return v.rows.map(r => r.map(c => String.fromCharCode(c >= 32 && c < 127 ? c : 0x3F)).join('')); }
  }

  /* ============================== 8255 PPI ============================== */
  class PPI8255 {
    constructor(name) { this.name = name; this.pins = [0, 0, 0]; this.onChange = null; this.reset(); }
    reset() { this.ctrl = 0x9B; this.latch = [0, 0, 0]; this.changed(); }
    changed() { if (this.onChange) this.onChange(this); }
    inMask(p) {
      const c = this.ctrl;
      if (p === 0) return (c & 0x10) ? 0xFF : 0;
      if (p === 1) return (c & 0x02) ? 0xFF : 0;
      return ((c & 0x08) ? 0xF0 : 0) | ((c & 0x01) ? 0x0F : 0);
    }
    write(reg, v) {
      v &= 0xFF;
      if (reg < 3) { this.latch[reg] = v; }
      else if (v & 0x80) { this.ctrl = v; this.latch = [0, 0, 0]; }
      else { const bit = (v >> 1) & 7; if (v & 1) this.latch[2] |= (1 << bit); else this.latch[2] &= ~(1 << bit); }
      this.changed();
    }
    read(reg) {
      if (reg < 3) { const m = this.inMask(reg); return ((this.pins[reg] & m) | (this.latch[reg] & ~m)) & 0xFF; }
      return 0xFF;
    }
    // for the UI: returns [{dir:'in'|'out', v:0|1}] x8 for port
    portState(p) {
      const m = this.inMask(p), out = [];
      for (let b = 0; b < 8; b++) {
        const isIn = !!(m & (1 << b));
        out.push({ dir: isIn ? 'in' : 'out', v: isIn ? (this.pins[p] >> b) & 1 : (this.latch[p] >> b) & 1 });
      }
      return out;
    }
    setPin(p, b, v) { if (v) this.pins[p] |= (1 << b); else this.pins[p] &= ~(1 << b); this.changed(); }
  }

  /* ============================== TRAINER ============================== */
  const REGNAMES = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'SS', 'ES', 'IP', 'FL'];
  const FLAGSTR = [['O', 0x0800], ['D', 0x0400], ['I', 0x0200], ['T', 0x0100], ['S', 0x0080], ['Z', 0x0040], ['A', 0x0010], ['P', 0x0004], ['C', 0x0001]];
  const STUB_SEG = 0xF000;

  class Trainer {
    constructor(cfg) {
      this.cfg = Object.assign({
        clockHz: 5000000, ramKB: 64, ppi1: 0x00, ppi2: 0x08, lcdBase: 0x10,
        powerOnRam: 'zero', speed: 1, strictLcd: false, stackTop: 0x7FFE, defaultSeg: 0x0000, defaultOff: 0x8000, monitor: 'keypad',
      }, cfg || {});
      this.cpu = new CPU();
      this.lcd = new LCD44780(() => this.cpu.cycles, this.cfg.clockHz / 1e6);
      this.ppi = [new PPI8255('8255 #1'), new PPI8255('8255 #2')];
      this.breakpoints = new Set();
      this.status = '';
      this.trace = []; this.traceEnabled = false;
      this.listeners = [];
      this.cpu.io = {
        in: (p, w) => this.ioIn(p, w),
        out: (p, w, v) => this.ioOut(p, w, v),
      };
      this.powerOn();
    }

    /* ---- memory map ---- */
    mapMemory() {
      const c = this.cpu;
      c.pageType.fill(CPU.PAGE.NONE);
      const ram = Math.min(1024, this.cfg.ramKB) * 1024;
      c.setPages(0, ram - 1, CPU.PAGE.RAM);
      c.setPages(0xF0000, 0xFFFFF, CPU.PAGE.ROM);
    }
    installRom() {
      const m = this.cpu.mem;
      m.fill(0xFF, 0xF0000, 0x100000);
      m[0xF0000] = 0xF4;                                   // F000:0000  return-to-monitor stub (HLT)
      for (let n = 0; n < 256; n++) m[0xF0100 + n] = 0xF4; // F000:0100+n default INT n handler stubs (HLT)
      m.set([0xEA, 0x00, 0x00, 0x00, 0xF0], 0xFFFF0);      // reset vector: JMP F000:0000
    }
    initVectors() {
      const c = this.cpu;
      for (let n = 0; n < 256; n++) { c.mem[n * 4] = (0x0100 + n) & 0xFF; c.mem[n * 4 + 1] = (0x0100 + n) >> 8; c.mem[n * 4 + 2] = 0x00; c.mem[n * 4 + 3] = 0xF0; }
    }
    powerOn() {
      const c = this.cpu;
      c.mem.fill(0);
      const ram = Math.min(1024, this.cfg.ramKB) * 1024;
      if (this.cfg.powerOnRam === 'random') for (let i = 0; i < ram; i++) c.mem[i] = (Math.random() * 256) | 0;
      else if (this.cfg.powerOnRam === 'ff') c.mem.fill(0xFF, 0, ram);
      this.mapMemory(); this.installRom();
      c.cycles = 0; c.instrCount = 0;
      this.reset(true);
    }
    reset(power) {
      const c = this.cpu;
      c.reset();
      c.s[0] = c.s[2] = c.s[3] = 0; c.s[1] = this.cfg.defaultSeg; c.ip = this.cfg.defaultOff;
      c.r[4] = this.cfg.stackTop;
      c.halted = false;
      this.mapMemory();
      this.initVectors();
      this.ppi.forEach(p => p.reset());
      this.lcd.reset(); this.lcd.strict = !!this.cfg.strictLcd; this.lcd.cpus = this.cfg.clockHz / 1e6;
      this.mon = { mode: 'IDLE', seg: this.cfg.defaultSeg, off: this.cfg.defaultOff, field: 'off', dirty: false, dval: 0, regIdx: 0, rval: 0, memSeg: this.cfg.defaultSeg, memOff: this.cfg.defaultOff, stepShown: false };
      this.status = 'READY';
      if (this.cfg.monitor === 'console') { this.mon.mode = 'CON'; this.conInit('8086 TRAINER'); }
      this.trace = [];
      this.show();
      this.emit();
    }
    emit() { for (const f of this.listeners) f(this); }

    /* ---- I/O bus ---- */
    ioIn8(p) {
      p &= 0xFFFF;
      const dev = (base) => (p & 0xFFF8) === base && (p & 1) === 0;
      if (dev(this.cfg.ppi1)) return this.ppi[0].read((p >> 1) & 3);
      if (dev(this.cfg.ppi2)) return this.ppi[1].read((p >> 1) & 3);
      if ((p & 0xFFFC) === this.cfg.lcdBase && (p & 1) === 0) return (p & 2) ? this.lcd.readData() : this.lcd.status();
      return 0xFF;
    }
    ioOut8(p, v) {
      p &= 0xFFFF;
      const dev = (base) => (p & 0xFFF8) === base && (p & 1) === 0;
      if (dev(this.cfg.ppi1)) { this.ppi[0].write((p >> 1) & 3, v); return; }
      if (dev(this.cfg.ppi2)) { this.ppi[1].write((p >> 1) & 3, v); return; }
      if ((p & 0xFFFC) === this.cfg.lcdBase && (p & 1) === 0) { if (p & 2) this.lcd.writeData(v, true); else this.lcd.writeCmd(v, true); }
    }
    ioIn(p, w) {
      if (!w) return this.ioIn8(p);
      return this.ioIn8(p) | (this.ioIn8(p + 1) << 8);
    }
    ioOut(p, w, v) {
      this.ioOut8(p, v & 0xFF);
      if (w) this.ioOut8(p + 1, (v >> 8) & 0xFF);
    }

    /* ---- program loading ---- */
    loadImage(image) {
      const c = this.cpu;
      for (const chunk of image) {
        for (let i = 0; i < chunk.bytes.length; i++) {
          const a = (chunk.phys + i) & 0xFFFFF;
          if (c.pageType[a >> 12] !== CPU.PAGE.RAM) throw new Error(`Address ${hex(a, 5)}h is not RAM on this kit (RAM = ${this.cfg.ramKB} KB at 00000h)`);
          c.mem[a] = chunk.bytes[i];
        }
      }
    }
    readByte(seg, off) { return this.cpu.rbs(seg, off); }

    /* ---- registers via names ---- */
    getReg(name) {
      const c = this.cpu, i = REGNAMES.indexOf(name);
      if (i < 0) return 0;
      if (i < 8) { const map = [0, 3, 1, 2, 4, 5, 6, 7]; return c.r[map[i]]; }   // AX BX CX DX SP BP SI DI
      if (i === 8) return c.s[1]; if (i === 9) return c.s[3]; if (i === 10) return c.s[2]; if (i === 11) return c.s[0];
      if (i === 12) return c.ip; return c.getF();
    }
    setReg(name, v) {
      const c = this.cpu, i = REGNAMES.indexOf(name); v &= 0xFFFF;
      if (i < 8) { const map = [0, 3, 1, 2, 4, 5, 6, 7]; c.r[map[i]] = v; }
      else if (i === 8) c.s[1] = v; else if (i === 9) c.s[3] = v; else if (i === 10) c.s[2] = v; else if (i === 11) c.s[0] = v;
      else if (i === 12) c.ip = v; else c.setF(v);
    }

    /* ---- disassemble at seg:off ---- */
    dis(seg, off) { return DIS.disasm((i) => this.cpu.rbs(seg, off + i), off & 0xFFFF); }

    /* ================= keypad / monitor state machine ================= */
    key(k) {
      const m = this.mon;
      if (k === 'RESET') { this.reset(false); return; }
      if (m.mode === 'RUN') return;                      // only RESET works while a program is running
      if (this.cfg.monitor === 'console') { this.conPad(k); return; }
      const isHex = /^[0-9A-F]$/.test(k);
      switch (k) {
        case 'MEM': this.keyMem(); break;
        case 'REG': this.keyReg(); break;
        case 'GO': this.keyGo(); break;
        case 'STEP': this.keyStep(); break;
        case 'SEG': this.keySeg(); break;
        case 'ENTER': this.keyEnter(); break;
        case 'NEXT': this.keyMove(+1); break;
        case 'PREV': this.keyMove(-1); break;
        case 'CLR': this.keyClr(); break;
        default: if (isHex) this.keyHex(parseInt(k, 16));
      }
      if (this.mon.mode !== 'RUN') this.show();
      this.emit();
    }

    commitPending() {
      const m = this.mon;
      if (m.mode === 'MEM' && m.field === 'data' && m.dirty) { this.writeMem(m.seg, m.off, m.dval); m.dirty = false; }
      if (m.mode === 'REG' && m.dirty) { this.setReg(REGNAMES[m.regIdx], m.rval); m.dirty = false; }
    }
    writeMem(seg, off, v) {
      const a = ((seg << 4) + (off & 0xFFFF)) & 0xFFFFF;
      this.cpu.wb(a, v);
      if (this.cpu.rb(a) !== (v & 0xFF)) this.status = 'NOT RAM / ROM!';
    }
    keyMem() {
      const m = this.mon;
      if (m.mode === 'MEM') { this.commitPending(); m.field = 'off'; return; }
      this.commitPending();
      m.mode = 'MEM'; m.seg = m.memSeg; m.off = m.memOff; m.field = 'off'; m.dirty = false;
      this.status = 'EXAMINE MEMORY';
    }
    keyReg() {
      const m = this.mon;
      this.commitPending();
      if (m.mode !== 'REG') { m.mode = 'REG'; m.regIdx = 0; }
      m.dirty = false; m.rval = this.getReg(REGNAMES[m.regIdx]);
      this.status = 'EXAMINE REGISTERS';
    }
    keyGo() {
      const m = this.mon;
      this.commitPending();
      if (m.mode === 'GO') { this.startRun(m.seg, m.off); return; }
      m.mode = 'GO'; m.seg = this.cpu.s[1]; m.off = this.cpu.ip; m.field = 'off';
      this.status = 'GO: ENTER ADDRESS, PRESS GO/ENTER';
    }
    keyStep() {
      const m = this.mon;
      this.commitPending();
      if (m.mode === 'STEP') { this.stepOne(); return; }
      m.mode = 'STEP';
      this.status = 'SINGLE STEP: PRESS STEP TO EXECUTE';
    }
    keySeg() {
      const m = this.mon;
      if (m.mode === 'MEM' || m.mode === 'GO') {
        if (m.field === 'data') { this.commitPending(); m.field = 'off'; }
        m.field = (m.field === 'seg') ? 'off' : 'seg';
      }
    }
    keyEnter() {
      const m = this.mon;
      if (m.mode === 'MEM') {
        if (m.field === 'data') { this.commitPending(); }
        else { m.field = 'data'; m.dval = this.readByte(m.seg, m.off); m.dirty = false; }
        m.memSeg = m.seg; m.memOff = m.off;
      } else if (m.mode === 'REG') {
        this.commitPending(); m.rval = this.getReg(REGNAMES[m.regIdx]);
      } else if (m.mode === 'GO') {
        this.startRun(m.seg, m.off);
      } else if (m.mode === 'STEP') {
        this.stepOne();
      }
    }
    keyMove(dir) {
      const m = this.mon;
      if (m.mode === 'MEM') {
        this.commitPending();
        m.off = (m.off + dir) & 0xFFFF; m.field = 'data'; m.dval = this.readByte(m.seg, m.off); m.dirty = false;
        m.memSeg = m.seg; m.memOff = m.off;
      } else if (m.mode === 'REG') {
        this.commitPending();
        m.regIdx = (m.regIdx + dir + REGNAMES.length) % REGNAMES.length;
        m.rval = this.getReg(REGNAMES[m.regIdx]); m.dirty = false;
      } else if (m.mode === 'STEP' || m.mode === 'GO') {
        // NEXT/PREV in GO prompt adjusts the offset by one
        if (m.mode === 'GO') m.off = (m.off + dir) & 0xFFFF;
      }
    }
    keyClr() {
      const m = this.mon;
      if (m.mode === 'MEM') {
        if (m.field === 'data') { m.dval = this.readByte(m.seg, m.off); m.dirty = false; }
        else if (m.field === 'seg') m.seg = 0; else m.off = 0;
      } else if (m.mode === 'REG') { m.rval = this.getReg(REGNAMES[m.regIdx]); m.dirty = false; }
      else if (m.mode === 'GO') { if (m.field === 'seg') m.seg = 0; else m.off = 0; }
      else if (m.mode === 'HALT') { m.mode = 'IDLE'; this.status = 'READY'; }
    }
    keyHex(d) {
      const m = this.mon;
      if (m.mode === 'MEM') {
        if (m.field === 'off') m.off = ((m.off << 4) | d) & 0xFFFF;
        else if (m.field === 'seg') m.seg = ((m.seg << 4) | d) & 0xFFFF;
        else { m.dval = ((m.dval << 4) | d) & 0xFF; m.dirty = true; }
      } else if (m.mode === 'REG') {
        m.rval = ((m.rval << 4) | d) & 0xFFFF; m.dirty = true;
      } else if (m.mode === 'GO') {
        if (m.field === 'off') m.off = ((m.off << 4) | d) & 0xFFFF; else m.seg = ((m.seg << 4) | d) & 0xFFFF;
      }
    }


    /* ================= console monitor (type A8000, G8000, M8500 on the LCD) ================= */
    conInit(info) {
      this.mon.con = { sub: 'CMD', buf: '', seg: this.cfg.defaultSeg, off: this.cfg.defaultOff, aoff: this.cfg.defaultOff, info: info || '8086 TRAINER', last: '', regPage: 0, regIdx: 0, goSeg: null, goOff: null, ulen: 1, flash: '', flashFull: '' };
    }
    conPad(k) {   // on-screen keypad keys while the console monitor is active
      const map = { MEM: 'M', REG: 'R', GO: 'G', STEP: 'T', SEG: ':', ENTER: 'Enter', NEXT: 'Enter', PREV: 'Backspace', CLR: 'Clear' };
      this.con(map[k] || k);
    }
    conNotice(text, goSeg, goOff) {
      const m = this.mon; m.mode = 'CON'; if (!m.con) this.conInit();
      const C = m.con; C.sub = 'CMD'; C.buf = ''; C.info = text; C.flash = '';
      if (goSeg !== undefined) { C.goSeg = goSeg; C.goOff = goOff; C.seg = goSeg; }
      this.show(); this.emit();
    }
    conErr(msg) { const C = this.mon.con; C.flash = ('ERR ' + msg).slice(0, 16); C.flashFull = msg; }
    // k: a single character, or 'Enter' | 'Backspace' | 'Clear' | 'Esc'
    con(k) {
      const m = this.mon;
      if (m.mode === 'RUN') return;
      if (m.mode !== 'CON') {
        const info = m.mode === 'HALT' ? (this.haltLine1 || '') : '';
        m.mode = 'CON'; if (!m.con) this.conInit(); m.con.sub = 'CMD'; m.con.buf = ''; m.con.info = info || '8086 TRAINER';
        if (k === 'Enter' || k === 'Esc' || k === 'Clear' || k === 'Backspace') { this.show(); this.emit(); return; }
      }
      const C = m.con; C.flash = ''; C.flashFull = '';
      const browse = C.sub === 'D' || C.sub === 'U' || C.sub === 'R' || C.sub === 'T';
      if (k === 'Esc') { this.conLeave(); }
      else if (k === 'Clear') C.buf = '';
      else if (k === 'Backspace') { if (!browse) C.buf = C.buf.slice(0, -1); }
      else if (k === 'Enter') this.conEnter();
      else if (k.length === 1) {
        if (browse) { C.sub = 'CMD'; C.buf = ''; }
        if (C.buf.length < 40) C.buf += k.toUpperCase();
      }
      if (this.mon.mode !== 'RUN') this.show();
      this.emit();
    }
    conLeave() {
      const C = this.mon.con;
      if (C.sub === 'A') C.info = `END ${hex(C.seg, 4)}:${hex(C.off, 4)}`;
      else if (C.sub === 'M') C.info = `${hex(C.seg, 4)}:${hex(C.off, 4)}`;
      C.sub = 'CMD'; C.buf = '';
    }
    conPre(line) {   // DEBUG-style: numbers are hexadecimal unless written otherwise
      line = line.replace(/;.*$/, '').trim();
      const mm = /^([A-Za-z_?@$][\w]*)([\s\S]*)$/.exec(line);
      if (!mm) return line;
      const parts = mm[2].split(/('[^']*'|"[^"]*")/);
      const conv = parts.map((p, i) => i % 2 ? p : p.replace(/\b[0-9A-Fa-f]+\b/g, (t) => (/^[A-Fa-f]/.test(t) ? '0' : '') + t + 'H'));
      return mm[1] + conv.join('');
    }
    conCmd(s) {
      const C = this.mon.con;
      if (!s) return;
      const cmd = s[0], arg = s.slice(1).trim();
      const addr = (def) => {
        if (!arg) return def;
        const q = /^(?:([0-9A-F]{1,4}):)?([0-9A-F]{1,4})$/.exec(arg);
        if (!q) return null;
        return { seg: q[1] !== undefined ? parseInt(q[1], 16) : C.seg, off: parseInt(q[2], 16) };
      };
      const bad = () => { this.conErr('ADDRESS'); };
      switch (cmd) {
        case 'A': { const d = addr({ seg: C.seg, off: C.aoff }); if (!d) return bad(); C.seg = d.seg; C.off = d.off; C.aoff = d.off; C.sub = 'A'; C.last = ''; break; }
        case 'G': {
          const d = addr(C.goSeg !== null ? { seg: C.goSeg, off: C.goOff } : { seg: this.cpu.s[1], off: this.cpu.ip });
          if (!d) return bad(); C.goSeg = d.seg; C.goOff = d.off; C.seg = d.seg; this.startRun(d.seg, d.off); break;
        }
        case 'M': { const d = addr({ seg: C.seg, off: C.off }); if (!d) return bad(); C.seg = d.seg; C.off = d.off; C.sub = 'M'; break; }
        case 'D': { const d = addr({ seg: C.seg, off: C.off }); if (!d) return bad(); C.seg = d.seg; C.off = d.off; C.sub = 'D'; break; }
        case 'U': { const d = addr({ seg: C.seg, off: C.off }); if (!d) return bad(); C.seg = d.seg; C.off = d.off; C.sub = 'U'; break; }
        case 'R': {
          if (!arg) { C.sub = 'R'; C.regPage = 0; break; }
          if (REGNAMES.indexOf(arg) < 0) { this.conErr('REGISTER'); return; }
          C.sub = 'RR'; C.regIdx = REGNAMES.indexOf(arg); break;
        }
        case 'T': {
          if (arg) { const d = addr(null); if (!d) return bad(); this.cpu.s[1] = d.seg; this.cpu.ip = d.off; }
          C.sub = 'T'; this.conTrace(); break;
        }
        case '?': case 'H': C.info = 'A G M D U R T'; C.flash = ''; break;
        default: this.conErr('? A G M D U R T'); C.flashFull = `Unknown command "${s}". Commands: A (assemble), G (go), M (memory), D (dump), U (unassemble), R (registers), T (trace one instruction)`;
      }
    }
    conEnter() {
      const C = this.mon.con, buf = C.buf.trim();
      switch (C.sub) {
        case 'CMD': C.buf = ''; this.conCmd(buf); break;
        case 'A': this.conAsm(buf); break;
        case 'M': this.conMem(buf); break;
        case 'D': C.off = (C.off + 5) & 0xFFFF; break;
        case 'U': C.off = (C.off + C.ulen) & 0xFFFF; break;
        case 'R': C.regPage = (C.regPage + 1) % 4; break;
        case 'T': this.conTrace(); break;
        case 'RR': {
          const nm = REGNAMES[C.regIdx];
          if (buf) { if (!/^[0-9A-F]{1,4}$/.test(buf)) { this.conErr('HEX VALUE'); C.buf = ''; return; } this.setReg(nm, parseInt(buf, 16)); }
          C.sub = 'CMD'; C.buf = ''; C.info = `${nm}=${hex(this.getReg(nm), 4)}`; break;
        }
      }
    }
    conAsm(line) {
      const C = this.mon.con;
      if (!line) { this.conLeave(); return; }
      let res;
      try { res = ASM.assemble(`ORG ${hex(C.off, 4)}H\n${this.conPre(line)}\n`, { loadSeg: C.seg, defaultOrg: C.off }); }
      catch (e) { res = { ok: false, errors: [{ msg: e.message }] }; }
      if (!res.ok) { this.conErr(res.errors[0].msg); return; }
      let n = 0, first = [];
      for (const ch of res.image) for (let i = 0; i < ch.bytes.length; i++) {
        const a = (ch.phys + i) & 0xFFFFF;
        this.cpu.wb(a, ch.bytes[i]);
        if (this.cpu.rb(a) !== ch.bytes[i]) { this.conErr('NOT RAM'); return; }
        if (n < 3) first.push(ch.bytes[i]); n++;
      }
      C.last = first.map(b => hex(b, 2)).join('');
      C.off = (C.off + n) & 0xFFFF; C.aoff = C.off; C.buf = '';
    }
    conMem(buf) {
      const C = this.mon.con;
      if (buf === '.') { this.conLeave(); return; }
      if (buf === '-') C.off = (C.off - 1) & 0xFFFF;
      else if (buf) {
        if (!/^[0-9A-F]{1,2}$/.test(buf)) { this.conErr('HEX BYTE'); C.buf = ''; return; }
        this.writeMem(C.seg, C.off, parseInt(buf, 16)); C.off = (C.off + 1) & 0xFFFF;
      } else C.off = (C.off + 1) & 0xFFFF;
      C.buf = '';
    }
    conTrace() {
      const c = this.cpu;
      if (c.halted) { this.conErr('CPU HALTED'); return; }
      this.execOne();
      if (c.halted) this.onHaltInstruction();
      else { this.mon.con.seg = c.s[1]; }
    }
    conScreen() {
      const C = this.mon.con, c = this.cpu;
      const A = `${hex(C.seg, 4)}:${hex(C.off, 4)}`;
      let l1 = '', l2 = '', prefix = null, st = '';
      switch (C.sub) {
        case 'CMD': l1 = C.info; prefix = '-'; st = 'READY. A8000 = enter program, G8000 = run, M8500 = view memory, R = registers, U = unassemble, T = step'; break;
        case 'A': l1 = `${A} ${C.last}`; prefix = '>'; st = `ASSEMBLE at ${A}. Type an instruction + Enter (numbers are hex). Empty line = finish`; break;
        case 'M': l1 = `${A} =${hex(this.readByte(C.seg, C.off), 2)}`; prefix = 'NEW>'; st = 'MEMORY. Enter = next address, type a byte + Enter to change it, - = back, . = exit'; break;
        case 'D': { const b = []; for (let i = 0; i < 5; i++) b.push(hex(this.readByte(C.seg, C.off + i), 2)); l1 = A; l2 = b.join(' '); st = 'DUMP. Enter = next 5 bytes, any letter = new command'; break; }
        case 'U': { const d = this.dis(C.seg, C.off); C.ulen = d.len; const b = []; for (let i = 0; i < Math.min(3, d.len); i++) b.push(hex(this.readByte(C.seg, C.off + i), 2)); l1 = `${A} ${b.join('')}`; l2 = d.text; st = 'UNASSEMBLE. Enter = next instruction'; break; }
        case 'R': {
          const g = (n) => `${n}=${hex(this.getReg(n), 4)}`;
          const P = [['AX', 'BX', 'CX', 'DX'], ['SP', 'BP', 'SI', 'DI'], ['CS', 'DS', 'SS', 'ES'], ['IP', 'FL']][C.regPage];
          l1 = P.length === 4 ? `${g(P[0])} ${g(P[1])}` : `${g(P[0])} ${g(P[1])}`;
          if (P.length === 4) l2 = `${g(P[2])} ${g(P[3])}`; else { const f = c.getF(); l2 = FLAGSTR.map(([ch, b]) => ((f & b) ? ch : '.')).join(''); }
          st = 'REGISTERS. Enter = next page. To change one type R then its name, e.g. RAX'; break;
        }
        case 'RR': { const nm = REGNAMES[C.regIdx]; l1 = `${nm}=${hex(this.getReg(nm), 4)}`; prefix = 'NEW>'; st = `Type the new value of ${nm} (hex) + Enter`; break; }
        case 'T': { const d = this.dis(c.s[1], c.ip); const b = []; for (let i = 0; i < Math.min(3, d.len); i++) b.push(hex(this.readByte(c.s[1], c.ip + i), 2)); l1 = `${hex(c.s[1], 4)}:${hex(c.ip, 4)} ${b.join('')}`; l2 = d.text; st = 'TRACE. Enter = execute the next instruction shown. Type R to see registers'; break; }
      }
      if (C.flash) { l1 = C.flash; st = 'ERROR: ' + (C.flashFull || C.flash); }
      let cur = null;
      if (prefix !== null) { const full = prefix + C.buf; l2 = full.length > 15 ? full.slice(-15) : full; cur = [1, Math.min(full.length, 15)]; }
      this.status = st;
      return { l1, l2, cur };
    }

    /* ---- LCD text for the current monitor state ---- */
    show() {
      const m = this.mon, c = this.cpu;
      let l1 = '', l2 = '', cur = null;
      switch (m.mode) {
        case 'CON': { const r = this.conScreen(); l1 = r.l1; l2 = r.l2; cur = r.cur; break; }
        case 'IDLE': l1 = ' 8086 TRAINER KIT'; l2 = '     READY'; l1 = '  8086 TRAINER'; break;
        case 'MEM': {
          let byte, tag = '=';
          if (m.field === 'data') byte = m.dval; else byte = this.readByte(m.seg, m.off);
          l1 = `${hex(m.seg, 4)}:${hex(m.off, 4)}=${hex(byte, 2)}`;
          l2 = this.dis(m.seg, m.off).text;
          cur = m.field === 'data' ? [0, 11] : m.field === 'seg' ? [0, 3] : [0, 8];
          break;
        }
        case 'REG': {
          const nm = REGNAMES[m.regIdx], v = m.dirty ? m.rval : this.getReg(nm);
          l1 = `${nm}=${hex(v, 4)}`;
          if (nm === 'FL') l2 = FLAGSTR.map(([ch, b]) => ((v & b) ? ch : '.')).join('');
          else if (nm === 'IP') l2 = `AT ${hex(c.s[1], 4)}:${hex(v, 4)}`;
          cur = [0, nm.length + 4];
          break;
        }
        case 'GO':
          l1 = `GO ${hex(m.seg, 4)}:${hex(m.off, 4)}`; l2 = 'PRESS GO/ENTER';
          cur = m.field === 'seg' ? [0, 6] : [0, 11];
          break;
        case 'STEP': {
          const d = this.dis(c.s[1], c.ip);
          l1 = `${hex(c.s[1], 4)}:${hex(c.ip, 4)}=${hex(this.readByte(c.s[1], c.ip), 2)}`;
          l2 = d.text; break;
        }
        case 'HALT': l1 = this.haltLine1 || 'HALT'; l2 = this.haltLine2 || ''; break;
        case 'RUN': l1 = 'RUNNING...'; l2 = ''; break;
      }
      if (m.mode === 'RUN' && this.lcd.userOwned) { this.emit(); return; }
      this.lcd.printLines(pad16(l1), pad16(l2));
      if (cur) { this.lcd.cursorOn = true; this.lcd.blinkOn = true; this.lcd.ac = cur[1] + (cur[0] ? 0x40 : 0); }
    }

    /* ================= running ================= */
    startRun(seg, off) {
      const c = this.cpu, m = this.mon;
      c.s[1] = seg & 0xFFFF; c.ip = off & 0xFFFF; c.halted = false;
      m.mode = 'RUN'; this.lcd.userOwned = false; this.skipBp = true; this.breakHit = false;
      this.status = `RUNNING ${hex(seg, 4)}:${hex(off, 4)}`;
      this.lcd.printLines(pad16('RUNNING...'), pad16(''));
      this.lcd.userOwned = false;
      this.emit();
    }
    isStub() {
      const c = this.cpu;
      return c.s[1] === STUB_SEG && ((c.ip >= 0x0100 && c.ip < 0x0200) || c.ip === 0x0000);
    }
    // called whenever CS:IP is inside the ROM stubs (INT with default vector / return to monitor)
    handleStub() {
      const c = this.cpu, m = this.mon;
      let l1, l2;
      if (c.ip === 0x0000) {
        l1 = 'PROGRAM END'; l2 = 'RETURNED TO MON'; this.status = 'PROGRAM RETURNED TO MONITOR';
      } else {
        const n = c.ip - 0x0100;
        // unwind the interrupt frame so registers show the user's state
        const ip = c.pop(), cs = c.pop(), fl = c.pop();
        c.ip = ip; c.s[1] = cs; c.setF(fl);
        if (n === 3) {
          // INT3 breakpoint: IP already points after the INT3 byte
          l1 = 'BREAK AT'; l2 = `${hex(cs, 4)}:${hex((ip - 1) & 0xFFFF, 4)}`; this.status = `BREAKPOINT (INT 3) AT ${l2}`;
        } else {
          l1 = `UNHANDLED INT ${hex(n, 2)}`; l2 = `${hex(cs, 4)}:${hex(ip, 4)}`;
          this.status = n === 0 ? `DIVIDE ERROR (INT 0) — instruction before ${l2}` : `UNHANDLED INTERRUPT ${hex(n, 2)}H at ${l2}`;
        }
      }
      this.haltLine1 = l1; this.haltLine2 = l2;
      m.mode = 'HALT'; c.halted = false;
      this.afterStop();
    }
    afterStop() {
      if (!(this.lcd.userOwned && this.mon.mode === 'HALT')) this.show();
      this.emit();
    }
    onHaltInstruction() {
      const c = this.cpu, m = this.mon;
      m.mode = 'HALT';
      const at = (c.ip - 1) & 0xFFFF;
      this.haltLine1 = 'HLT EXECUTED'; this.haltLine2 = `AT ${hex(c.s[1], 4)}:${hex(at, 4)}`;
      this.status = `HLT executed at ${hex(c.s[1], 4)}:${hex(at, 4)} — program ended (RESET to restart)`;
      this.afterStop();
    }
    stepOne() {
      const c = this.cpu;
      if (c.halted) { this.status = 'CPU HALTED — press RESET'; return 'halted'; }
      this.execOne();
      if (this.mon.mode === 'STEP') {
        if (c.halted) { this.onHaltInstruction(); this.mon.mode = 'HALT'; }
        else this.status = `STEP  ${hex(c.s[1], 4)}:${hex(c.ip, 4)}`;
      }
      return null;
    }
    execOne() {
      const c = this.cpu;
      if (this.traceEnabled) {
        const d = this.dis(c.s[1], c.ip);
        this.trace.push({ cs: c.s[1], ip: c.ip, text: d.text, ax: c.r[0], bx: c.r[3], cx: c.r[1], dx: c.r[2] });
        if (this.trace.length > 300) this.trace.shift();
      }
      c.step();
      if (this.isStub()) this.handleStub();
    }
    // advance emulation by real elapsed ms; returns number of instructions executed
    tick(dtMs) {
      const m = this.mon, c = this.cpu;
      if (m.mode !== 'RUN') return 0;
      const speed = this.cfg.speed;
      const unlimited = !isFinite(speed);
      let budget = unlimited ? Infinity : this.cfg.clockHz * (dtMs / 1000) * speed;
      const maxInstr = unlimited ? 400000 : 4000000;
      const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      let n = 0;
      while (budget > 0 && n < maxInstr) {
        if (!this.skipBp && this.breakpoints.size && this.breakpoints.has((((c.s[1] << 4) + c.ip) & 0xFFFFF))) {
          m.mode = 'HALT'; this.haltLine1 = 'BREAKPOINT'; this.haltLine2 = `${hex(c.s[1], 4)}:${hex(c.ip, 4)}`;
          this.status = `Breakpoint at ${hex(c.s[1], 4)}:${hex(c.ip, 4)}`; this.breakHit = true; this.afterStop(); return n;
        }
        const before = c.cycles;
        this.skipBp = false;
        c.step(); n++;
        budget -= (c.cycles - before);
        if (c.halted) { this.onHaltInstruction(); return n; }
        if (this.isStub()) { this.handleStub(); return n; }
        if ((n & 0x3FF) === 0) { const t = (typeof performance !== 'undefined') ? performance.now() : Date.now(); if (t - t0 > 12) break; }
      }
      return n;
    }
    // run synchronously until stop (for tests); returns instruction count
    runUntilStop(maxInstr) {
      const m = this.mon, c = this.cpu; let n = 0;
      while (m.mode === 'RUN' && n < (maxInstr || 5e6)) {
        if (!this.skipBp && this.breakpoints.has((((c.s[1] << 4) + c.ip) & 0xFFFFF))) { m.mode = 'HALT'; this.status = 'breakpoint'; break; }
        this.skipBp = false;
        c.step(); n++;
        if (c.halted) { this.onHaltInstruction(); break; }
        if (this.isStub()) { this.handleStub(); break; }
      }
      return n;
    }
    // convenience for tests / UI: press a sequence of keys
    keys(seq) { for (const k of seq) this.key(k); }
  }

  const api = { Trainer, LCD44780, PPI8255, REGNAMES, hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TrainerKit = api;
})(typeof window !== 'undefined' ? window : globalThis);
