/* =====================================================================
 *  8086 assembler  (Intel / MASM-style syntax)
 *  - Full 8086 instruction set (no 186+ instructions: it is a real 8086)
 *  - Labels, EQU, =, ORG, DB/DW/DD with DUP, strings, EVEN
 *  - SEGMENT / ENDS / ASSUME / PROC / ENDP / END  (MASM style programs)
 *  - Forward references, automatic short/near jumps, imm8/imm16 selection
 *  Works in browser (window.Asm8086) and Node (module.exports).
 * ===================================================================== */
(function (root) {
  'use strict';

  const R16 = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
  const R8 = { AL: 0, CL: 1, DL: 2, BL: 3, AH: 4, CH: 5, DH: 6, BH: 7 };
  const SR = { ES: 0, CS: 1, SS: 2, DS: 3 };
  const SEGPFX = [0x26, 0x2E, 0x36, 0x3E];
  const ALU = { ADD: 0, OR: 1, ADC: 2, SBB: 3, AND: 4, SUB: 5, XOR: 6, CMP: 7 };
  const SHIFT = { ROL: 0, ROR: 1, RCL: 2, RCR: 3, SHL: 4, SAL: 4, SHR: 5, SAR: 7 };
  const JCC = { JO: 0, JNO: 1, JB: 2, JNAE: 2, JC: 2, JAE: 3, JNB: 3, JNC: 3, JE: 4, JZ: 4, JNE: 5, JNZ: 5,
    JBE: 6, JNA: 6, JA: 7, JNBE: 7, JS: 8, JNS: 9, JP: 10, JPE: 10, JNP: 11, JPO: 11, JL: 12, JNGE: 12,
    JGE: 13, JNL: 13, JLE: 14, JNG: 14, JG: 15, JNLE: 15 };
  const LOOPS = { LOOPNE: 0xE0, LOOPNZ: 0xE0, LOOPE: 0xE1, LOOPZ: 0xE1, LOOP: 0xE2, JCXZ: 0xE3 };
  const SIMPLE = { NOP: [0x90], HLT: [0xF4], CLC: [0xF8], STC: [0xF9], CMC: [0xF5], CLD: [0xFC], STD: [0xFD],
    CLI: [0xFA], STI: [0xFB], CBW: [0x98], CWD: [0x99], SAHF: [0x9E], LAHF: [0x9F], PUSHF: [0x9C], POPF: [0x9D],
    DAA: [0x27], DAS: [0x2F], AAA: [0x37], AAS: [0x3F], INTO: [0xCE], IRET: [0xCF], WAIT: [0x9B],
    MOVSB: [0xA4], MOVSW: [0xA5], CMPSB: [0xA6], CMPSW: [0xA7], STOSB: [0xAA], STOSW: [0xAB],
    LODSB: [0xAC], LODSW: [0xAD], SCASB: [0xAE], SCASW: [0xAF], INT3: [0xCC] };
  const PREFIX = { REP: 0xF3, REPE: 0xF3, REPZ: 0xF3, REPNE: 0xF2, REPNZ: 0xF2, LOCK: 0xF0 };
  const GROUP3 = { NOT: 2, NEG: 3, MUL: 4, IMUL: 5, DIV: 6, IDIV: 7 };
  const DIRECTIVES = new Set(['DB', 'DW', 'DD', 'EQU', '=', 'SEGMENT', 'ENDS', 'PROC', 'ENDP', 'DQ', 'DT', 'LABEL']);
  const IGNORED = new Set(['ASSUME', 'NAME', 'TITLE', 'PAGE', '.MODEL', '.8086', '.186', '.286', '.STACK', 'INCLUDE', 'PUBLIC', 'EXTRN', 'EXTERN', 'END_']);
  const MNEMONICS = new Set([...Object.keys(ALU), ...Object.keys(SHIFT), ...Object.keys(JCC), ...Object.keys(LOOPS),
    ...Object.keys(SIMPLE), ...Object.keys(PREFIX), ...Object.keys(GROUP3),
    'MOV', 'PUSH', 'POP', 'XCHG', 'LEA', 'LDS', 'LES', 'IN', 'OUT', 'XLAT', 'XLATB', 'INC', 'DEC', 'TEST', 'JMP', 'CALL',
    'RET', 'RETF', 'RETN', 'INT', 'AAM', 'AAD', 'MOVS', 'CMPS', 'STOS', 'LODS', 'SCAS', 'ESC']);

  class AsmError extends Error {}
  const fail = (m) => { throw new AsmError(m); };

  /* ----------------------------- tokenizer ----------------------------- */
  function tokenize(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1, str = '';
        while (j < s.length && s[j] !== c) str += s[j++];
        if (j >= s.length) fail('Unterminated string');
        t.push({ k: 'str', v: str }); i = j + 1; continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i; while (j < s.length && /[0-9A-Za-z_]/.test(s[j])) j++;
        t.push({ k: 'num', v: parseNum(s.slice(i, j)) }); i = j; continue;
      }
      if (/[A-Za-z_@?$.]/.test(c)) {
        let j = i + 1; while (j < s.length && /[A-Za-z0-9_@?$.]/.test(s[j])) j++;
        t.push({ k: 'id', v: s.slice(i, j).toUpperCase(), raw: s.slice(i, j) }); i = j; continue;
      }
      if ('+-*/()[],:='.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
      fail(`Unexpected character '${c}'`);
    }
    return t;
  }
  function parseNum(w) {
    const u = w.toUpperCase();
    let m;
    if ((m = /^0X([0-9A-F]+)$/.exec(u))) return parseInt(m[1], 16);
    if ((m = /^([0-9][0-9A-F]*)H$/.exec(u))) return parseInt(m[1], 16);
    if ((m = /^([01]+)B$/.exec(u))) return parseInt(m[1], 2);
    if ((m = /^([0-7]+)[OQ]$/.exec(u))) return parseInt(m[1], 8);
    if ((m = /^([0-9]+)D?$/.exec(u))) return parseInt(m[1], 10);
    fail(`Bad number '${w}'`);
  }

  /* split by top-level commas */
  function splitOperands(s) {
    const out = []; let depth = 0, cur = '', q = null;
    for (const c of s) {
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; cur += c; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim() !== '' || out.length) out.push(cur.trim());
    return out;
  }
  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === ';') return s.slice(0, i);
    }
    return s;
  }

  const s16 = (v) => ((v & 0xFFFF) >= 0x8000 ? (v & 0xFFFF) - 0x10000 : (v & 0xFFFF));
  const fitsS8 = (v) => { const x = s16(v); return x >= -128 && x <= 127; };
  const lo = (v) => v & 0xFF, hi = (v) => (v >> 8) & 0xFF;

  /* ============================ ASSEMBLER ============================== */
  class Assembler {
    constructor(opts) {
      this.opts = Object.assign({ loadSeg: 0x0000, defaultOrg: 0x8000 }, opts || {});
    }

    /* ---------- parse source into line records ---------- */
    parse(src) {
      const lines = src.replace(/\r\n?/g, '\n').split('\n');
      const out = [];
      lines.forEach((raw, idx) => {
        const rec = { no: idx + 1, text: raw, label: null, mn: null, args: [], prefixes: [], err: null, empty: true };
        try {
          let s = stripComment(raw).trim();
          if (!s) { out.push(rec); return; }
          rec.empty = false;
          let toks = s.split(/\s+/);
          // label with colon
          let m = /^([A-Za-z_@?$][A-Za-z0-9_@?$]*)\s*:(?!:)\s*(.*)$/.exec(s);
          // (avoid treating "ES:[BX]" style first token as a label)
          if (m && !(m[1].toUpperCase() in SR && /^\s*\[/.test(m[2]))) {
            rec.label = m[1]; s = m[2].trim();
            if (!s) { out.push(rec); return; }
          } else {
            // NAME DIRECTIVE form  (e.g. "msg db 'hi'", "x equ 5", "data segment")
            m = /^([A-Za-z_@?$][A-Za-z0-9_@?$]*)\s+([A-Za-z.=]+)(\s.*)?$/.exec(s);
            if (m && !MNEMONICS.has(m[1].toUpperCase()) && !IGNORED.has(m[1].toUpperCase()) && DIRECTIVES.has(m[2].toUpperCase())) {
              rec.label = m[1]; rec.nameDef = true; s = (m[2] + (m[3] || '')).trim();
            } else {
              m = /^([A-Za-z_@?$][A-Za-z0-9_@?$]*)\s*=\s*(.*)$/.exec(s);
              if (m) { rec.label = m[1]; rec.nameDef = true; s = '= ' + m[2]; }
            }
          }
          // prefixes
          for (;;) {
            const mm = /^([A-Za-z]+)\s*(.*)$/.exec(s);
            if (mm && PREFIX[mm[1].toUpperCase()] !== undefined && mm[2]) { rec.prefixes.push(mm[1].toUpperCase()); s = mm[2].trim(); }
            else break;
          }
          const mm = /^(\S+)\s*(.*)$/.exec(s);
          rec.mn = mm[1].toUpperCase();
          rec.rest = mm[2].trim();
          if (rec.mn === '=') rec.args = [rec.rest];
          else rec.args = rec.rest === '' ? [] : splitOperands(rec.rest);
        } catch (e) { rec.err = e.message; }
        out.push(rec);
      });
      return out;
    }

    /* ---------- main entry ---------- */
    assemble(src) {
      this.lines = this.parse(src);
      this.state = this.lines.map(() => ({ lvl: 0, long: false }));
      let prev = null, result = null;
      for (let pass = 0; pass < 40; pass++) {
        result = this.runPass(prev, pass);
        const sig = JSON.stringify([result.symsig, result.segBases]);
        if (prev && prev.sig === sig) {
          result.passes = pass + 1;
          const seen = new Set();
          for (const u of result.undefRefs) { const k = u.line + ':' + u.name; if (!seen.has(k)) { seen.add(k); result.errors.push({ line: u.line, msg: `Undefined symbol '${u.name}'` }); } }
          result.ok = result.errors.length === 0;
          result.errors.sort((a, b) => a.line - b.line);
          break;
        }
        prev = { syms: result.syms, segBases: result.segBases, sig };
        result.passes = pass + 1;
        if (pass === 39) result.errors.push({ line: 0, msg: 'Assembler did not converge (symbol sizes keep changing)' });
      }
      return result;
    }

    /* ---------- one pass ---------- */
    runPass(prev, pass) {
      const o = this.opts;
      const P = {
        prev, pass, syms: {}, segs: [], segByName: {}, cur: null, errors: [], listing: [],
        explicit: this.lines.some(l => l.mn === 'SEGMENT'), entry: null, proc: [], ended: false,
        chunks: [], undefRefs: [], curLine: 0,
      };
      this.P = P;
      // Create implicit segment for flat code
      const mkSeg = (name) => {
        let s = P.segByName[name];
        if (!s) {
          s = { name, idx: P.segs.length, pc: 0, max: 0, base: 0, chunk: null };
          P.segs.push(s); P.segByName[name] = s;
        }
        return s;
      };
      P.mkSeg = mkSeg;
      if (!P.explicit) { P.cur = mkSeg('_CODE'); P.cur.pc = o.defaultOrg; P.cur.max = o.defaultOrg; }
      // segment bases from previous pass (or provisional)
      const baseOf = (name) => {
        if (prev && prev.segBases && prev.segBases[name] !== undefined) return prev.segBases[name];
        return null;
      };
      P.baseOf = baseOf;

      for (let i = 0; i < this.lines.length; i++) {
        const L = this.lines[i];
        const entry = { no: L.no, text: L.text, bytes: [], seg: null, off: 0 };
        P.listing.push(entry);
        if (L.err) { P.errors.push({ line: L.no, msg: L.err }); continue; }
        if (L.empty) continue;
        if (P.ended) continue;
        P.curLine = L.no;
        try { this.doLine(L, i, entry); this.state[i].lastLen = entry.bytes.length; }
        catch (e) {
          if (e instanceof AsmError) {
            P.errors.push({ line: L.no, msg: e.message });
            // keep layout stable: reserve the same number of bytes as last time
            if (!entry.bytes.length && this.state[i].lastLen && P.cur) this.emit(new Array(this.state[i].lastLen).fill(0), entry);
          } else throw e;
        }
      }
      // compute layout for next pass
      const bases = {};
      if (P.explicit) {
        let phys = ((o.loadSeg << 4) + o.defaultOrg + 15) >> 4 << 4;
        P.segs.forEach(sg => {
          bases[sg.name] = (phys >> 4) & 0xFFFF;
          sg.base = bases[sg.name];
          phys = (phys + sg.max + 15) >> 4 << 4;
        });
      } else {
        P.segs.forEach(sg => { bases[sg.name] = o.loadSeg & 0xFFFF; sg.base = bases[sg.name]; });
      }
      P.segBases = bases;
      P.symsig = JSON.stringify(Object.keys(P.syms).sort().map(k => [k, P.syms[k].v, P.syms[k].seg || '']));
      // flatten chunks to image
      P.image = [];
      P.chunks.forEach(c => {
        if (!c.bytes.length) return;
        const sg = c.seg;
        P.image.push({ seg: sg.name, segBase: sg.base, off: c.org, phys: ((sg.base << 4) + c.org) & 0xFFFFF, bytes: c.bytes });
      });
      P.listing.forEach(e => { if (e.segObj) { e.seg = e.segObj.base; delete e.segObj; } });
      if (P.entry) {
        const sg = P.segByName[P.entry.seg]; P.entry = { cs: sg ? sg.base : 0, ip: P.entry.off };
      } else if (P.image.length) {
        const first = P.image[0]; P.entry = { cs: first.segBase, ip: first.off };
      }
      // report undefined symbols only from the last pass => decided by caller via errors list
      return {
        ok: P.errors.length === 0, errors: P.errors, listing: P.listing, image: P.image, entry: P.entry,
        syms: P.syms, symsig: P.symsig, undefRefs: P.undefRefs, segBases: P.segBases, segs: P.segs.map(s => ({ name: s.name, base: s.base, size: s.max })),
      };
    }

    /* ---------- emit helpers ---------- */
    emit(bytes, entry) {
      const P = this.P, sg = P.cur;
      if (!sg) fail('Code outside any segment');
      if (!sg.chunk || sg.chunk.org + sg.chunk.bytes.length !== sg.pc) {
        sg.chunk = { seg: sg, org: sg.pc, bytes: [] };
        P.chunks.push(sg.chunk);
      }
      for (const b of bytes) sg.chunk.bytes.push(b & 0xFF);
      entry.bytes = entry.bytes.concat(bytes.map(b => b & 0xFF));
      sg.pc += bytes.length;
      if (sg.pc > sg.max) sg.max = sg.pc;
    }
    define(name, v, kind, extra) {
      const P = this.P, key = name.toUpperCase();
      if (P.syms[key] && P.syms[key].kind !== 'redef' && !(kind === 'redef')) fail(`Symbol '${name}' already defined`);
      P.syms[key] = Object.assign({ v, kind }, extra || {});
    }
    lookup(name) {
      const P = this.P, k = name.toUpperCase();
      if (P.syms[k]) return P.syms[k];
      if (P.segByName[k] || (P.prev && P.prev.segBases && P.prev.segBases[k] !== undefined)) {
        const b = P.baseOf(k);
        return { v: b === null ? 0 : b, kind: 'segment', undef: b === null };
      }
      if (P.prev && P.prev.syms[k]) return Object.assign({}, P.prev.syms[k], { fromPrev: true });
      return null;
    }

    /* ---------- line handling ---------- */
    doLine(L, idx, entry) {
      const P = this.P, st = this.state[idx];
      const mn = L.mn;
      entry.segObj = P.cur; entry.off = P.cur ? P.cur.pc : 0;
      const A = L.args;

      // label on a line of its own
      if (!mn) {
        if (L.label) { if (!P.cur) fail('Label outside any segment'); this.define(L.label, P.cur.pc, 'label', { seg: P.cur.name }); }
        return;
      }

      // ---- directives that may define L.label themselves ----
      if (mn === 'SEGMENT') {
        if (!L.label) fail('SEGMENT needs a name');
        const sg = P.mkSeg(L.label.toUpperCase());
        P.cur = sg; entry.segObj = sg; entry.off = sg.pc; return;
      }
      if (mn === 'ENDS') { return; }
      if (mn === 'PROC') {
        if (L.label) this.define(L.label, P.cur.pc, 'label', { seg: P.cur.name });
        P.proc.push(/FAR/i.test(L.rest || '') ? 'FAR' : 'NEAR'); return;
      }
      if (mn === 'ENDP') { P.proc.pop(); return; }
      if (mn === 'EQU' || mn === '=') {
        if (!L.label) fail(`${mn} needs a name`);
        const v = this.evalStr(A.join(','), { noMem: false });
        if (v.mem) { /* EQU of a memory expr: store as constant of value */ }
        this.define(L.label, v.v, mn === '=' ? 'redef' : 'const', { undef: v.undef });
        return;
      }
      if (mn === 'END') {
        if (A.length) {
          const v = this.evalStr(A[0], {});
          const nm = A[0].trim().toUpperCase();
          const sy = this.lookup(nm);
          P.entry = { seg: sy && sy.seg ? sy.seg : (P.cur ? P.cur.name : '_CODE'), off: v.v & 0xFFFF };
        }
        P.ended = true; return;
      }
      if (IGNORED.has(mn) || mn === '.CODE' || mn === '.DATA') return;
      if (mn === 'ORG') {
        const v = this.evalStr(A[0], {});
        if (v.undef && P.pass > 0) fail('ORG needs a constant value');
        if (!P.cur) fail('ORG outside segment');
        P.cur.pc = v.v & 0xFFFF; if (P.cur.pc > P.cur.max) P.cur.max = P.cur.pc;
        entry.off = P.cur.pc; if (L.label) this.define(L.label, P.cur.pc, 'label', { seg: P.cur.name });
        return;
      }
      if (mn === 'EVEN' || mn === 'ALIGN') {
        let n = 2; if (A.length) n = this.evalStr(A[0], {}).v || 2;
        const pad = (n - (P.cur.pc % n)) % n;
        if (L.label) this.define(L.label, P.cur.pc, 'label', { seg: P.cur.name });
        this.emit(new Array(pad).fill(0x90), entry); return;
      }
      if (mn === 'LABEL') {
        if (!L.label) fail('LABEL needs a name');
        const t = (A[0] || '').toUpperCase();
        const size = t === 'BYTE' ? 1 : t === 'WORD' ? 2 : t === 'DWORD' ? 4 : 0;
        this.define(L.label, P.cur.pc, size ? 'var' : 'label', { seg: P.cur.name, size });
        return;
      }
      // data definition
      if (mn === 'DB' || mn === 'DW' || mn === 'DD') {
        const size = mn === 'DB' ? 1 : mn === 'DW' ? 2 : 4;
        if (L.label) this.define(L.label, P.cur.pc, 'var', { seg: P.cur.name, size });
        const bytes = [];
        for (const a of A) this.dataItem(a, size, bytes);
        this.emit(bytes, entry); return;
      }
      if (mn === 'DQ' || mn === 'DT') fail(`${mn} is not supported (use DB/DW/DD)`);

      // ---- instruction ----
      if (L.label) this.define(L.label, P.cur.pc, 'label', { seg: P.cur.name });
      if (!P.cur) fail('Instruction outside any segment');
      const out = [];
      for (const p of L.prefixes) out.push(PREFIX[p]);
      if (!MNEMONICS.has(mn)) fail(`Unknown instruction or directive '${L.mn.toLowerCase()}'`);
      const ops = A.map(a => this.parseOperand(a));
      const b = this.encode(mn, ops, st, A);
      this.emit(out.concat(b), entry);
    }

    dataItem(a, size, bytes) {
      a = a.trim();
      if (a === '?') { for (let i = 0; i < size; i++) bytes.push(0); return; }
      // DUP
      let m = /^(.+?)\s+DUP\s*\((.*)\)\s*$/i.exec(a);
      if (m) {
        const n = this.evalStr(m[1], {}).v;
        if (n < 0 || n > 65536) fail('Bad DUP count');
        const inner = [];
        for (const it of splitOperands(m[2])) this.dataItem(it, size, inner);
        for (let i = 0; i < n; i++) for (const x of inner) bytes.push(x);
        return;
      }
      // quoted string
      const sm = /^(['"])((?:(?!\1).)*)\1$/.exec(a);
      if (sm && (size === 1 || sm[2].length > 2)) {
        if (size !== 1) fail('Strings longer than 2 characters are only allowed in DB');
        for (const c of sm[2]) bytes.push(c.charCodeAt(0) & 0xFF);
        return;
      }
      const v = this.evalStr(a, {});
      const val = v.v;
      if (size === 1) {
        if (!v.undef && (val < -128 || val > 255)) fail(`Value ${val} does not fit in a byte`);
        bytes.push(val & 0xFF);
      } else if (size === 2) {
        if (!v.undef && (val < -32768 || val > 65535)) fail(`Value ${val} does not fit in a word`);
        bytes.push(lo(val), hi(val));
      } else {
        // DD: allow seg:off pair
        const colon = this.topLevelColon(a);
        if (colon >= 0) {
          const sgv = this.evalStr(a.slice(0, colon), {}).v, ofv = this.evalStr(a.slice(colon + 1), {}).v;
          bytes.push(lo(ofv), hi(ofv), lo(sgv), hi(sgv));
        } else {
          const u = val >>> 0;
          bytes.push(u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF, (u >>> 24) & 0xFF);
        }
      }
    }
    topLevelColon(s) {
      let d = 0, q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
        else if (c === ':' && d === 0) return i;
      }
      return -1;
    }

    /* ---------- expression evaluation ---------- */
    evalStr(s, flags) { return this.evalToks(tokenize(s), flags || {}); }
    evalToks(toks, flags) {
      const self = this, P = this.P;
      let pos = 0, undef = false, mem = false, size = 0, symSeg = null, usedSym = false;
      const peek = () => toks[pos];
      const isId = (v) => peek() && peek().k === 'id' && peek().v === v;
      const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
      const IDS = (id) => id.v;

      function primary() {
        const t = toks[pos++];
        if (!t) fail('Expression expected');
        if (t.k === 'num') return t.v;
        if (t.k === 'str') {
          if (t.v.length > 2) fail('String constant too long in expression');
          let v = 0; for (const c of t.v) v = (v << 8) | (c.charCodeAt(0) & 0xFF); return v;
        }
        if (t.k === 'op') {
          if (t.v === '(') { const v = orExpr(); if (!isOp(')')) fail("Missing ')'"); pos++; return v; }
          if (t.v === '[') { const v = orExpr(); if (!isOp(']')) fail("Missing ']'"); pos++; return v; }
          if (t.v === '-') return -unary();
          if (t.v === '+') return unary();
          fail(`Unexpected '${t.v}'`);
        }
        // identifier
        const id = t.v;
        if (id === '$') return P.cur ? P.cur.pc : 0;
        if (id in R16 || id in R8 || id in SR) fail(`Register ${id} not allowed in this expression`);
        if (id === 'OFFSET') { const sv = flags.noMemDepth; flags.noMemDepth = true; const v = unary(); flags.noMemDepth = sv; return v; }
        if (id === 'SEG') {
          const nt = toks[pos++]; if (!nt || nt.k !== 'id') fail('SEG needs a symbol');
          const sy = self.lookup(nt.v);
          if (!sy) { undef = true; return 0; }
          if (sy.kind === 'segment') return sy.v;
          const b = P.baseOf(sy.seg || ''); if (b === null) { undef = true; return 0; } return b;
        }
        if (id === 'HIGH') return (unary() >> 8) & 0xFF;
        if (id === 'LOW') return unary() & 0xFF;
        if (id === 'NOT') return (~unary()) & 0xFFFF;
        if (id === 'BYTE' || id === 'WORD' || id === 'DWORD' || id === 'PTR' || id === 'SHORT' || id === 'NEAR' || id === 'FAR') fail(`Misplaced '${t.raw}'`);
        const sy = self.lookup(id);
        if (!sy) { P.undefRefs.push({ line: P.curLine, name: t.raw }); undef = true; usedSym = true; return 0; }
        usedSym = true;
        if (sy.undef) undef = true;
        if (sy.kind === 'var') {
          if (!flags.noMemDepth) { mem = true; size = size || sy.size; }
          symSeg = symSeg || sy.seg;
        } else if (sy.kind === 'label') symSeg = symSeg || sy.seg;
        return sy.v;
      }
      function unary() { return primary(); }
      function mulExpr() {
        let v = unary();
        for (;;) {
          if (isOp('*')) { pos++; v = v * unary(); }
          else if (isOp('/')) { pos++; const d = unary(); if (d === 0) { if (!undef) fail('Division by zero'); v = 0; } else v = Math.trunc(v / d); }
          else if (isId('MOD')) { pos++; const d = unary(); if (d === 0) { if (!undef) fail('Division by zero'); v = 0; } else v = v % d; }
          else if (isId('SHL')) { pos++; v = v << unary(); }
          else if (isId('SHR')) { pos++; v = v >>> unary(); }
          else return v;
        }
      }
      function addExpr() {
        let v = mulExpr();
        for (;;) {
          if (isOp('+')) { pos++; v = v + mulExpr(); }
          else if (isOp('-')) { pos++; v = v - mulExpr(); }
          else return v;
        }
      }
      function cmpExpr() {
        let v = addExpr();
        for (;;) {
          if (isId('EQ')) { pos++; v = v === addExpr() ? -1 : 0; }
          else if (isId('NE')) { pos++; v = v !== addExpr() ? -1 : 0; }
          else if (isId('LT')) { pos++; v = v < addExpr() ? -1 : 0; }
          else if (isId('LE')) { pos++; v = v <= addExpr() ? -1 : 0; }
          else if (isId('GT')) { pos++; v = v > addExpr() ? -1 : 0; }
          else if (isId('GE')) { pos++; v = v >= addExpr() ? -1 : 0; }
          else return v;
        }
      }
      function andExpr() { let v = cmpExpr(); while (isId('AND')) { pos++; v = v & cmpExpr(); } return v; }
      function orExpr() {
        let v = andExpr();
        for (;;) {
          if (isId('OR')) { pos++; v = v | andExpr(); }
          else if (isId('XOR')) { pos++; v = v ^ andExpr(); }
          else return v;
        }
      }
      const v = orExpr();
      if (pos < toks.length) fail(`Unexpected '${toks[pos].raw || toks[pos].v}' in expression`);
      if (undef && this.P.pass === 0) { /* provisional */ }
      return { v: Math.trunc(v), undef, mem, size, seg: symSeg, usedSym };
    }

    /* ---------- operand parsing ---------- */
    parseOperand(str) {
      let toks = tokenize(str);
      if (!toks.length) fail('Missing operand');
      const op = { str, t: null, size: 0, dist: null };
      // single register?
      if (toks.length === 1 && toks[0].k === 'id') {
        const id = toks[0].v;
        if (id in R16) return { t: 'reg', n: R16[id], w: 16, name: id };
        if (id in R8) return { t: 'reg', n: R8[id], w: 8, name: id };
        if (id in SR) return { t: 'seg', n: SR[id], name: id };
      }
      // modifiers
      for (;;) {
        const t = toks[0];
        if (t && t.k === 'id' && (t.v === 'BYTE' || t.v === 'WORD' || t.v === 'DWORD')) {
          op.size = t.v === 'BYTE' ? 8 : t.v === 'WORD' ? 16 : 32; toks = toks.slice(1);
          if (toks[0] && toks[0].v === 'PTR') toks = toks.slice(1);
        } else if (t && t.k === 'id' && (t.v === 'SHORT' || t.v === 'NEAR' || t.v === 'FAR')) {
          op.dist = t.v; toks = toks.slice(1);
          if (toks[0] && toks[0].v === 'PTR') toks = toks.slice(1);
        } else break;
      }
      if (!toks.length) fail('Missing operand after size specifier');
      // seg:off  immediate far pointer (left side not a segment register)
      let colon = -1, d = 0;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k === 'op' && (t.v === '(' || t.v === '[')) d++;
        else if (t.k === 'op' && (t.v === ')' || t.v === ']')) d--;
        else if (t.k === 'op' && t.v === ':' && d === 0) { colon = i; break; }
      }
      let segOv = null;
      if (colon >= 0) {
        if (colon === 1 && toks[0].k === 'id' && toks[0].v in SR) { segOv = SR[toks[0].v]; toks = toks.slice(2); }
        else {
          const a = this.evalToks(toks.slice(0, colon), {}), b = this.evalToks(toks.slice(colon + 1), {});
          return { t: 'far', seg: a.v, off: b.v, undef: a.undef || b.undef, dist: 'FAR' };
        }
      }
      // find index/base registers and brackets
      const hasBracket = toks.some(t => t.k === 'op' && (t.v === '[' || t.v === ']'));
      const hasIdxReg = toks.some(t => t.k === 'id' && (t.v === 'BX' || t.v === 'BP' || t.v === 'SI' || t.v === 'DI'));
      if (hasBracket || hasIdxReg || segOv !== null) {
        return this.parseMem(toks, op, segOv);
      }
      const v = this.evalToks(toks, {});
      if (v.mem) {
        return { t: 'mem', base: null, index: null, disp: v.v, dispUndef: v.undef, hasDisp: true, size: op.size || (v.size ? v.size * 8 : 0), seg: null, direct: true, dist: op.dist };
      }
      return { t: 'imm', v: v.v, undef: v.undef, size: op.size, dist: op.dist, sym: v.usedSym, symSeg: v.seg };
    }
    parseMem(toks, op, segOv) {
      // split into additive terms, flattening brackets
      const terms = []; // {sign, toks[]}
      let cur = [], sign = 1, depth = 0, sawAny = false;
      const flush = () => { if (cur.length) terms.push({ sign, toks: cur }); cur = []; };
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k === 'op' && t.v === '[') { if (cur.length) { flush(); sign = 1; } continue; }
        if (t.k === 'op' && t.v === ']') { flush(); sign = 1; continue; }
        if (t.k === 'op' && t.v === '(') depth++;
        if (t.k === 'op' && t.v === ')') depth--;
        if (depth === 0 && t.k === 'op' && (t.v === '+' || t.v === '-')) {
          if (cur.length) { flush(); sign = 1; }
          if (t.v === '-') sign = -sign;
          continue;
        }
        cur.push(t);
      }
      flush();
      let base = null, index = null; const dispToks = [];
      for (const tm of terms) {
        if (tm.toks.length === 1 && tm.toks[0].k === 'id' && (tm.toks[0].v in R16)) {
          const r = tm.toks[0].v;
          if (tm.sign < 0) fail('Cannot subtract a register in an address');
          if (r === 'BX' || r === 'BP') { if (base) fail('Invalid address: two base registers'); base = r; }
          else if (r === 'SI' || r === 'DI') { if (index) fail('Invalid address: two index registers'); index = r; }
          else fail(`Register ${r} cannot be used in an address`);
        } else {
          if (tm.toks.some(t => t.k === 'id' && (t.v in R16 || t.v in R8))) fail('Invalid register use in address expression');
          dispToks.push({ sign: tm.sign, toks: tm.toks });
        }
      }
      let disp = 0, undef = false, msize = 0, hasDisp = false;
      for (const dt of dispToks) {
        const v = this.evalToks(dt.toks, {});
        disp += dt.sign * v.v; undef = undef || v.undef; hasDisp = true;
        if (v.mem && v.size && !msize) msize = v.size * 8;
      }
      return { t: 'mem', base, index, disp, dispUndef: undef, hasDisp, size: op.size || msize, seg: segOv, direct: !base && !index, dist: op.dist };
    }

    /* ---------- operand encoders ---------- */
    modrmMem(regField, m, st) {
      if (m.direct) {
        const d = m.disp & 0xFFFF;
        return [0x06 | (regField << 3), lo(d), hi(d)];
      }
      const key = (m.base || '') + (m.index || '');
      const rmTab = { BXSI: 0, BXDI: 1, BPSI: 2, BPDI: 3, SI: 4, DI: 5, BP: 6, BX: 7 };
      const rm = rmTab[key];
      if (rm === undefined) fail('Invalid address combination (use [BX|BP]+[SI|DI])');
      let need;
      if (m.dispUndef) need = 1;                                   // provisional until the symbol is known
      else if (!m.hasDisp || (m.disp & 0xFFFF) === 0) need = rm === 6 ? 1 : 0;
      else need = fitsS8(m.disp) ? 1 : 2;
      st.lvl = Math.max(st.lvl, need);
      const lvl = st.lvl;
      const d = m.disp & 0xFFFF;
      if (lvl === 0) return [(0 << 6) | (regField << 3) | rm];
      if (lvl === 1) return [(1 << 6) | (regField << 3) | rm, lo(d)];
      return [(2 << 6) | (regField << 3) | rm, lo(d), hi(d)];
    }
    // generic r/m operand (reg or mem) with a reg-field value
    modrmRM(regField, rmOp, st) {
      if (rmOp.t === 'reg') return [0xC0 | (regField << 3) | rmOp.n];
      return this.modrmMem(regField, rmOp, st);
    }
    pfx(mem) { return (mem && mem.t === 'mem' && mem.seg !== null && mem.seg !== undefined) ? [SEGPFX[mem.seg]] : []; }
    immBytes(v, w) { return w === 16 ? [lo(v), hi(v)] : [lo(v)]; }
    chkImm(op, w) {
      if (op.undef) return;
      const v = op.v;
      if (w === 8 && (v < -128 || v > 255)) fail(`Immediate ${v} does not fit in 8 bits`);
      if (w === 16 && (v < -32768 || v > 65535)) fail(`Immediate ${v} does not fit in 16 bits`);
    }
    opSize(a, b) {
      const sa = a.t === 'reg' ? a.w : a.t === 'mem' ? a.size : 0;
      const sb = b && (b.t === 'reg' ? b.w : b.t === 'mem' ? b.size : 0);
      if (sa && sb && sa !== sb) fail('Operand size mismatch');
      return sa || sb || 0;
    }

    /* ---------- the encoder ---------- */
    encode(mn, ops, st, rawArgs) {
      const P = this.P;
      const n = ops.length;
      const need = (k) => { if (n !== k) fail(`'${mn.toLowerCase()}' needs ${k} operand${k === 1 ? '' : 's'}`); };

      if (SIMPLE[mn]) { need(0); return SIMPLE[mn].slice(); }
      if (PREFIX[mn] !== undefined) { need(0); return [PREFIX[mn]]; }
      if (mn === 'XLAT' || mn === 'XLATB') return [0xD7];
      if (mn === 'AAM' || mn === 'AAD') {
        const base = n ? this.immVal(ops[0]) : 10;
        return [mn === 'AAM' ? 0xD4 : 0xD5, base & 0xFF];
      }
      if (mn === 'ESC') fail('ESC is not supported (no 8087 in this trainer)');

      /* ---- MOV ---- */
      if (mn === 'MOV') {
        need(2);
        const [d, s] = ops;
        if (d.t === 'seg') {
          if (d.n === 1) fail('MOV CS,... is not allowed');
          if (s.t === 'reg' && s.w === 16 || s.t === 'mem') return [...this.pfx(s), 0x8E, ...this.modrmRM(d.n, s, st)];
          fail('MOV to segment register needs a 16-bit register or memory source');
        }
        if (s.t === 'seg') {
          if (d.t === 'reg' && d.w === 16 || d.t === 'mem') return [...this.pfx(d), 0x8C, ...this.modrmRM(s.n, d, st)];
          fail('MOV from segment register needs a 16-bit destination');
        }
        if (d.t === 'reg') {
          if (s.t === 'reg') {
            if (d.w !== s.w) fail('Operand size mismatch');
            return [d.w === 8 ? 0x8A : 0x8B, ...this.modrmRM(d.n, s, st)];
          }
          if (s.t === 'mem') {
            if (s.size && s.size !== d.w) fail('Operand size mismatch');
            if (d.n === 0 && s.direct) return [...this.pfx(s), d.w === 8 ? 0xA0 : 0xA1, lo(s.disp), hi(s.disp)];
            return [...this.pfx(s), d.w === 8 ? 0x8A : 0x8B, ...this.modrmMem(d.n, s, st)];
          }
          if (s.t === 'imm') {
            this.chkImm(s, d.w);
            return d.w === 8 ? [0xB0 | d.n, lo(s.v)] : [0xB8 | d.n, lo(s.v), hi(s.v)];
          }
          fail('Invalid MOV operands');
        }
        if (d.t === 'mem') {
          if (s.t === 'reg') {
            if (d.size && d.size !== s.w) fail('Operand size mismatch');
            if (s.n === 0 && d.direct) return [...this.pfx(d), s.w === 8 ? 0xA2 : 0xA3, lo(d.disp), hi(d.disp)];
            return [...this.pfx(d), s.w === 8 ? 0x88 : 0x89, ...this.modrmMem(s.n, d, st)];
          }
          if (s.t === 'imm') {
            const w = d.size || s.size || 0;
            if (!w) fail('Operand size not specified (use BYTE PTR / WORD PTR)');
            this.chkImm(s, w);
            return [...this.pfx(d), w === 8 ? 0xC6 : 0xC7, ...this.modrmMem(0, d, st), ...this.immBytes(s.v, w)];
          }
          fail('Invalid MOV operands (memory to memory is not possible)');
        }
        fail('Invalid MOV destination');
      }

      /* ---- ALU group ---- */
      if (mn in ALU) {
        need(2);
        const [d, s] = ops, code = ALU[mn];
        if (d.t === 'seg' || s.t === 'seg') fail('Segment registers not allowed here');
        if (d.t === 'imm') fail('Destination cannot be an immediate');
        if (s.t === 'imm') {
          const w = this.opSize(d, null) || s.size;
          if (!w) fail('Operand size not specified (use BYTE PTR / WORD PTR)');
          this.chkImm(s, w);
          if (w === 8) {
            if (d.t === 'reg' && d.n === 0) return [(code << 3) | 4, lo(s.v)];
            return [...this.pfx(d), 0x80, ...this.modrmRM(code, d, st), lo(s.v)];
          }
          if (!s.undef && !fitsS8(s.v)) st.long = true;
          if (!st.long) return [...this.pfx(d), 0x83, ...this.modrmRM(code, d, st), lo(s.v)];
          if (d.t === 'reg' && d.n === 0) return [(code << 3) | 5, lo(s.v), hi(s.v)];
          return [...this.pfx(d), 0x81, ...this.modrmRM(code, d, st), lo(s.v), hi(s.v)];
        }
        if (d.t === 'reg') {
          const w = this.opSize(d, s);
          return [...this.pfx(s), (code << 3) | 2 | (w === 16 ? 1 : 0), ...this.modrmRM(d.n, s, st)];
        }
        if (d.t === 'mem' && s.t === 'reg') {
          const w = this.opSize(d, s);
          return [...this.pfx(d), (code << 3) | (w === 16 ? 1 : 0), ...this.modrmMem(s.n, d, st)];
        }
        fail('Invalid operand combination');
      }

      /* ---- TEST ---- */
      if (mn === 'TEST') {
        need(2);
        let [d, s] = ops;
        if (s.t === 'imm') {
          const w = this.opSize(d, null) || s.size;
          if (!w) fail('Operand size not specified (use BYTE PTR / WORD PTR)');
          this.chkImm(s, w);
          if (d.t === 'reg' && d.n === 0) return w === 8 ? [0xA8, lo(s.v)] : [0xA9, lo(s.v), hi(s.v)];
          return [...this.pfx(d), w === 8 ? 0xF6 : 0xF7, ...this.modrmRM(0, d, st), ...this.immBytes(s.v, w)];
        }
        if (d.t === 'mem' && s.t === 'reg') { const t = d; d = s; s = t; }
        if (d.t === 'reg' && (s.t === 'reg' || s.t === 'mem')) {
          const w = this.opSize(d, s);
          return [...this.pfx(s), w === 16 ? 0x85 : 0x84, ...this.modrmRM(d.n, s, st)];
        }
        fail('Invalid TEST operands');
      }

      /* ---- INC / DEC ---- */
      if (mn === 'INC' || mn === 'DEC') {
        need(1);
        const d = ops[0], g = mn === 'INC' ? 0 : 1;
        if (d.t === 'reg' && d.w === 16) return [(mn === 'INC' ? 0x40 : 0x48) | d.n];
        if (d.t === 'reg' || d.t === 'mem') {
          const w = d.t === 'reg' ? d.w : d.size;
          if (!w) fail('Operand size not specified (use BYTE PTR / WORD PTR)');
          return [...this.pfx(d), w === 8 ? 0xFE : 0xFF, ...this.modrmRM(g, d, st)];
        }
        fail('Invalid operand');
      }
      /* ---- NOT NEG MUL IMUL DIV IDIV ---- */
      if (mn in GROUP3) {
        need(1);
        const d = ops[0];
        if (d.t !== 'reg' && d.t !== 'mem') fail('Invalid operand');
        const w = d.t === 'reg' ? d.w : d.size;
        if (!w) fail('Operand size not specified (use BYTE PTR / WORD PTR)');
        return [...this.pfx(d), w === 8 ? 0xF6 : 0xF7, ...this.modrmRM(GROUP3[mn], d, st)];
      }
      /* ---- shifts / rotates ---- */
      if (mn in SHIFT) {
        need(2);
        const [d, c] = ops;
        if (d.t !== 'reg' && d.t !== 'mem') fail('Invalid operand');
        const w = d.t === 'reg' ? d.w : d.size;
        if (!w) fail('Operand size not specified (use BYTE PTR / WORD PTR)');
        let useCL;
        if (c.t === 'reg' && c.name === 'CL') useCL = true;
        else if (c.t === 'imm') {
          if (c.undef || c.v !== 1) fail(`8086 can only shift/rotate by 1 or by CL (not by ${c.v}). Use MOV CL,${c.v} then ${mn} ...,CL`);
          useCL = false;
        } else fail('Shift count must be 1 or CL');
        return [...this.pfx(d), 0xD0 | (useCL ? 2 : 0) | (w === 16 ? 1 : 0), ...this.modrmRM(SHIFT[mn], d, st)];
      }

      /* ---- PUSH / POP ---- */
      if (mn === 'PUSH') {
        need(1);
        const d = ops[0];
        if (d.t === 'reg') { if (d.w !== 16) fail('PUSH needs a 16-bit operand'); return [0x50 | d.n]; }
        if (d.t === 'seg') return [0x06 | (d.n << 3)];
        if (d.t === 'mem') return [...this.pfx(d), 0xFF, ...this.modrmMem(6, d, st)];
        fail('PUSH immediate is not available on the 8086 (load into a register first)');
      }
      if (mn === 'POP') {
        need(1);
        const d = ops[0];
        if (d.t === 'reg') { if (d.w !== 16) fail('POP needs a 16-bit operand'); return [0x58 | d.n]; }
        if (d.t === 'seg') { if (d.n === 1) fail('POP CS is not allowed'); return [0x07 | (d.n << 3)]; }
        if (d.t === 'mem') return [...this.pfx(d), 0x8F, ...this.modrmMem(0, d, st)];
        fail('Invalid POP operand');
      }
      /* ---- XCHG ---- */
      if (mn === 'XCHG') {
        need(2);
        let [a, b] = ops;
        if (a.t === 'mem' && b.t === 'reg') { const t = a; a = b; b = t; }
        if (a.t === 'reg' && b.t === 'reg') {
          if (a.w !== b.w) fail('Operand size mismatch');
          if (a.w === 16 && a.n === 0) return [0x90 | b.n];
          if (a.w === 16 && b.n === 0) return [0x90 | a.n];
          return [a.w === 8 ? 0x86 : 0x87, ...this.modrmRM(a.n, b, st)];
        }
        if (a.t === 'reg' && b.t === 'mem') {
          const w = this.opSize(a, b);
          return [...this.pfx(b), w === 8 ? 0x86 : 0x87, ...this.modrmMem(a.n, b, st)];
        }
        fail('Invalid XCHG operands');
      }
      /* ---- LEA / LDS / LES ---- */
      if (mn === 'LEA' || mn === 'LDS' || mn === 'LES') {
        need(2);
        const [d, s] = ops;
        if (d.t !== 'reg' || d.w !== 16) fail(`${mn} destination must be a 16-bit register`);
        if (s.t !== 'mem') fail(`${mn} source must be a memory operand`);
        const opc = mn === 'LEA' ? 0x8D : mn === 'LDS' ? 0xC5 : 0xC4;
        return [...this.pfx(s), opc, ...this.modrmMem(d.n, s, st)];
      }
      /* ---- IN / OUT ---- */
      if (mn === 'IN') {
        need(2);
        const [d, s] = ops;
        if (d.t !== 'reg' || d.n !== 0) fail('IN destination must be AL or AX');
        const w = d.w === 16 ? 1 : 0;
        if (s.t === 'reg' && s.name === 'DX') return [0xEC | w];
        if (s.t === 'imm') { this.chkImm(s, 8); if (!s.undef && (s.v < 0 || s.v > 255)) fail('Port must be 0-255 (or use DX)'); return [0xE4 | w, lo(s.v)]; }
        fail('IN port must be an 8-bit constant or DX');
      }
      if (mn === 'OUT') {
        need(2);
        const [p, s] = ops;
        if (s.t !== 'reg' || s.n !== 0) fail('OUT source must be AL or AX');
        const w = s.w === 16 ? 1 : 0;
        if (p.t === 'reg' && p.name === 'DX') return [0xEE | w];
        if (p.t === 'imm') { this.chkImm(p, 8); if (!p.undef && (p.v < 0 || p.v > 255)) fail('Port must be 0-255 (or use DX)'); return [0xE6 | w, lo(p.v)]; }
        fail('OUT port must be an 8-bit constant or DX');
      }
      /* ---- INT ---- */
      if (mn === 'INT') {
        need(1);
        const v = this.immVal(ops[0]);
        if (v === 3) return [0xCC];
        if (v < 0 || v > 255) fail('Interrupt number must be 0-255');
        return [0xCD, v];
      }
      /* ---- RET ---- */
      if (mn === 'RET' || mn === 'RETN' || mn === 'RETF') {
        const far = mn === 'RETF' || (mn === 'RET' && P.proc.length && P.proc[P.proc.length - 1] === 'FAR');
        if (n === 0) return [far ? 0xCB : 0xC3];
        const v = this.immVal(ops[0]);
        return [far ? 0xCA : 0xC2, lo(v), hi(v)];
      }
      /* ---- conditional jumps / loops ---- */
      if (mn in JCC || mn in LOOPS) {
        need(1);
        const opc = mn in JCC ? 0x70 | JCC[mn] : LOOPS[mn];
        const tgt = this.relTarget(ops[0]);
        const end = P.cur.pc + 2;
        const rel = s16(tgt.v - end);                      // wraps inside the 64K segment like the real chip
        if (!tgt.undef && (rel < -128 || rel > 127)) {
          const hint = mn in JCC ? `. Use the opposite condition + JMP, e.g. J${'N'}... over a JMP` : '';
          fail(`Jump target out of range for short jump (${rel} bytes)${hint}`);
        }
        return [opc, rel & 0xFF];
      }
      /* ---- JMP / CALL ---- */
      if (mn === 'JMP' || mn === 'CALL') {
        need(1);
        const t = ops[0];
        const isCall = mn === 'CALL';
        if (t.t === 'far') return [isCall ? 0x9A : 0xEA, lo(t.off), hi(t.off), lo(t.seg), hi(t.seg)];
        if (t.t === 'reg') {
          if (t.w !== 16) fail('Indirect jump/call needs a 16-bit register');
          return [0xFF, ...this.modrmRM(isCall ? 2 : 4, t, st)];
        }
        if (t.t === 'mem') {
          const far = t.dist === 'FAR' || t.size === 32;
          return [...this.pfx(t), 0xFF, ...this.modrmMem(far ? (isCall ? 3 : 5) : (isCall ? 2 : 4), t, st)];
        }
        if (t.t === 'imm') {
          if (t.dist === 'FAR') {
            const sg = t.symSeg ? P.baseOf(t.symSeg) : null;
            return [isCall ? 0x9A : 0xEA, lo(t.v), hi(t.v), lo(sg === null ? 0 : sg), hi(sg === null ? 0 : sg)];
          }
          const tgt = this.relTarget(t);
          if (isCall) {
            const rel = tgt.v - (P.cur.pc + 3);
            return [0xE8, lo(rel), hi(rel)];
          }
          // JMP: short or near
          const relS = s16(tgt.v - (P.cur.pc + 2));
          if (t.dist === 'SHORT') {
            if (!tgt.undef && (relS < -128 || relS > 127)) fail(`Short jump target out of range (${relS} bytes)`);
            return [0xEB, relS & 0xFF];
          }
          const fits = relS >= -128 && relS <= 127;
          if (!fits && !tgt.undef) st.long = true;
          if (!st.long && t.dist !== 'NEAR') return [0xEB, relS & 0xFF];
          const rel = tgt.v - (P.cur.pc + 3);
          return [0xE9, lo(rel), hi(rel)];
        }
        fail('Invalid jump/call operand');
      }
      /* ---- string instructions with operands ---- */
      if (mn === 'MOVS' || mn === 'CMPS' || mn === 'STOS' || mn === 'LODS' || mn === 'SCAS') {
        let w = 0;
        for (const o of ops) if (o.t === 'mem' && o.size) w = o.size;
        if (!w) fail(`${mn}: operand size not specified (or use ${mn}B / ${mn}W)`);
        const base = { MOVS: 0xA4, CMPS: 0xA6, STOS: 0xAA, LODS: 0xAC, SCAS: 0xAE }[mn];
        // a segment override on the source operand applies
        const srcOp = (mn === 'MOVS') ? ops[1] : (mn === 'CMPS' ? ops[0] : (mn === 'LODS' ? ops[0] : null));
        return [...(srcOp ? this.pfx(srcOp) : []), base | (w === 16 ? 1 : 0)];
      }
      fail(`Unsupported instruction '${mn.toLowerCase()}'`);
    }

    immVal(op) {
      if (op.t !== 'imm') fail('Constant expected');
      return op.v;
    }
    relTarget(op) {
      if (op.t === 'imm') return { v: op.v & 0xFFFF, undef: op.undef };
      if (op.t === 'mem' && op.direct) return { v: op.disp & 0xFFFF, undef: op.dispUndef };
      fail('Jump target must be a label or address');
    }
  }

  const api = { Assembler, AsmError, assemble(src, opts) { return new Assembler(opts).assemble(src); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Asm8086 = api;
})(typeof window !== 'undefined' ? window : globalThis);
