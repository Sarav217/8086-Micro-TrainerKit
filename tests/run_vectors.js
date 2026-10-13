// Runs the SingleStepTests/8086 hardware vectors (Intel P80C86A-2) against cpu8086.js
// usage: node run_vectors.js <vecdir> [name-filter ...]
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const CPU = require('../web/cpu8086.js');

const dir = process.argv[2] || '/home/claude/vec';
const filters = process.argv.slice(3);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'))).opcodes;

function maskFor(name) {
  const [op, reg] = name.split('.');
  const m = meta[op];
  if (!m) return 0xFFFF;
  if (m.reg && reg !== undefined) { const e = m.reg[reg]; return (e && e['flags-mask'] !== undefined) ? e['flags-mask'] : 0xFFFF; }
  return m['flags-mask'] !== undefined ? m['flags-mask'] : 0xFFFF;
}

const REGS = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const SEGS = ['es', 'cs', 'ss', 'ds'];
const cpu = new CPU();
cpu.setPages(0, 0xFFFFF, CPU.PAGE.RAM);
cpu.io = { in: (p, w) => (w ? 0xFFFF : 0xFF), out: () => {} };

let totalPass = 0, totalFail = 0;
const failedOps = [];
const files = fs.readdirSync(path.join(dir, 'gz')).filter(f => f.endsWith('.json.gz')).sort();
for (const file of files) {
  const name = file.replace('.json.gz', '');
  if (filters.length && !filters.some(f => name.startsWith(f))) continue;
  const tests = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'gz', file))));
  const mask = maskFor(name);
  let pass = 0, fail = 0, firstFail = null;
  for (const t of tests) {
    cpu.mem.fill(0);
    const ini = t.initial.regs;
    REGS.forEach((n, i) => cpu.r[i] = ini[n]);
    SEGS.forEach((n, i) => cpu.s[i] = ini[n]);
    cpu.ip = ini.ip; cpu.f = ini.flags & 0x0FD5 | 0xF002; cpu.halted = false;
    for (const [a, v] of t.initial.ram) cpu.mem[a] = v;
    cpu.f = ini.flags;               // keep raw so TF etc. match the vector
    cpu.step();
    const fin = Object.assign({}, ini, t.final.regs);
    let bad = [];
    REGS.forEach((n, i) => { if (cpu.r[i] !== fin[n]) bad.push(`${n}: got ${cpu.r[i].toString(16)} exp ${fin[n].toString(16)}`); });
    SEGS.forEach((n, i) => { if (cpu.s[i] !== fin[n]) bad.push(`${n}: got ${cpu.s[i].toString(16)} exp ${fin[n].toString(16)}`); });
    if (cpu.ip !== fin.ip) bad.push(`ip: got ${cpu.ip.toString(16)} exp ${fin.ip.toString(16)}`);
    const gf = cpu.getF() & mask, ef = fin.flags & mask;
    if (gf !== ef) bad.push(`flags: got ${gf.toString(16)} exp ${ef.toString(16)} (diff ${(gf ^ ef).toString(16)}, mask ${mask.toString(16)})`);
    // when an exception pushed FLAGS, undefined flag bits inside that pushed word are not comparable
    const pushedLo = (cpu.s[2] << 4) + cpu.r[4], intr = (cpu.r[4] === ((ini.sp - 6) & 0xFFFF)) && mask !== 0xFFFF;
    for (const [a, v] of t.final.ram) {
      let m = 0xFF;
      if (intr && a === (pushedLo & 0xFFFFF) + 4) m = mask & 0xFF;
      if (intr && a === (pushedLo & 0xFFFFF) + 5) m = (mask >> 8) & 0xFF;
      if ((cpu.mem[a] & m) !== (v & m)) { bad.push(`mem[${a.toString(16)}]: got ${cpu.mem[a].toString(16)} exp ${v.toString(16)}`); break; }
    }
    if (bad.length && process.env.VERBOSE && fail < +process.env.VERBOSE) console.log('  ', name, t.name, '[' + t.bytes.map(b=>b.toString(16)).join(' ') + ']', 'init ax=' + ini.ax.toString(16), 'fl=' + ini.flags.toString(16), '|', bad.join('; '));
    if (bad.length) { fail++; if (!firstFail) firstFail = `${t.name} [${t.bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}] :: ${bad.join('; ')}`; }
    else pass++;
  }
  totalPass += pass; totalFail += fail;
  if (fail) { failedOps.push(name); console.log(`FAIL ${name}: ${pass}/${pass + fail}  first: ${firstFail}`); }
}
console.log(`\nTOTAL pass=${totalPass} fail=${totalFail}  failing opcode files=${failedOps.length}`);
process.exit(totalFail ? 1 : 0);
