/* =====================================================================
 *  8086 disassembler (MASM-style text, upper case)
 *  disasm(readByte, ip) -> { len, text, mn }
 *  readByte(i) returns byte at offset ip+i (i = 0,1,2...)
 * ===================================================================== */
(function (root) {
  'use strict';
  const R8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'];
  const R16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
  const SR = ['ES', 'CS', 'SS', 'DS'];
  const ALU = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'];
  const SHF = ['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAL', 'SAR'];   // /6 undocumented (SETMO) shown as DB
  const CC = ['JO', 'JNO', 'JB', 'JNB', 'JZ', 'JNZ', 'JBE', 'JA', 'JS', 'JNS', 'JP', 'JNP', 'JL', 'JGE', 'JLE', 'JG'];
  const EA = ['BX+SI', 'BX+DI', 'BP+SI', 'BP+DI', 'SI', 'DI', 'BP', 'BX'];

  const h8 = (v) => { const s = (v & 0xFF).toString(16).toUpperCase().padStart(2, '0'); return (s[0] > '9' ? '0' : '') + s + 'H'; };
  const h16 = (v) => { const s = (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); return (s[0] > '9' ? '0' : '') + s + 'H'; };
  const hnum = (v) => { const s = v.toString(16).toUpperCase(); return (s[0] > '9' ? '0' : '') + s + 'H'; };
  const sgn8 = (v) => (v & 0x80) ? v - 256 : v;

  function disasm(rd, ip) {
    let i = 0;
    const next = () => rd(i++) & 0xFF;
    const next16 = () => { const l = next(); return l | (next() << 8); };
    let seg = null, rep = '', lock = false;
    let op;
    for (;;) {
      op = next();
      if (op === 0x26) seg = 'ES'; else if (op === 0x2E) seg = 'CS'; else if (op === 0x36) seg = 'SS'; else if (op === 0x3E) seg = 'DS';
      else if (op === 0xF0) lock = true;
      else if (op === 0xF2) rep = 'REPNE '; else if (op === 0xF3) rep = 'REP ';
      else break;
      if (i > 6) break;
    }
    let segUsed = false;
    let mod = 0, reg = 0, rm = 0;
    const getModrm = () => { const m = next(); mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7; };
    // memory/register operand text after modrm fetched.  size: 8/16/0(none)
    const rmText = (w, ptr) => {
      if (mod === 3) return w ? R16[rm] : R8[rm];
      let s;
      if (mod === 0 && rm === 6) s = h16(next16());
      else {
        s = EA[rm];
        if (mod === 1) { const d = sgn8(next()); s += d < 0 ? '-' + h8(-d) : '+' + h8(d); }
        else if (mod === 2) { const d = next16(); s += '+' + h16(d); }
      }
      let t = '[' + s + ']';
      if (seg) { t = seg + ':' + t; segUsed = true; }
      if (ptr) t = (w ? 'WORD PTR ' : 'BYTE PTR ') + t;
      return t;
    };
    const finish = (text) => {
      let pre = '';
      if (lock) pre += 'LOCK ';
      if (rep && /^(MOVS|CMPS|STOS|LODS|SCAS)/.test(text)) pre += rep; else if (rep) pre += rep;
      if (seg && !segUsed) pre = SR.indexOf(seg) >= 0 ? seg + ': ' + pre : pre;
      const full = pre + text;
      return { len: i, text: full, mn: text.split(' ')[0] };
    };
    const bad = (b) => finish('DB ' + h8(b));
    const rel8 = () => { const d = sgn8(next()); return h16(((ip + i + d) & 0xFFFF)); };
    const rel16 = () => { const d = next16(); return h16(((ip + i + d) & 0xFFFF)); };

    if (op < 0x40) {
      const lo = op & 7;
      if (lo < 4) {
        getModrm();
        const w = lo & 1;
        const rmt = rmText(w, false);
        const rg = w ? R16[reg] : R8[reg];
        return finish(ALU[op >> 3] + ' ' + (lo < 2 ? rmt + ',' + rg : rg + ',' + rmt));
      }
      if (lo === 4) return finish(ALU[op >> 3] + ' AL,' + h8(next()));
      if (lo === 5) return finish(ALU[op >> 3] + ' AX,' + h16(next16()));
      switch (op) {
        case 0x06: case 0x0E: case 0x16: case 0x1E: return finish('PUSH ' + SR[(op >> 3) & 3]);
        case 0x07: case 0x17: case 0x1F: return finish('POP ' + SR[(op >> 3) & 3]);
        case 0x27: return finish('DAA'); case 0x2F: return finish('DAS');
        case 0x37: return finish('AAA'); case 0x3F: return finish('AAS');
        default: return bad(op);       // 0F, prefixes
      }
    }
    if (op < 0x48) return finish('INC ' + R16[op & 7]);
    if (op < 0x50) return finish('DEC ' + R16[op & 7]);
    if (op < 0x58) return finish('PUSH ' + R16[op & 7]);
    if (op < 0x60) return finish('POP ' + R16[op & 7]);
    if (op >= 0x60 && op < 0x70) return bad(op);
    if (op < 0x80) return finish(CC[op & 15] + ' ' + rel8());

    switch (op) {
      case 0x80: case 0x81: case 0x82: case 0x83: {
        getModrm();
        const w = op & 1;
        const t = rmText(w, mod !== 3);
        let imm;
        if (op === 0x81) imm = h16(next16());
        else if (op === 0x83) { const v = sgn8(next()); imm = v < 0 ? h16(v & 0xFFFF) : h8(v); if (v >= 0 && v > 0x7F) imm = h8(v); }
        else imm = h8(next());
        if (op === 0x82) return finish('DB ' + h8(op)); // alias; keep honest
        return finish(ALU[reg] + ' ' + t + ',' + imm);
      }
      case 0x84: case 0x85: { getModrm(); const w = op & 1; const t = rmText(w, false); return finish('TEST ' + t + ',' + (w ? R16[reg] : R8[reg])); }
      case 0x86: case 0x87: { getModrm(); const w = op & 1; const t = rmText(w, false); return finish('XCHG ' + t + ',' + (w ? R16[reg] : R8[reg])); }
      case 0x88: case 0x89: { getModrm(); const w = op & 1; const t = rmText(w, false); return finish('MOV ' + t + ',' + (w ? R16[reg] : R8[reg])); }
      case 0x8A: case 0x8B: { getModrm(); const w = op & 1; const t = rmText(w, false); return finish('MOV ' + (w ? R16[reg] : R8[reg]) + ',' + t); }
      case 0x8C: { getModrm(); const t = rmText(1, false); return finish('MOV ' + t + ',' + SR[reg & 3]); }
      case 0x8D: { getModrm(); if (mod === 3) return bad(op); const t = rmText(1, false); return finish('LEA ' + R16[reg] + ',' + t); }
      case 0x8E: { getModrm(); const t = rmText(1, false); return finish('MOV ' + SR[reg & 3] + ',' + t); }
      case 0x8F: { getModrm(); if (reg !== 0) return bad(op); const t = rmText(1, mod !== 3); return finish('POP ' + t); }
      case 0x90: return finish('NOP');
      case 0x98: return finish('CBW'); case 0x99: return finish('CWD');
      case 0x9A: { const o = next16(), s = next16(); return finish('CALL ' + h16(s) + ':' + h16(o)); }
      case 0x9B: return finish('WAIT');
      case 0x9C: return finish('PUSHF'); case 0x9D: return finish('POPF');
      case 0x9E: return finish('SAHF'); case 0x9F: return finish('LAHF');
      case 0xA0: case 0xA1: case 0xA2: case 0xA3: {
        const a = next16();
        let m = '[' + h16(a) + ']'; if (seg) { m = seg + ':' + m; segUsed = true; }
        const w = op & 1, acc = w ? 'AX' : 'AL';
        return finish('MOV ' + (op < 0xA2 ? acc + ',' + m : m + ',' + acc));
      }
      case 0xA4: return finish('MOVSB'); case 0xA5: return finish('MOVSW');
      case 0xA6: return finish('CMPSB'); case 0xA7: return finish('CMPSW');
      case 0xA8: return finish('TEST AL,' + h8(next()));
      case 0xA9: return finish('TEST AX,' + h16(next16()));
      case 0xAA: return finish('STOSB'); case 0xAB: return finish('STOSW');
      case 0xAC: return finish('LODSB'); case 0xAD: return finish('LODSW');
      case 0xAE: return finish('SCASB'); case 0xAF: return finish('SCASW');
      case 0xC2: return finish('RET ' + h16(next16()));
      case 0xC3: return finish('RET');
      case 0xC4: case 0xC5: { getModrm(); if (mod === 3) return bad(op); const t = rmText(1, false); return finish((op === 0xC4 ? 'LES ' : 'LDS ') + R16[reg] + ',' + t); }
      case 0xC6: { getModrm(); if (reg !== 0) return bad(op); const t = rmText(0, mod !== 3); return finish('MOV ' + t + ',' + h8(next())); }
      case 0xC7: { getModrm(); if (reg !== 0) return bad(op); const t = rmText(1, mod !== 3); return finish('MOV ' + t + ',' + h16(next16())); }
      case 0xCA: return finish('RETF ' + h16(next16()));
      case 0xCB: return finish('RETF');
      case 0xCC: return finish('INT 3');
      case 0xCD: return finish('INT ' + hnum(next()));
      case 0xCE: return finish('INTO'); case 0xCF: return finish('IRET');
      case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
        getModrm();
        if (reg === 6) { rmText(op & 1, false); return finish('DB ' + h8(op)); }
        const w = op & 1; const t = rmText(w, mod !== 3);
        return finish(SHF[reg] + ' ' + t + ',' + ((op & 2) ? 'CL' : '1'));
      }
      case 0xD4: { const b = next(); return finish(b === 10 ? 'AAM' : 'AAM ' + h8(b)); }
      case 0xD5: { const b = next(); return finish(b === 10 ? 'AAD' : 'AAD ' + h8(b)); }
      case 0xD7: return finish('XLAT');
      case 0xE0: return finish('LOOPNZ ' + rel8());
      case 0xE1: return finish('LOOPZ ' + rel8());
      case 0xE2: return finish('LOOP ' + rel8());
      case 0xE3: return finish('JCXZ ' + rel8());
      case 0xE4: return finish('IN AL,' + h8(next()));
      case 0xE5: return finish('IN AX,' + h8(next()));
      case 0xE6: { const p = next(); return finish('OUT ' + h8(p) + ',AL'); }
      case 0xE7: { const p = next(); return finish('OUT ' + h8(p) + ',AX'); }
      case 0xE8: return finish('CALL ' + rel16());
      case 0xE9: return finish('JMP ' + rel16());
      case 0xEA: { const o = next16(), s = next16(); return finish('JMP ' + h16(s) + ':' + h16(o)); }
      case 0xEB: return finish('JMP SHORT ' + rel8());
      case 0xEC: return finish('IN AL,DX'); case 0xED: return finish('IN AX,DX');
      case 0xEE: return finish('OUT DX,AL'); case 0xEF: return finish('OUT DX,AX');
      case 0xF4: return finish('HLT'); case 0xF5: return finish('CMC');
      case 0xF6: case 0xF7: {
        getModrm();
        const w = op & 1;
        const t = rmText(w, mod !== 3);
        if (reg === 0) return finish('TEST ' + t + ',' + (w ? h16(next16()) : h8(next())));
        if (reg === 1) return bad(op);
        return finish(['', '', 'NOT', 'NEG', 'MUL', 'IMUL', 'DIV', 'IDIV'][reg] + ' ' + t);
      }
      case 0xF8: return finish('CLC'); case 0xF9: return finish('STC');
      case 0xFA: return finish('CLI'); case 0xFB: return finish('STI');
      case 0xFC: return finish('CLD'); case 0xFD: return finish('STD');
      case 0xFE: { getModrm(); if (reg > 1) return bad(op); const t = rmText(0, mod !== 3); return finish((reg ? 'DEC ' : 'INC ') + t); }
      case 0xFF: {
        getModrm();
        if (reg === 7) return bad(op);
        if (reg < 2) { const t = rmText(1, mod !== 3); return finish((reg ? 'DEC ' : 'INC ') + t); }
        if (reg === 2) return finish('CALL ' + rmText(1, mod !== 3));
        if (reg === 3) { if (mod === 3) return bad(op); return finish('CALL DWORD PTR ' + rmText(1, false)); }
        if (reg === 4) return finish('JMP ' + rmText(1, mod !== 3));
        if (reg === 5) { if (mod === 3) return bad(op); return finish('JMP DWORD PTR ' + rmText(1, false)); }
        return finish('PUSH ' + rmText(1, mod !== 3));
      }
      default:
        if (op >= 0x91 && op <= 0x97) return finish('XCHG AX,' + R16[op & 7]);
        if (op >= 0xB0 && op <= 0xB7) return finish('MOV ' + R8[op & 7] + ',' + h8(next()));
        if (op >= 0xB8 && op <= 0xBF) return finish('MOV ' + R16[op & 7] + ',' + h16(next16()));
        return bad(op);
    }
  }

  const api = { disasm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Dis8086 = api;
})(typeof window !== 'undefined' ? window : globalThis);
