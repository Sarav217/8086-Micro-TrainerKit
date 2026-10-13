// reads JSON array of single instructions on stdin, assembles each at org 0, prints [{bytes|err}]
const A = require('../web/asm8086.js');
const list = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = list.map(t => {
  const r = A.assemble('org 0\n' + t, { loadSeg: 0, defaultOrg: 0 });
  if (!r.ok) return { err: r.errors[0].msg };
  const bytes = []; r.image.forEach(c => bytes.push(...c.bytes));
  return { bytes };
});
console.log(JSON.stringify(out));
