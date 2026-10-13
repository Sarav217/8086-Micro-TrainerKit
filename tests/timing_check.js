// Compare documented-table cycle estimates with real P80C86A-2 bus-cycle counts from the vectors.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const CPU = require('../web/cpu8086.js');
const dir = process.argv[2] || '/home/claude/vec';
const cpu = new CPU(); cpu.setPages(0, 0xFFFFF, 0);
cpu.io = { in: (p, w) => (w ? 0xFFFF : 0xFF), out: () => {} };
const REGS = ['ax','cx','dx','bx','sp','bp','si','di'], SEGS = ['es','cs','ss','ds'];
const rows = [];
for (const file of fs.readdirSync(path.join(dir, 'gz')).sort()) {
  const name = file.replace('.json.gz', '');
  const tests = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'gz', file))));
  let sum = 0, sumAbs = 0, n = 0, rel = 0;
  for (const t of tests.slice(0, 600)) {
    cpu.mem.fill(0);
    const i = t.initial.regs;
    REGS.forEach((r, k) => cpu.r[k] = i[r]); SEGS.forEach((r, k) => cpu.s[k] = i[r]);
    cpu.ip = i.ip; cpu.f = i.flags; cpu.halted = false;
    for (const [a, v] of t.initial.ram) cpu.mem[a] = v;
    cpu.step();
    const real = t.cycles.length, mine = cpu.lastCycles;
    sum += mine - real; sumAbs += Math.abs(mine - real); rel += (mine - real) / real; n++;
  }
  rows.push({ name, meanDiff: sum / n, meanAbs: sumAbs / n, rel: rel / n });
}
const tot = rows.reduce((a, r) => a + r.meanAbs, 0) / rows.length;
const within = rows.filter(r => Math.abs(r.meanDiff) <= 4).length;
console.log(`opcodes compared: ${rows.length}; mean |error| per opcode = ${tot.toFixed(2)} clocks; opcodes with |mean error| <= 4 clocks: ${within}`);
const bad = rows.filter(r => Math.abs(r.meanDiff) > 6).sort((a, b) => Math.abs(b.meanDiff) - Math.abs(a.meanDiff));
console.log('largest deviations (mine - real):'); bad.slice(0, 40).forEach(r => console.log(`  ${r.name.padEnd(6)} mean ${r.meanDiff.toFixed(1)}  (${(r.rel * 100).toFixed(0)}%)`));
