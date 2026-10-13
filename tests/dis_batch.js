// stdin: JSON array of hex strings (one instruction each, org 0). stdout: [{len,text}]
const D = require('../web/dis8086.js');
const list = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(JSON.stringify(list.map(h => {
  const b = Buffer.from(h, 'hex');
  const r = D.disasm(i => (i < b.length ? b[i] : 0), 0);
  return { len: r.len, text: r.text };
})));
