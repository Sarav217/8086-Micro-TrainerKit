// End-to-end tests: assembler -> trainer (keypad, monitor, LCD, 8255) -> CPU
'use strict';
const { Trainer, hex } = require('../web/trainer.js');
const Asm = require('../web/asm8086.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
const eq = (name, got, exp) => ok(name, JSON.stringify(got) === JSON.stringify(exp), `got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`);
const mem = (t, seg, off, n) => Array.from({ length: n }, (_, i) => t.cpu.rbs(seg, off + i));
function asmLoad(t, src, opts) {
  const r = Asm.assemble(src, opts || { loadSeg: 0, defaultOrg: 0x8000 });
  if (!r.ok) throw new Error('assemble failed: ' + JSON.stringify(r.errors));
  t.loadImage(r.image);
  return r;
}
function go(t, seg, off) {
  t.key('GO');
  if (seg !== undefined) { t.key('SEG'); for (const ch of hex(seg, 4)) t.key(ch); t.key('SEG'); for (const ch of hex(off, 4)) t.key(ch); }
  t.key('ENTER');
  return t.runUntilStop(5e6);
}

console.log('== keypad: examine / modify memory');
{
  const t = new Trainer();
  eq('power-on LCD', t.lcd.text()[0].trim(), '8086 TRAINER');
  t.key('MEM');
  eq('MEM shows default address', t.lcd.text()[0].trim(), '0000:8000=00');
  t.key('ENTER');                       // go to data field
  for (const [hi, lo] of [['B', '8'], ['3', '4'], ['1', '2'], ['F', '4']]) { t.key(hi); t.key(lo); t.key('NEXT'); }
  eq('bytes written by keypad', mem(t, 0, 0x8000, 4), [0xB8, 0x34, 0x12, 0xF4]);
  t.key('PREV'); t.key('PREV');
  eq('PREV moves back & shows byte', t.lcd.text()[0].trim(), '0000:8002=12');
  eq('LCD row 2 shows disassembly (12 F4 = ADC DH,AH)', t.lcd.text()[1].trim(), 'ADC DH,AH');
  t.key('MEM'); for (const c of '8000') t.key(c); t.key('ENTER');
  eq('row 2 disassembly of MOV AX,1234H', t.lcd.text()[1].trim(), 'MOV AX,1234H');
  // type a new address
  t.key('MEM'); for (const c of '8003') t.key(c); t.key('ENTER');
  eq('row 2 shows HLT at 8003', t.lcd.text()[1].trim(), 'HLT');
  eq('row 1 matches the kit display style', t.lcd.text()[0].trim(), '0000:8003=F4');
}

console.log('== keypad: segment edit, data shift-in, ROM write protection');
{
  const t = new Trainer();
  t.key('MEM'); t.key('SEG'); for (const c of '0100') t.key(c); t.key('SEG');
  for (const c of '0020') t.key(c); t.key('ENTER'); t.key('A'); t.key('5'); t.key('ENTER');
  eq('segment:offset write', t.cpu.rb(0x1000 + 0x20), 0xA5);
  t.key('MEM'); t.key('SEG'); for (const c of 'F000') t.key(c); t.key('SEG'); for (const c of '0200') t.key(c); t.key('ENTER'); t.key('1'); t.key('2'); t.key('ENTER');
  ok('ROM write rejected', t.cpu.rbs(0xF000, 0x200) === 0xFF && /ROM/.test(t.status), t.status);
}

console.log('== keypad: registers');
{
  const t = new Trainer();
  t.key('REG'); eq('first reg is AX', t.lcd.text()[0].trim(), 'AX=0000');
  for (const c of '1234') t.key(c); t.key('ENTER');
  eq('AX written', t.cpu.r[0], 0x1234);
  t.key('NEXT'); eq('next reg BX', t.lcd.text()[0].trim(), 'BX=0000');
  for (const c of '00FF') t.key(c); t.key('NEXT');
  eq('BX written on NEXT', t.cpu.r[3], 0xFF);
  for (let i = 0; i < 10; i++) t.key('NEXT');
  eq('cycles CX..ES to IP', t.lcd.text()[0].trim().slice(0, 2), 'IP');
  t.key('NEXT'); eq('flags register row', t.lcd.text()[0].trim().startsWith('FL=F'), true);
}

console.log('== GO: run machine-code program entered from the keypad');
{
  const t = new Trainer();
  // MOV AX,1234 ; ADD AX,1111 ; MOV [9000],AX ; HLT
  const prog = [0xB8, 0x34, 0x12, 0x05, 0x11, 0x11, 0xA3, 0x00, 0x90, 0xF4];
  t.key('MEM'); t.key('ENTER');
  for (const b of prog) { for (const ch of hex(b, 2)) t.key(ch); t.key('NEXT'); }
  const n = go(t);
  eq('AX = 2345H', t.cpu.r[0], 0x2345);
  eq('[9000] = 2345H', mem(t, 0, 0x9000, 2), [0x45, 0x23]);
  eq('stopped on HLT', t.mon.mode, 'HALT');
  eq('instruction count', n, 4);
  ok('status mentions HLT', /HLT/.test(t.status), t.status);
}

console.log('== STEP (single stepping)');
{
  const t = new Trainer();
  asmLoad(t, 'org 8000h\n mov ax,5\n mov bx,7\n add ax,bx\n hlt');
  t.key('STEP');
  eq('STEP shows first instruction', [t.lcd.text()[0].trim(), t.lcd.text()[1].trim()], ['0000:8000=B8', 'MOV AX,0005H']);
  t.key('STEP'); eq('after 1 step IP', t.cpu.ip, 0x8003);
  eq('shows next', t.lcd.text()[1].trim(), 'MOV BX,0007H');
  t.key('STEP'); t.key('STEP');
  eq('AX = 12 after ADD', t.cpu.r[0], 12);
  eq('next is HLT', t.lcd.text()[1].trim(), 'HLT');
}

console.log('== INT 3 breakpoint, divide error, unhandled INT, return stub');
{
  const t = new Trainer();
  asmLoad(t, 'org 8000h\n mov ax,1\n int 3\n mov ax,2\n hlt');
  go(t);
  ok('INT3 -> BREAK message', /BREAK/.test(t.lcd.text()[0]) && t.cpu.ip === 0x8004, t.lcd.text().join('|') + ' ip=' + t.cpu.ip.toString(16));
  eq('AX at break', t.cpu.r[0], 1);
  t.key('GO'); t.key('ENTER'); t.runUntilStop();     // GO from the shown address continues
  eq('continues after breakpoint', t.cpu.r[0], 2);

  const t2 = new Trainer();
  asmLoad(t2, 'org 8000h\n mov ax,100\n mov bl,0\n div bl\n hlt');
  go(t2);
  ok('divide by zero reported', /DIVIDE ERROR/.test(t2.status), t2.status);

  const t3 = new Trainer();
  asmLoad(t3, 'org 8000h\n int 21h\n hlt');
  go(t3);
  ok('unhandled INT 21h reported', /UNHANDLED INT 21/.test(t3.lcd.text()[0]), t3.lcd.text().join('|'));

  const t4 = new Trainer();
  asmLoad(t4, 'org 8000h\n mov ax,9\n jmp 0F000h:0000h');
  go(t4);
  ok('far JMP into ROM = return to monitor', /RETURNED/.test(t4.status), t4.status);
}

console.log('== user-installed interrupt handler works');
{
  const t = new Trainer();
  asmLoad(t, `org 8000h
    xor ax,ax
    mov ds,ax
    mov word ptr [80h],isr      ; vector 20h
    mov word ptr [82h],0
    mov bx,0
    int 20h
    int 20h
    hlt
isr: inc bx
    iret`);
  go(t);
  eq('ISR ran twice', t.cpu.r[3], 2);
}

console.log('== classic lab programs');
{
  let t = new Trainer();
  asmLoad(t, `org 8000h
    mov cx,10
    xor ax,ax
l:  add ax,cx
    loop l
    mov [9000h],ax
    hlt`);
  go(t); eq('sum 1..10 = 55', t.cpu.rbs(0, 0x9000), 55);

  t = new Trainer();
  asmLoad(t, `org 8000h
    mov cx,5
    mov ax,1
f:  mul cx
    loop f
    mov [9000h],ax
    hlt`);
  go(t); eq('5! = 120', t.cpu.rws(0, 0x9000), 120);

  t = new Trainer();
  asmLoad(t, `org 8000h
    mov si,9000h
    mov di,9100h
    mov cx,6
    cld
    rep movsb
    hlt
    org 9000h
    db 'SASTHA'`);
  go(t); eq('REP MOVSB copies string', Array.from(mem(t, 0, 0x9100, 6)).map(c => String.fromCharCode(c)).join(''), 'SASTHA');

  t = new Trainer();          // bubble sort
  asmLoad(t, `org 8000h
        mov cl,8
outer:  mov si,9000h
        mov ch,7
inner:  mov al,[si]
        cmp al,[si+1]
        jbe noswap
        xchg al,[si+1]
        mov [si],al
noswap: inc si
        dec ch
        jnz inner
        dec cl
        jnz outer
        hlt
        org 9000h
        db 64h,22h,0F0h,01h,55h,0Ah,99h,03h`);
  go(t); eq('bubble sort (unsigned)', mem(t, 0, 0x9000, 8), [1, 3, 10, 0x22, 0x55, 0x64, 0x99, 0xF0]);

  t = new Trainer();          // BCD add with DAA: 47 + 38 = 85
  asmLoad(t, 'org 8000h\n mov al,47h\n add al,38h\n daa\n mov [9000h],al\n hlt');
  go(t); eq('BCD 47+38=85', t.cpu.rbs(0, 0x9000), 0x85);

  t = new Trainer();          // 32-bit add with carry
  asmLoad(t, `org 8000h
    mov ax,0FFFFh
    mov dx,0001h
    add ax,0002h
    adc dx,0
    hlt`);
  go(t); eq('32-bit add with ADC', [t.cpu.r[0], t.cpu.r[2]], [1, 2]);

  t = new Trainer();          // largest of array using forward label + DB/DW data
  asmLoad(t, `org 8000h
    mov si,offset arr
    mov cx,5
    mov ax,[si]
nxt: add si,2
    cmp ax,[si]
    jge skip
    mov ax,[si]
skip: loop nxt
    mov [9100h],ax
    hlt
arr dw 12,500,33,4000,7`);
  go(t); eq('largest word', t.cpu.rws(0, 0x9100), 4000);
}

console.log('== MASM style segments');
{
  const t = new Trainer();
  asmLoad(t, `DATA SEGMENT
  A DB 12h
  B DB 34h
  R DW ?
DATA ENDS
CODE SEGMENT
  ASSUME CS:CODE, DS:DATA
START: MOV AX,DATA
  MOV DS,AX
  MOV AL,A
  ADD AL,B
  MOV AH,0
  MOV R,AX
  HLT
CODE ENDS
END START`, { loadSeg: 0, defaultOrg: 0x8000 });
  const r = Asm.assemble(`DATA SEGMENT\n A DB 12h\n B DB 34h\n R DW ?\nDATA ENDS\nCODE SEGMENT\n START: MOV AX,DATA\n MOV DS,AX\n MOV AL,A\n ADD AL,B\n MOV AH,0\n MOV R,AX\n HLT\nCODE ENDS\nEND START`, { loadSeg: 0, defaultOrg: 0x8000 });
  ok('assembles', r.ok, JSON.stringify(r.errors));
  go(t, r.entry.cs, r.entry.ip);
  eq('R = 46H', t.cpu.rws(t.cpu.s[3], 2), 0x46);
}

console.log('== 8255 PPI + LEDs/switches');
{
  const t = new Trainer();
  asmLoad(t, `org 8000h
    mov al,90h        ; port A in, B out, C out
    out 06h,al
    in al,00h         ; read switches on port A
    out 02h,al        ; echo to port B LEDs
    mov al,0AAh
    out 04h,al
    hlt`);
  t.ppi[0].pins[0] = 0x3C;
  go(t);
  eq('PB echoes switches', t.ppi[0].latch[1], 0x3C);
  eq('PC output', t.ppi[0].latch[2], 0xAA);
  eq('port state shows outputs', t.ppi[0].portState(1).map(b => b.v).join(''), '00111100'.split('').reverse().join(''));
  // BSR
  const t2 = new Trainer();
  asmLoad(t2, 'org 8000h\n mov al,80h\n out 06h,al\n mov al,05h\n out 06h,al\n mov al,03h\n out 06h,al\n hlt');
  go(t2); eq('BSR: 05h sets PC2, 03h sets PC1 => 06h', t2.ppi[0].latch[2], 0x06);
  // second PPI
  const t3 = new Trainer();
  asmLoad(t3, 'org 8000h\n mov al,80h\n out 0Eh,al\n mov al,0F0h\n out 08h,al\n hlt');
  go(t3); eq('8255 #2 port A', t3.ppi[1].latch[0], 0xF0);
}

console.log('== LCD driven by program');
{
  const t = new Trainer();
  asmLoad(t, `org 8000h
    mov al,38h
    out 10h,al      ; function set
    mov al,0Ch
    out 10h,al      ; display on
    mov al,01h
    out 10h,al      ; clear
    mov al,80h
    out 10h,al      ; line 1
    mov si,offset msg
nxt: mov al,[si]
    cmp al,0
    je done
    out 12h,al
    inc si
    jmp nxt
done: mov al,0C0h
    out 10h,al      ; line 2
    mov al,'8'
    out 12h,al
    mov al,'6'
    out 12h,al
    hlt
msg db 'HELLO SASTHA',0`);
  go(t);
  eq('LCD row 1', t.lcd.text()[0].trim(), 'HELLO SASTHA');
  eq('LCD row 2', t.lcd.text()[1].trim(), '86');
  ok('LCD stays user-owned after HLT', t.lcd.userOwned, '');
}

console.log('== timing');
{
  const t = new Trainer();
  asmLoad(t, 'org 8000h\n mov cx,0FFFFh\nl: loop l\n hlt');
  const c0 = t.cpu.cycles; go(t);
  const ms = (t.cpu.cycles - c0) / 5000;
  ok(`MOV CX,FFFF / LOOP delay = ${ms.toFixed(1)} ms @5MHz (expected ~223)`, ms > 215 && ms < 230);
  // tick() respects real time at speed 1
  const t2 = new Trainer();
  asmLoad(t2, 'org 8000h\nl: jmp l');
  go(t2); t2.mon.mode = 'RUN';
  const n = t2.tick(10);
  ok(`10 ms of real time = ~${n} instructions (JMP loop 15 clk -> ~3333)`, n > 3000 && n < 3700, n);
}

console.log('== power-on / reset');
{
  const t = new Trainer();
  asmLoad(t, 'org 8000h\n mov ax,0BEEFh\n mov [9000h],ax\n hlt'); go(t);
  t.key('RESET');
  eq('RESET keeps RAM', t.cpu.rws(0, 0x9000), 0xBEEF);
  eq('RESET restores CS:IP', [t.cpu.s[1], t.cpu.ip], [0, 0x8000]);
  eq('RESET: IDLE', t.mon.mode, 'IDLE');
  t.powerOn();
  eq('power cycle clears RAM', t.cpu.rws(0, 0x9000), 0);
}

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} trainer tests passed`));
process.exit(fail ? 1 : 0);
