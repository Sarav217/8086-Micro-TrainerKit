// Runs every bundled example program on the simulated trainer and verifies its result.
'use strict';
const { Trainer, hex } = require('../web/trainer.js');
const Asm = require('../web/asm8086.js');
const EX = require('../web/examples.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  -> ' + x : '')); } };

for (const e of EX) {
  const t = new Trainer();
  const r = Asm.assemble(e.source, { loadSeg: 0, defaultOrg: 0x8000 });
  if (!r.ok) { ok(`${e.id}: assembles`, false, JSON.stringify(r.errors)); continue; }
  t.loadImage(r.image);
  const c = e.check || {};
  (c.ppiPins || []).forEach(([p, port, v]) => { t.ppi[p].pins[port] = v; });
  t.startRun(r.entry.cs, r.entry.ip);
  if (c.cyclesRun) {
    // run for a number of CPU clocks, sampling the LED latch
    const seen = new Set(); let last = -1;
    while (t.cpu.cycles < c.cyclesRun) { t.cpu.step(); const v = t.ppi[0].latch[1]; if (v !== last) { seen.add(v); last = v; } }
    ok(`${e.id}: counter visits ${[...seen].join(',')} in 1 s of kit time`, (c.ppiLatchRange || []).every(v => seen.has(v)) && seen.size >= 4 && seen.size <= 6, [...seen]);
    continue;
  }
  const n = c.run ? (() => { let k = 0; while (k < c.run) { t.cpu.step(); k++; } return k; })() : t.runUntilStop(2e6);
  if (!c.run) ok(`${e.id}: finishes (${n} instr, ${t.cpu.cycles} clk = ${(t.cpu.cycles / 5000).toFixed(2)} ms)`, t.mon.mode === 'HALT' && /HLT/.test(t.status), t.status);
  for (const [addr, bytes] of (c.mem || [])) {
    const got = bytes.map((_, i) => t.cpu.rb(addr + i));
    ok(`${e.id}: memory ${hex(addr, 4)}h = ${bytes.map(b => hex(b, 2)).join(' ')}`, JSON.stringify(got) === JSON.stringify(bytes), got.map(b => hex(b, 2)).join(' '));
  }
  for (const [p, port, v] of (c.ppiLatch || [])) ok(`${e.id}: 8255 #${p + 1} port ${'ABC'[port]} = ${hex(v, 2)}`, t.ppi[p].latch[port] === v, hex(t.ppi[p].latch[port], 2));
  if (c.lcd) ok(`${e.id}: LCD shows ${JSON.stringify(c.lcd)}`, t.lcd.text()[0].trim() === c.lcd[0] && t.lcd.text()[1].trim() === c.lcd[1], JSON.stringify(t.lcd.text()));
}
console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} example checks passed (${EX.length} programs)`));
process.exit(fail ? 1 : 0);
