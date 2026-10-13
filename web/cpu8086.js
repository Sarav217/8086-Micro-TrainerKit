/* =====================================================================
 *  Intel 8086 CPU core  (instruction-accurate, flag-accurate)
 *  - Complete 8086 instruction set incl. BCD, string ops, REP, INT/IRET
 *  - 20-bit address space, segment:offset wrap behaviour of the real chip
 *  - 8086 specific behaviour:  PUSH SP pushes the *new* SP, shifts are not
 *    masked to 5 bits, flags bits 12-15 read as 1, 60-6F alias to 70-7F, etc.
 *  Works in the browser (window.CPU8086) and in Node (module.exports).
 * ===================================================================== */
(function (root) {
  'use strict';

  const CF = 0x0001, PF = 0x0004, AF = 0x0010, ZF = 0x0040, SF = 0x0080,
        TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800;
  const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
  const ES = 0, CS = 1, SS = 2, DS = 3;

  const PAR = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let b = i, n = 0;
    while (b) { n ^= b & 1; b >>= 1; }
    PAR[i] = n ? 0 : 1;               // 1 => even parity
  }

  // memory page types
  const RAM = 0, ROM = 1, NONE = 2, MMIO = 3;

  class CPU8086 {
    constructor() {
      this.mem = new Uint8Array(0x100000);
      this.pageType = new Uint8Array(256);       // 4 KB pages
      this.mmio = null;                          // {rd(addr), wr(addr,v)}
      this.io = null;                            // {in(port,w) , out(port,w,v)}
      this.r = new Uint16Array(8);
      this.s = new Uint16Array(4);
      this.ip = 0;
      this.f = 0xF002;
      this.halted = false;
      this.instrCount = 0;
      this.onInterrupt = null;                   // hook: (n) => true if handled in JS
      this.seg = -1; this.rep = 0; this.lock = false;
      this.mod = 0; this.reg = 0; this.rm = 0; this.ea = 0; this.eaSeg = 3;
      this.trapPending = false;
      this.cycles = 0;            // total clock cycles executed (documented 8086 timings)
      this.lastCycles = 0;
      this.eac = 0; this.oddPen = 0; this.taken = false; this.repN = 0; this.shiftN = 0; this.opc = 0;
      this.reset();
    }

    reset() {
      this.r.fill(0); this.s.fill(0);
      this.s[CS] = 0xFFFF; this.ip = 0; this.f = 0xF002; this.halted = false;
      this.seg = -1; this.rep = 0;
    }

    /* ---------------- memory ---------------- */
    setPages(start, endIncl, type) {
      for (let p = start >> 12; p <= (endIncl >> 12); p++) this.pageType[p] = type;
    }
    rb(a) {
      a &= 0xFFFFF;
      const t = this.pageType[a >> 12];
      if (t === RAM || t === ROM) return this.mem[a];
      if (t === MMIO && this.mmio) return this.mmio.rd(a) & 0xFF;
      return 0xFF;
    }
    wb(a, v) {
      a &= 0xFFFFF;
      const t = this.pageType[a >> 12];
      if (t === RAM) this.mem[a] = v;
      else if (t === MMIO && this.mmio) this.mmio.wr(a, v & 0xFF);
    }
    // segmented accessors (offset wraps inside the 64K segment)
    rbs(seg, off) { return this.rb(((seg << 4) + (off & 0xFFFF))); }
    wbs(seg, off, v) { this.wb(((seg << 4) + (off & 0xFFFF)), v); }
    rws(seg, off) { if (off & 1) this.oddPen += 4; return this.rbs(seg, off) | (this.rbs(seg, off + 1) << 8); }
    wws(seg, off, v) { if (off & 1) this.oddPen += 4; this.wbs(seg, off, v & 0xFF); this.wbs(seg, off + 1, (v >> 8) & 0xFF); }

    /* ---------------- fetch ---------------- */
    fetch8() {
      const v = this.rb((this.s[CS] << 4) + this.ip);
      this.ip = (this.ip + 1) & 0xFFFF;
      return v;
    }
    fetch16() { const lo = this.fetch8(); return lo | (this.fetch8() << 8); }

    /* ---------------- stack ---------------- */
    push(v) {
      this.r[SP] = (this.r[SP] - 2) & 0xFFFF;
      this.wws(this.s[SS], this.r[SP], v);
    }
    pop() {
      const v = this.rws(this.s[SS], this.r[SP]);
      this.r[SP] = (this.r[SP] + 2) & 0xFFFF;
      return v;
    }

    /* ---------------- registers ---------------- */
    getReg(i, w) {
      if (w) return this.r[i];
      return i < 4 ? (this.r[i] & 0xFF) : (this.r[i - 4] >> 8);
    }
    setReg(i, w, v) {
      if (w) this.r[i] = v;
      else if (i < 4) this.r[i] = (this.r[i] & 0xFF00) | (v & 0xFF);
      else this.r[i - 4] = (this.r[i - 4] & 0x00FF) | ((v & 0xFF) << 8);
    }

    /* ---------------- flags ---------------- */
    getF() { return (this.f & 0x0FD5) | 0xF002; }
    setF(v) { this.f = (v & 0x0FD5) | 0xF002; }
    fl(m) { return (this.f & m) !== 0; }
    sf(m, c) { if (c) this.f |= m; else this.f &= ~m; }
    szp(res, w) {
      const m = w ? 0xFFFF : 0xFF;
      res &= m;
      this.sf(ZF, res === 0);
      this.sf(SF, (res >> (w ? 15 : 7)) & 1);
      this.sf(PF, PAR[res & 0xFF]);
    }

    /* ---------------- ModRM ---------------- */
    modrm() {
      const m = this.fetch8();
      const mod = m >> 6, rm = m & 7;
      this.mod = mod; this.reg = (m >> 3) & 7; this.rm = rm;
      if (mod === 3) return;
      const r = this.r;
      let off = 0, seg = DS;
      switch (rm) {
        case 0: off = r[BX] + r[SI]; break;
        case 1: off = r[BX] + r[DI]; break;
        case 2: off = r[BP] + r[SI]; seg = SS; break;
        case 3: off = r[BP] + r[DI]; seg = SS; break;
        case 4: off = r[SI]; break;
        case 5: off = r[DI]; break;
        case 6:
          if (mod === 0) { off = this.fetch16(); } else { off = r[BP]; seg = SS; }
          break;
        case 7: off = r[BX]; break;
      }
      if (mod === 1) { const d = this.fetch8(); off += (d & 0x80) ? d - 256 : d; }
      else if (mod === 2) off += this.fetch16();
      this.ea = off & 0xFFFF;
      this.eaSeg = this.seg >= 0 ? this.seg : seg;
      // effective-address clocks (Intel 8086 manual table)
      let c;
      if (mod === 0 && rm === 6) c = 6;
      else if (mod === 0) c = (rm === 0 || rm === 3) ? (rm === 0 ? 7 : 7) : (rm === 1 || rm === 2) ? 8 : 5;
      else c = (rm === 0 || rm === 3) ? 11 : (rm === 1 || rm === 2) ? 12 : 9;
      this.eac = c;
    }
    rdRM(w) {
      if (this.mod === 3) return this.getReg(this.rm, w);
      return w ? this.rws(this.s[this.eaSeg], this.ea) : this.rbs(this.s[this.eaSeg], this.ea);
    }
    wrRM(w, v) {
      if (this.mod === 3) this.setReg(this.rm, w, v);
      else if (w) this.wws(this.s[this.eaSeg], this.ea, v);
      else this.wbs(this.s[this.eaSeg], this.ea, v);
    }

    /* ---------------- ALU ---------------- */
    add(a, b, c, w) {
      const m = w ? 0xFFFF : 0xFF, sg = w ? 0x8000 : 0x80;
      const res = a + b + c, r = res & m;
      this.sf(CF, res > m);
      this.sf(AF, (a ^ b ^ r) & 0x10);
      this.sf(OF, (a ^ r) & (b ^ r) & sg);
      this.szp(r, w);
      return r;
    }
    sub(a, b, c, w) {
      const m = w ? 0xFFFF : 0xFF, sg = w ? 0x8000 : 0x80;
      const res = a - b - c, r = res & m;
      this.sf(CF, res < 0);
      this.sf(AF, (a ^ b ^ r) & 0x10);
      this.sf(OF, (a ^ b) & (a ^ r) & sg);
      this.szp(r, w);
      return r;
    }
    alu(op, a, b, w) {
      let r;
      switch (op) {
        case 0: return this.add(a, b, 0, w);
        case 1: r = a | b; break;
        case 2: return this.add(a, b, this.f & CF, w);
        case 3: return this.sub(a, b, this.f & CF, w);
        case 4: r = a & b; break;
        case 5: return this.sub(a, b, 0, w);
        case 6: r = a ^ b; break;
        case 7: this.sub(a, b, 0, w); return a;
      }
      this.f &= ~(CF | OF | AF);
      this.szp(r, w);
      return r;
    }
    inc(a, w) {
      const m = w ? 0xFFFF : 0xFF, sg = w ? 0x8000 : 0x80;
      const r = (a + 1) & m;
      this.sf(AF, (a ^ 1 ^ r) & 0x10);
      this.sf(OF, r === sg);
      this.szp(r, w);
      return r;
    }
    dec(a, w) {
      const m = w ? 0xFFFF : 0xFF, sg = w ? 0x8000 : 0x80;
      const r = (a - 1) & m;
      this.sf(AF, (a ^ 1 ^ r) & 0x10);
      this.sf(OF, a === sg);
      this.szp(r, w);
      return r;
    }

    /* shifts / rotates (8086: count NOT masked) */
    shift(op, v, cnt, w) {
      const bits = w ? 16 : 8, m = w ? 0xFFFF : 0xFF, top = w ? 0x8000 : 0x80;
      if (cnt === 0) return v;
      let cf = this.f & CF ? 1 : 0, of = 0;
      let res = v & m;
      switch (op) {
        case 0: // ROL
          for (let i = 0; i < cnt; i++) { cf = (res & top) ? 1 : 0; res = ((res << 1) | cf) & m; }
          of = ((res & top) ? 1 : 0) ^ cf;
          this.sf(CF, cf); this.sf(OF, of); return res;
        case 1: // ROR
          for (let i = 0; i < cnt; i++) { cf = res & 1; res = (res >> 1) | (cf ? top : 0); }
          of = ((res & top) ? 1 : 0) ^ ((res & (top >> 1)) ? 1 : 0);
          this.sf(CF, cf); this.sf(OF, of); return res;
        case 2: // RCL
          for (let i = 0; i < cnt; i++) { const t = (res & top) ? 1 : 0; res = ((res << 1) | cf) & m; cf = t; }
          of = ((res & top) ? 1 : 0) ^ cf;
          this.sf(CF, cf); this.sf(OF, of); return res;
        case 3: // RCR
          for (let i = 0; i < cnt; i++) { const t = res & 1; res = (res >> 1) | (cf ? top : 0); cf = t; }
          of = ((res & top) ? 1 : 0) ^ ((res & (top >> 1)) ? 1 : 0);
          this.sf(CF, cf); this.sf(OF, of); return res;
        case 4: case 6: // SHL / SAL
          for (let i = 0; i < cnt; i++) { cf = (res & top) ? 1 : 0; res = (res << 1) & m; }
          of = ((res & top) ? 1 : 0) ^ cf;
          this.sf(CF, cf); this.sf(OF, of); this.szp(res, w); this.sf(AF, 0); return res;
        case 5: // SHR
          for (let i = 0; i < cnt; i++) { of = (res & top) ? 1 : 0; cf = res & 1; res >>= 1; }
          this.sf(CF, cf); this.sf(OF, of); this.szp(res, w); this.sf(AF, 0); return res;
        case 7: { // SAR
          const sign = res & top;
          for (let i = 0; i < cnt; i++) { cf = res & 1; res = (res >> 1) | sign; }
          this.sf(CF, cf); this.sf(OF, 0); this.szp(res, w); this.sf(AF, 0); return res;
        }
      }
    }

    /* ---------------- interrupts ---------------- */
    interrupt(n) {
      if (this.onInterrupt && this.onInterrupt(n)) return;
      this.push(this.getF());
      this.f &= ~(IF | TF);
      this.push(this.s[CS]);
      this.push(this.ip);
      this.ip = this.rws(0, n * 4);
      this.s[CS] = this.rws(0, n * 4 + 2);
    }

    cond(c) {
      const f = this.f;
      let r;
      switch (c >> 1) {
        case 0: r = (f & OF) !== 0; break;
        case 1: r = (f & CF) !== 0; break;
        case 2: r = (f & ZF) !== 0; break;
        case 3: r = (f & (CF | ZF)) !== 0; break;
        case 4: r = (f & SF) !== 0; break;
        case 5: r = (f & PF) !== 0; break;
        case 6: r = ((f & SF) !== 0) !== ((f & OF) !== 0); break;
        case 7: r = (f & ZF) !== 0 || (((f & SF) !== 0) !== ((f & OF) !== 0)); break;
      }
      return (c & 1) ? !r : r;
    }

    /* signed helpers */
    static s8(v) { return (v & 0x80) ? v - 256 : v; }
    static s16(v) { return (v & 0x8000) ? v - 65536 : v; }

    /* ---------------- group 3 (F6/F7) ---------------- */
    group3(w) {
      this.modrm();
      const op = this.reg;
      const v = this.rdRM(w);
      const r = this.r;
      switch (op) {
        case 0: case 1: { // TEST rm, imm
          const imm = w ? this.fetch16() : this.fetch8();
          this.alu(4, v, imm, w); break;
        }
        case 2: this.wrRM(w, (~v) & (w ? 0xFFFF : 0xFF)); break;     // NOT
        case 3: { // NEG
          const res = this.sub(0, v, 0, w);
          this.sf(CF, v !== 0);
          this.wrRM(w, res); break;
        }
        case 4: { // MUL
          if (w) {
            const p = r[AX] * v; r[AX] = p & 0xFFFF; r[DX] = (p >>> 16) & 0xFFFF;
            this.sf(CF, r[DX] !== 0); this.sf(OF, r[DX] !== 0);
            this.szp(r[AX], 1);
          } else {
            const p = (r[AX] & 0xFF) * v; r[AX] = p & 0xFFFF;
            const hi = (p >> 8) !== 0; this.sf(CF, hi); this.sf(OF, hi);
            this.szp(r[AX] & 0xFF, 0);
          }
          this.sf(AF, 0);
          break;
        }
        case 5: { // IMUL
          if (w) {
            const p = CPU8086.s16(r[AX]) * CPU8086.s16(v);
            r[AX] = p & 0xFFFF; r[DX] = (p >> 16) & 0xFFFF;
            const ext = p !== CPU8086.s16(r[AX]);
            this.sf(CF, ext); this.sf(OF, ext);
            this.szp(r[AX], 1);
          } else {
            const p = CPU8086.s8(r[AX] & 0xFF) * CPU8086.s8(v);
            r[AX] = p & 0xFFFF;
            const ext = p !== CPU8086.s8(r[AX] & 0xFF);
            this.sf(CF, ext); this.sf(OF, ext);
            this.szp(r[AX] & 0xFF, 0);
          }
          this.sf(AF, 0);
          if (this.rep) {   // 8086 quirk: REP before IMUL negates the product
            if (w) {
              let full = ((r[DX] << 16) | r[AX]) | 0; full = (-full) | 0;
              r[AX] = full & 0xFFFF; r[DX] = (full >>> 16) & 0xFFFF;
            } else { r[AX] = (-CPU8086.s16(r[AX])) & 0xFFFF; }
          }
          break;
        }
        case 6: { // DIV
          if (w) {
            const n = ((r[DX] << 16) | r[AX]) >>> 0;
            if (v === 0) { this.divErr(); return; }
            const q = Math.floor(n / v);
            if (q > 0xFFFF) { this.divErr(); return; }
            r[AX] = q; r[DX] = n % v;
          } else {
            const n = r[AX];
            if (v === 0) { this.divErr(); return; }
            const q = Math.floor(n / v);
            if (q > 0xFF) { this.divErr(); return; }
            r[AX] = (((n % v) & 0xFF) << 8) | q;
          }
          break;
        }
        case 7: { // IDIV
          if (w) {
            const n = (r[DX] << 16) | r[AX];
            const d = CPU8086.s16(v);
            if (d === 0) { this.divErr(); return; }
            let q = Math.trunc(n / d);
            let rem = n - q * d;
            if (this.rep) q = -q;
            if (q > 0x7FFF || q < -0x7FFF) { this.divErr(); return; }
            r[AX] = q & 0xFFFF; r[DX] = rem & 0xFFFF;
          } else {
            const n = CPU8086.s16(r[AX]);
            const d = CPU8086.s8(v);
            if (d === 0) { this.divErr(); return; }
            let q = Math.trunc(n / d);
            let rem = n - q * d;
            if (this.rep) q = -q;
            if (q > 0x7F || q < -0x7F) { this.divErr(); return; }
            r[AX] = ((rem & 0xFF) << 8) | (q & 0xFF);
          }
          break;
        }
      }
    }
    divErr() { this.interrupt(0); }

    /* ---------------- string helpers ---------------- */
    strStep(op, w) {
      const r = this.r, d = (this.f & DF) ? -(w ? 2 : 1) : (w ? 2 : 1);
      const srcSeg = this.seg >= 0 ? this.seg : DS;
      switch (op) {
        case 0xA4: case 0xA5: { // MOVS
          const v = w ? this.rws(this.s[srcSeg], r[SI]) : this.rbs(this.s[srcSeg], r[SI]);
          if (w) this.wws(this.s[ES], r[DI], v); else this.wbs(this.s[ES], r[DI], v);
          r[SI] = (r[SI] + d) & 0xFFFF; r[DI] = (r[DI] + d) & 0xFFFF; break;
        }
        case 0xA6: case 0xA7: { // CMPS
          const a = w ? this.rws(this.s[srcSeg], r[SI]) : this.rbs(this.s[srcSeg], r[SI]);
          const b = w ? this.rws(this.s[ES], r[DI]) : this.rbs(this.s[ES], r[DI]);
          this.sub(a, b, 0, w);
          r[SI] = (r[SI] + d) & 0xFFFF; r[DI] = (r[DI] + d) & 0xFFFF; break;
        }
        case 0xAA: case 0xAB: { // STOS
          if (w) this.wws(this.s[ES], r[DI], r[AX]); else this.wbs(this.s[ES], r[DI], r[AX] & 0xFF);
          r[DI] = (r[DI] + d) & 0xFFFF; break;
        }
        case 0xAC: case 0xAD: { // LODS
          if (w) r[AX] = this.rws(this.s[srcSeg], r[SI]);
          else r[AX] = (r[AX] & 0xFF00) | this.rbs(this.s[srcSeg], r[SI]);
          r[SI] = (r[SI] + d) & 0xFFFF; break;
        }
        case 0xAE: case 0xAF: { // SCAS
          const b = w ? this.rws(this.s[ES], r[DI]) : this.rbs(this.s[ES], r[DI]);
          this.sub(w ? r[AX] : (r[AX] & 0xFF), b, 0, w);
          r[DI] = (r[DI] + d) & 0xFFFF; break;
        }
      }
    }

    /* ======================================================
     *  Execute exactly ONE instruction (with all prefixes).
     *  Returns number of bytes of the instruction (approx) or 0.
     * ====================================================== */
    step() {
      if (this.halted) return 0;
      const startTF = (this.f & TF) !== 0;
      this.seg = -1; this.rep = 0; this.lock = false;
      this.mod = 3; this.eac = 0; this.oddPen = 0; this.taken = false; this.repN = 0; this.shiftN = 0;
      let op, npfx = 0;
      for (;;) {
        op = this.fetch8();
        if (op === 0x26) this.seg = ES;
        else if (op === 0x2E) this.seg = CS;
        else if (op === 0x36) this.seg = SS;
        else if (op === 0x3E) this.seg = DS;
        else if (op === 0xF0 || op === 0xF1) this.lock = true;
        else if (op === 0xF2) this.rep = 2;
        else if (op === 0xF3) this.rep = 1;
        else break;
        npfx++;
      }
      this.opc = op;
      this.exec(op);
      this.instrCount++;
      this.lastCycles = this.timing(op) + this.oddPen + (this.seg >= 0 ? 2 : 0) + (this.lock ? 2 : 0) * 1;
      this.cycles += this.lastCycles;
      if (startTF && !this.halted) this.interrupt(1);
      return 1;
    }

    exec(op) {
      const r = this.r, s = this.s;
      const w = op & 1;
      // 8086 aliases
      if (op >= 0x60 && op <= 0x6F) op += 0x10;
      else if (op === 0xC0) op = 0xC2; else if (op === 0xC1) op = 0xC3;
      else if (op === 0xC8) op = 0xCA; else if (op === 0xC9) op = 0xCB;

      if (op < 0x40) {
        const lo = op & 7;
        if (lo < 6) {
          const aop = (op >> 3) & 7;
          if (lo < 4) {
            const ww = lo & 1;
            this.modrm();
            if (lo < 2) { // rm, reg
              const res = this.alu(aop, this.rdRM(ww), this.getReg(this.reg, ww), ww);
              if (aop !== 7) this.wrRM(ww, res);
            } else {      // reg, rm
              const res = this.alu(aop, this.getReg(this.reg, ww), this.rdRM(ww), ww);
              if (aop !== 7) this.setReg(this.reg, ww, res);
            }
          } else if (lo === 4) {
            const res = this.alu(aop, r[AX] & 0xFF, this.fetch8(), 0);
            if (aop !== 7) r[AX] = (r[AX] & 0xFF00) | res;
          } else {
            const res = this.alu(aop, r[AX], this.fetch16(), 1);
            if (aop !== 7) r[AX] = res;
          }
          return;
        }
        // lo 6,7 : push/pop seg, prefixes handled, BCD
        switch (op) {
          case 0x06: this.push(s[ES]); return;
          case 0x07: s[ES] = this.pop(); return;
          case 0x0E: this.push(s[CS]); return;
          case 0x0F: s[CS] = this.pop(); return;           // 8086: POP CS
          case 0x16: this.push(s[SS]); return;
          case 0x17: s[SS] = this.pop(); return;
          case 0x1E: this.push(s[DS]); return;
          case 0x1F: s[DS] = this.pop(); return;
          case 0x27: { // DAA  (8086 hardware: second adjust tests original AL > 9Fh)
            let al = r[AX] & 0xFF; const oldAl = al, oldCf = this.f & CF, oldAf = this.f & AF;
            if ((al & 0x0F) > 9 || oldAf) { al += 6; this.sf(AF, 1); } else this.sf(AF, 0);
            if (oldAl > 0x9F || (oldAl > 0x99 && !oldAf) || oldCf) { al += 0x60; this.sf(CF, 1); } else this.sf(CF, 0);
            al &= 0xFF; r[AX] = (r[AX] & 0xFF00) | al; this.szp(al, 0); return;
          }
          case 0x2F: { // DAS
            let al = r[AX] & 0xFF; const oldAl = al, oldCf = this.f & CF, oldAf = this.f & AF;
            if ((al & 0x0F) > 9 || oldAf) { al -= 6; this.sf(AF, 1); } else this.sf(AF, 0);
            if (oldAl > 0x9F || (oldAl > 0x99 && !oldAf) || oldCf) { al -= 0x60; this.sf(CF, 1); } else this.sf(CF, 0);
            al &= 0xFF; r[AX] = (r[AX] & 0xFF00) | al; this.szp(al, 0); return;
          }
          case 0x37: { // AAA
            let al = r[AX] & 0xFF, ah = r[AX] >> 8;
            if ((al & 0x0F) > 9 || (this.f & AF)) { al = (al + 6) & 0xFF; ah = (ah + 1) & 0xFF; this.sf(AF, 1); this.sf(CF, 1); }
            else { this.sf(AF, 0); this.sf(CF, 0); }
            r[AX] = (ah << 8) | (al & 0x0F); return;
          }
          case 0x3F: { // AAS
            let al = r[AX] & 0xFF, ah = r[AX] >> 8;
            if ((al & 0x0F) > 9 || (this.f & AF)) { al = (al - 6) & 0xFF; ah = (ah - 1) & 0xFF; this.sf(AF, 1); this.sf(CF, 1); }
            else { this.sf(AF, 0); this.sf(CF, 0); }
            r[AX] = (ah << 8) | (al & 0x0F); return;
          }
        }
        return;
      }

      if (op < 0x50) { // INC/DEC r16
        const i = op & 7;
        r[i] = (op < 0x48) ? this.inc(r[i], 1) : this.dec(r[i], 1);
        return;
      }
      if (op < 0x58) { const i = op & 7; this.push(i === SP ? ((r[SP] - 2) & 0xFFFF) : r[i]); return; }   // 8086: PUSH SP pushes the decremented value
      if (op < 0x60) { const i = op & 7; const v = this.pop(); r[i] = v; return; }

      if (op >= 0x70 && op <= 0x7F) {
        const d = CPU8086.s8(this.fetch8());
        if (this.cond(op & 15)) { this.ip = (this.ip + d) & 0xFFFF; this.taken = true; }
        return;
      }

      switch (op) {
        case 0x80: case 0x81: case 0x82: case 0x83: {
          this.modrm();
          const ww = op & 1;
          const a = this.rdRM(ww);
          let b;
          if (op === 0x81) b = this.fetch16();
          else if (op === 0x83) { b = CPU8086.s8(this.fetch8()) & 0xFFFF; }
          else b = this.fetch8();
          if (op === 0x83 && !ww) b &= 0xFF;
          const aop = this.reg;
          const res = this.alu(aop, a, ww ? b : (b & 0xFF), ww);
          if (aop !== 7) this.wrRM(ww, res);
          return;
        }
        case 0x84: case 0x85: {
          this.modrm();
          this.alu(4, this.rdRM(w), this.getReg(this.reg, w), w); return;
        }
        case 0x86: case 0x87: {
          this.modrm();
          const a = this.rdRM(w), b = this.getReg(this.reg, w);
          this.wrRM(w, b); this.setReg(this.reg, w, a); return;
        }
        case 0x88: this.modrm(); this.wrRM(0, this.getReg(this.reg, 0)); return;
        case 0x89: this.modrm(); this.wrRM(1, this.getReg(this.reg, 1)); return;
        case 0x8A: this.modrm(); this.setReg(this.reg, 0, this.rdRM(0)); return;
        case 0x8B: this.modrm(); this.setReg(this.reg, 1, this.rdRM(1)); return;
        case 0x8C: this.modrm(); this.wrRM(1, s[this.reg & 3]); return;
        case 0x8D: this.modrm(); if (this.mod !== 3) this.setReg(this.reg, 1, this.ea); return;
        case 0x8E: this.modrm(); s[this.reg & 3] = this.rdRM(1); return;
        case 0x8F: { // POP rm
          const v = this.pop();
          this.modrm(); this.wrRM(1, v); return;
        }
        case 0x90: return;
        case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97: {
          const i = op & 7; const t = r[AX]; r[AX] = r[i]; r[i] = t; return;
        }
        case 0x98: r[AX] = (r[AX] & 0x80) ? (r[AX] & 0xFF) | 0xFF00 : (r[AX] & 0xFF); return;
        case 0x99: r[DX] = (r[AX] & 0x8000) ? 0xFFFF : 0; return;
        case 0x9A: { const o = this.fetch16(), sg = this.fetch16(); this.push(s[CS]); this.push(this.ip); this.ip = o; s[CS] = sg; return; }
        case 0x9B: return; // WAIT
        case 0x9C: this.push(this.getF()); return;
        case 0x9D: this.setF(this.pop()); return;
        case 0x9E: this.setF((this.f & 0xFF00) | ((r[AX] >> 8) & 0xD5)); return;
        case 0x9F: r[AX] = (r[AX] & 0x00FF) | ((this.getF() & 0xFF) << 8); return;
        case 0xA0: { const o = this.fetch16(); const sg = this.seg >= 0 ? this.seg : DS; r[AX] = (r[AX] & 0xFF00) | this.rbs(s[sg], o); return; }
        case 0xA1: { const o = this.fetch16(); const sg = this.seg >= 0 ? this.seg : DS; r[AX] = this.rws(s[sg], o); return; }
        case 0xA2: { const o = this.fetch16(); const sg = this.seg >= 0 ? this.seg : DS; this.wbs(s[sg], o, r[AX] & 0xFF); return; }
        case 0xA3: { const o = this.fetch16(); const sg = this.seg >= 0 ? this.seg : DS; this.wws(s[sg], o, r[AX]); return; }
        case 0xA4: case 0xA5: case 0xA6: case 0xA7:
        case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF: {
          const ww = op & 1;
          if (!this.rep) { this.strStep(op, ww); return; }
          const isCmp = (op === 0xA6 || op === 0xA7 || op === 0xAE || op === 0xAF);
          while (r[CX] !== 0) {
            this.strStep(op, ww); this.repN++;
            r[CX] = (r[CX] - 1) & 0xFFFF;
            if (isCmp) {
              const z = (this.f & ZF) !== 0;
              if (this.rep === 1 && !z) break;     // REPE
              if (this.rep === 2 && z) break;      // REPNE
            }
          }
          return;
        }
        case 0xA8: this.alu(4, r[AX] & 0xFF, this.fetch8(), 0); return;
        case 0xA9: this.alu(4, r[AX], this.fetch16(), 1); return;
        case 0xB0: case 0xB1: case 0xB2: case 0xB3: case 0xB4: case 0xB5: case 0xB6: case 0xB7:
          this.setReg(op & 7, 0, this.fetch8()); return;
        case 0xB8: case 0xB9: case 0xBA: case 0xBB: case 0xBC: case 0xBD: case 0xBE: case 0xBF:
          r[op & 7] = this.fetch16(); return;
        case 0xC2: { const n = this.fetch16(); this.ip = this.pop(); r[SP] = (r[SP] + n) & 0xFFFF; return; }
        case 0xC3: this.ip = this.pop(); return;
        case 0xC4: case 0xC5: {
          this.modrm();
          if (this.mod === 3) return;
          const sg = s[this.eaSeg];
          const off = this.rws(sg, this.ea), seg2 = this.rws(sg, this.ea + 2);
          r[this.reg] = off; s[op === 0xC4 ? ES : DS] = seg2; return;
        }
        case 0xC6: { this.modrm(); this.wrRM(0, this.fetch8()); return; }
        case 0xC7: { this.modrm(); this.wrRM(1, this.fetch16()); return; }
        case 0xCA: { const n = this.fetch16(); this.ip = this.pop(); s[CS] = this.pop(); r[SP] = (r[SP] + n) & 0xFFFF; return; }
        case 0xCB: this.ip = this.pop(); s[CS] = this.pop(); return;
        case 0xCC: this.interrupt(3); return;
        case 0xCD: this.interrupt(this.fetch8()); return;
        case 0xCE: if (this.f & OF) { this.interrupt(4); this.taken = true; } return;
        case 0xCF: this.ip = this.pop(); s[CS] = this.pop(); this.setF(this.pop()); return;
        case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
          this.modrm();
          const ww = op & 1;
          const cnt = (op & 2) ? (r[CX] & 0xFF) : 1;
          this.shiftN = cnt;
          const v = this.rdRM(ww);
          if (this.reg === 6) { // undocumented SETMO / SETMOC
            if (cnt === 0) return;
            const m = ww ? 0xFFFF : 0xFF;
            this.wrRM(ww, m); this.f &= ~(CF | OF | AF); this.szp(m, ww); return;
          }
          const res = this.shift(this.reg, v, cnt, ww);
          if (cnt !== 0) this.wrRM(ww, res);
          return;
        }
        case 0xD4: { // AAM
          const base = this.fetch8();
          if (base === 0) { this.f &= ~(CF | OF | AF); this.szp(0, 0); this.divErr(); return; }
          const al = r[AX] & 0xFF;
          const q = Math.floor(al / base), rem = al % base;
          r[AX] = (q << 8) | rem; this.f &= ~(CF | OF | AF); this.szp(rem, 0); return;
        }
        case 0xD5: { // AAD
          const base = this.fetch8();
          const al = ((r[AX] & 0xFF) + (r[AX] >> 8) * base) & 0xFF;
          r[AX] = al; this.f &= ~(CF | OF | AF); this.szp(al, 0); return;
        }
        case 0xD6: // SALC (undocumented)
          r[AX] = (r[AX] & 0xFF00) | ((this.f & CF) ? 0xFF : 0); return;
        case 0xD7: {
          const sg = this.seg >= 0 ? this.seg : DS;
          r[AX] = (r[AX] & 0xFF00) | this.rbs(s[sg], r[BX] + (r[AX] & 0xFF)); return;
        }
        case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: case 0xDF:
          this.modrm(); return; // ESC (no 8087 present)
        case 0xE0: case 0xE1: case 0xE2: case 0xE3: {
          const d = CPU8086.s8(this.fetch8());
          let take;
          if (op === 0xE3) take = r[CX] === 0;
          else {
            r[CX] = (r[CX] - 1) & 0xFFFF;
            take = r[CX] !== 0;
            if (op === 0xE0) take = take && !(this.f & ZF);
            else if (op === 0xE1) take = take && !!(this.f & ZF);
          }
          if (take) { this.ip = (this.ip + d) & 0xFFFF; this.taken = true; }
          return;
        }
        case 0xE4: { const p = this.fetch8(); r[AX] = (r[AX] & 0xFF00) | (this.ioIn(p, 0) & 0xFF); return; }
        case 0xE5: { const p = this.fetch8(); r[AX] = this.ioIn(p, 1) & 0xFFFF; return; }
        case 0xE6: { const p = this.fetch8(); this.ioOut(p, 0, r[AX] & 0xFF); return; }
        case 0xE7: { const p = this.fetch8(); this.ioOut(p, 1, r[AX]); return; }
        case 0xE8: { const d = this.fetch16(); this.push(this.ip); this.ip = (this.ip + d) & 0xFFFF; return; }
        case 0xE9: { const d = this.fetch16(); this.ip = (this.ip + d) & 0xFFFF; return; }
        case 0xEA: { const o = this.fetch16(), sg = this.fetch16(); this.ip = o; s[CS] = sg; return; }
        case 0xEB: { const d = CPU8086.s8(this.fetch8()); this.ip = (this.ip + d) & 0xFFFF; return; }
        case 0xEC: r[AX] = (r[AX] & 0xFF00) | (this.ioIn(r[DX], 0) & 0xFF); return;
        case 0xED: r[AX] = this.ioIn(r[DX], 1) & 0xFFFF; return;
        case 0xEE: this.ioOut(r[DX], 0, r[AX] & 0xFF); return;
        case 0xEF: this.ioOut(r[DX], 1, r[AX]); return;
        case 0xF4: this.halted = true; return;
        case 0xF5: this.f ^= CF; return;
        case 0xF6: case 0xF7: this.group3(w); return;
        case 0xF8: this.f &= ~CF; return;
        case 0xF9: this.f |= CF; return;
        case 0xFA: this.f &= ~IF; return;
        case 0xFB: this.f |= IF; return;
        case 0xFC: this.f &= ~DF; return;
        case 0xFD: this.f |= DF; return;
        case 0xFE: case 0xFF: {
          this.modrm();
          const ww = op & 1;
          const g = this.reg;
          if (g === 0) { this.wrRM(ww, this.inc(this.rdRM(ww), ww)); return; }
          if (g === 1) { this.wrRM(ww, this.dec(this.rdRM(ww), ww)); return; }
          if (!ww) return;
          switch (g) {
            case 2: { const t = this.rdRM(1); this.push(this.ip); this.ip = t; return; }
            case 3: {
              if (this.mod === 3) return;
              const sg = s[this.eaSeg];
              const o = this.rws(sg, this.ea), sg2 = this.rws(sg, this.ea + 2);
              this.push(s[CS]); this.push(this.ip); this.ip = o; s[CS] = sg2; return;
            }
            case 4: this.ip = this.rdRM(1); return;
            case 5: {
              if (this.mod === 3) return;
              const sg = s[this.eaSeg];
              const o = this.rws(sg, this.ea), sg2 = this.rws(sg, this.ea + 2);
              this.ip = o; s[CS] = sg2; return;
            }
            case 6: case 7: { // PUSH rm  (PUSH SP pushes new SP on 8086)
              let v = this.rdRM(1);
              if (this.mod === 3 && this.rm === SP) v = (v - 2) & 0xFFFF;   // 8086: pushes decremented SP
              this.push(v); return;
            }
          }
          return;
        }
      }
    }

    /* ---------------- documented 8086 clock timings ---------------- */
    timing(op) {
      if (op >= 0x60 && op <= 0x6F) op += 0x10;
      const reg = this.mod === 3, E = this.eac, g = this.reg;
      if (op < 0x40) {
        const lo = op & 7;
        if (lo < 4) {
          const cmp = (op & 0x38) === 0x38;
          if (reg) return 3;
          if (lo < 2) return cmp ? 9 + E : 16 + E;
          return 9 + E;
        }
        if (lo < 6) return 4;
        switch (op) { case 0x06: case 0x0E: case 0x16: case 0x1E: return 10; case 0x07: case 0x0F: case 0x17: case 0x1F: return 8;
          case 0x27: case 0x2F: return 4; default: return 8; }
      }
      if (op < 0x48 || op < 0x50) return 2;
      if (op < 0x58) return 11;
      if (op < 0x60) return 8;
      if (op >= 0x70 && op <= 0x7F) return this.taken ? 16 : 4;
      switch (op) {
        case 0x80: case 0x81: case 0x82: case 0x83: return reg ? 4 : ((g === 7) ? 10 + E : 17 + E);
        case 0x84: case 0x85: return reg ? 3 : 9 + E;
        case 0x86: case 0x87: return reg ? 4 : 17 + E;
        case 0x88: case 0x89: return reg ? 2 : 9 + E;
        case 0x8A: case 0x8B: return reg ? 2 : 8 + E;
        case 0x8C: return reg ? 2 : 9 + E;
        case 0x8D: return 2 + E;
        case 0x8E: return reg ? 2 : 8 + E;
        case 0x8F: return reg ? 8 : 17 + E;
        case 0x90: return 3;
        case 0x98: return 2; case 0x99: return 5; case 0x9A: return 28; case 0x9B: return 3;
        case 0x9C: return 10; case 0x9D: return 8; case 0x9E: case 0x9F: return 4;
        case 0xA0: case 0xA1: case 0xA2: case 0xA3: return 10;
        case 0xA4: case 0xA5: return this.rep ? 9 + 17 * this.repN : 18;
        case 0xA6: case 0xA7: return this.rep ? 9 + 22 * this.repN : 22;
        case 0xA8: case 0xA9: return 4;
        case 0xAA: case 0xAB: return this.rep ? 9 + 10 * this.repN : 11;
        case 0xAC: case 0xAD: return this.rep ? 9 + 13 * this.repN : 12;
        case 0xAE: case 0xAF: return this.rep ? 9 + 15 * this.repN : 15;
        case 0xC2: case 0xC0: return 20; case 0xC3: case 0xC1: return 16;
        case 0xC4: case 0xC5: return 16 + E;
        case 0xC6: case 0xC7: return reg ? 4 : 10 + E;
        case 0xCA: case 0xC8: return 25; case 0xCB: case 0xC9: return 26;
        case 0xCC: return 52; case 0xCD: return 51; case 0xCE: return this.taken ? 53 : 4; case 0xCF: return 32;
        case 0xD0: case 0xD1: return reg ? 2 : 15 + E;
        case 0xD2: case 0xD3: return (reg ? 8 : 20 + E) + 4 * this.shiftN;
        case 0xD4: return 83; case 0xD5: return 60; case 0xD6: return 4; case 0xD7: return 11;
        case 0xE0: return this.taken ? 19 : 5; case 0xE1: return this.taken ? 18 : 6;
        case 0xE2: return this.taken ? 17 : 5; case 0xE3: return this.taken ? 18 : 6;
        case 0xE4: case 0xE5: case 0xE6: case 0xE7: return 10;
        case 0xE8: return 19; case 0xE9: case 0xEA: case 0xEB: return 15;
        case 0xEC: case 0xED: case 0xEE: case 0xEF: return 8;
        case 0xF4: return 2; case 0xF5: return 2;
        case 0xF6: case 0xF7: {
          const w = op & 1;
          switch (g) {
            case 0: case 1: return reg ? 5 : 11 + E;
            case 2: case 3: return reg ? 3 : 16 + E;
            case 4: return (w ? (reg ? 126 : 132 + E) : (reg ? 74 : 80 + E));
            case 5: return (w ? (reg ? 141 : 147 + E) : (reg ? 89 : 95 + E));
            case 6: return (w ? (reg ? 153 : 159 + E) : (reg ? 85 : 91 + E));
            default: return (w ? (reg ? 175 : 181 + E) : (reg ? 106 : 112 + E));
          }
        }
        case 0xF8: case 0xF9: case 0xFA: case 0xFB: case 0xFC: case 0xFD: return 2;
        case 0xFE: case 0xFF: {
          const w = op & 1;
          switch (g) {
            case 0: case 1: return reg ? (w ? 2 : 3) : 15 + E;
            case 2: return reg ? 16 : 21 + E;
            case 3: return 37 + E;
            case 4: return reg ? 11 : 18 + E;
            case 5: return 24 + E;
            default: return reg ? 11 : 16 + E;
          }
        }
      }
      if (op >= 0x91 && op <= 0x97) return 3;
      if (op >= 0xB0 && op <= 0xBF) return 4;
      if (op >= 0xD8 && op <= 0xDF) return 2;
      return 2;
    }

    ioIn(p, w) {
      p &= 0xFFFF;
      if (!this.io) return w ? 0xFFFF : 0xFF;
      return this.io.in(p, w);
    }
    ioOut(p, w, v) {
      p &= 0xFFFF;
      if (this.io) this.io.out(p, w, v);
    }
  }

  CPU8086.FLAGS = { CF, PF, AF, ZF, SF, TF, IF, DF, OF };
  CPU8086.PAGE = { RAM, ROM, NONE, MMIO };
  if (typeof module !== 'undefined' && module.exports) module.exports = CPU8086;
  else root.CPU8086 = CPU8086;
})(typeof window !== 'undefined' ? window : globalThis);
