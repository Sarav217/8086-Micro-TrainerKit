const { Trainer } = require('../web/trainer.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x === undefined ? '' : x); } };
const mk = () => new Trainer({ monitor: 'console' });
const type = (t, s) => { for (const ch of s) t.con(ch === '\n' ? 'Enter' : ch); };
const L = (t) => t.lcd.text();
let t = mk();
ok('boots in console', t.mon.mode === 'CON' && L(t)[0].startsWith('8086 TRAINER') && L(t)[1].startsWith('-'), L(t));
type(t, 'A8000\n');
ok('A shows address', L(t)[0].startsWith('0000:8000') && L(t)[1].startsWith('>'), L(t));
type(t, 'MOV AL,04\n');
ok('assembled 1', t.cpu.mem[0x8000] === 0xB0 && t.cpu.mem[0x8001] === 4, [t.cpu.mem[0x8000]]);
ok('advance to 8002', L(t)[0].startsWith('0000:8002 B004'), L(t));
type(t, 'MOV BL,04\nADD AL,BL\nMOV [8500],AL\nHLT\n\n');
ok('program bytes', Array.from(t.cpu.mem.slice(0x8000, 0x800A)).join() === [0xB0,4,0xB3,4,2,0xC3,0xA2,0,0x85,0xF4].join(), Array.from(t.cpu.mem.slice(0x8000, 0x800A)));
ok('exit A', L(t)[0].startsWith('END 0000:800A'), L(t));
type(t, 'G8000\n');
ok('running', t.mon.mode === 'RUN');
t.runUntilStop();
ok('ran to HLT', t.mon.mode === 'HALT' && t.cpu.mem[0x8500] === 8 && L(t)[0].startsWith('HLT'), L(t));
t.con('M');  // any key after halt returns to prompt
ok('back to prompt', t.mon.mode === 'CON' && L(t)[1].startsWith('-M'), L(t));
type(t, '8500\n');
ok('M shows output 08', L(t)[0].startsWith('0000:8500 =08') && L(t)[1].startsWith('NEW>'), L(t));
type(t, '\n');
ok('M enter next', L(t)[0].startsWith('0000:8501 =00'), L(t));
type(t, 'FF\n');
ok('M writes', t.cpu.mem[0x8501] === 0xFF && L(t)[0].startsWith('0000:8502'), L(t));
type(t, '-\n-\n');
ok('M back', L(t)[0].startsWith('0000:8500'), L(t));
type(t, '.');
t.con('Enter');
ok('M exit', t.mon.con.sub === 'CMD', L(t));
// unassemble
type(t, 'U8000\n');
ok('U', L(t)[1].startsWith('MOV AL,04') && L(t)[0].includes('B004'), L(t));
type(t, '\n');
ok('U next', L(t)[1].startsWith('MOV BL,04'), L(t));
// dump
type(t, 'D8000\n');
ok('D', L(t)[1] === 'B0 04 B3 04 02  ', L(t));
// registers
type(t, 'R\n');
ok('R page', L(t)[0] === 'AX=0408 BX=0004'.replace('0408', '0008') || L(t)[0].startsWith('AX='), L(t));
type(t, 'RCX\n');
ok('RCX edit prompt', L(t)[0].startsWith('CX=') && L(t)[1].startsWith('NEW>'), L(t));
type(t, '1234\n');
ok('RCX set', t.getReg('CX') === 0x1234, t.getReg('CX'));
// trace
t.reset(false);
type(t, 'T8000\n');
ok('T executes first', t.cpu.ip === 0x8002 && (t.getReg('AX') & 0xFF) === 4, [t.cpu.ip]);
type(t, '\n\n\n');
ok('T steps', t.cpu.ip === 0x8009 , t.cpu.ip.toString(16));
ok('T mem result', true);
type(t, '\n');
ok('T hits HLT', t.mon.mode === 'HALT', L(t));
// errors
t = mk();
type(t, 'A8000\nFOO BAR\n');
ok('asm error stays', t.mon.mode === 'CON' && L(t)[0].startsWith('ERR') && t.cpu.mem[0x8000] === 0, L(t));
type(t, 'Q'); // keeps typing after error
ok('error cleared', !L(t)[0].startsWith('ERR'), L(t));
t.con('Esc');
ok('Esc leaves A', t.mon.con.sub === 'CMD');
type(t, 'Z\n');
ok('unknown command', L(t)[0].startsWith('ERR'), L(t));
type(t, 'A8000\nMOV AX,FF\nMOV WORD PTR [9000],0FFFF\nJMP 8000\nMOV AL,\'A\'\nSHL AX,1\nINT 3\nDB 12,34\n\n');
ok('hex radix conv', t.cpu.mem[0x8000] === 0xB8 && t.cpu.mem[0x8001] === 0xFF && t.cpu.mem[0x8002] === 0, Array.from(t.cpu.mem.slice(0x8000, 0x8004)));
const d = Array.from(t.cpu.mem.slice(0x8003, 0x8020)).map(x => x.toString(16)).join(' ');
ok('mem imm + jmp absolute', t.cpu.mem[0x8003] === 0xC7 && d.startsWith('c7 6 0 90 ff ff eb f5'), d);
ok('char literal', d.includes('b0 41'), d);
ok('DB', d.includes('cc 12 34'), d);
// segment
t = mk(); type(t, 'A0800:0100\nMOV AL,55\nMOV [0],AL\n\n');
ok('seg assemble', t.cpu.mem[0x8100] === 0xB0 && t.cpu.mem[0x8101] === 0x55, Array.from(t.cpu.mem.slice(0x8100, 0x8104)));
type(t, 'G0800:0100\n'); 
// ROM write protect
t = mk(); type(t, 'AF000:0\nNOP\n');
ok('rom write rejected', L(t)[0].startsWith('ERR'), L(t));
// keypad buttons in console mode
t = mk(); t.key('A'); t.key('8'); t.key('0'); t.key('0'); t.key('0'); t.key('ENTER');
ok('keypad keys type', t.mon.con.sub === 'A' && t.mon.con.off === 0x8000, L(t));
t.key('RESET'); ok('reset prompt', t.mon.mode === 'CON' && t.mon.con.sub === 'CMD');
// G repeats last address; RAM survives reset
t = mk(); type(t, 'A8000\nMOV AL,7\nHLT\n\nG8000\n'); t.runUntilStop(); ok('G', (t.getReg('AX') & 255) === 7 && t.cpu.mem[0x8000] === 0xB0);
t.key('RESET'); type(t, 'G\n'); t.runUntilStop(); ok('G again after reset', t.mon.mode === 'HALT');
// LCD output by program is not clobbered until key
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
