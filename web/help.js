(function () {
  'use strict';
  const el = document.getElementById('helpBody');
  if (!el) return;
  el.innerHTML = `
<h3>What this is</h3>
<p>A software model of an 8086 trainer kit (16x2 LCD, hex keypad, 2 x 8255 ports, 64 KB RAM, EPROM monitor). The <b>CPU is a full 8086</b>: every instruction, flag, segment and interrupt behaves like the real chip (checked against hardware test vectors). Everything around the CPU, meaning the monitor program, port addresses and memory map, is a <b>reconstruction</b> and can be changed under <b>Settings</b>.</p>

<div class="warn"><b>Be aware:</b> the exact monitor firmware, key layout and port addresses of your own kit could not be seen from a photo. If your lab manual gives different addresses (for example the 8255 or LCD port numbers), set them in <b>Settings &rarr; I/O ports</b>. The key sequence and the messages on the LCD follow a typical trainer monitor and may differ slightly from your kit.</div>

<h3>Typing programs directly on the kit (default)</h3>
<p>Just use your keyboard: the LCD works like a DEBUG-style monitor. <b>Numbers are hex</b> (no <code>H</code> needed).</p>
<table>
<tr><th>You type</th><th>What happens</th></tr>
<tr><td><code>A8000</code> + Enter</td><td>Assemble at 0000:8000. The top line shows the current address, you type an instruction on the bottom line, Enter stores it and moves to the next address. An empty line + Enter finishes.</td></tr>
<tr><td><code>G8000</code> + Enter</td><td>Run from 8000. (<code>G</code> alone repeats the last start address.) RESET stops a running program.</td></tr>
<tr><td><code>M8500</code> + Enter</td><td>Show the byte at 8500. Enter = next address, type a value + Enter = change it, <code>-</code> = back, <code>.</code> = exit.</td></tr>
<tr><td><code>D8500</code></td><td>Dump 5 bytes at a time (Enter = next 5).</td></tr>
<tr><td><code>U8000</code></td><td>List the program as instructions (Enter = next).</td></tr>
<tr><td><code>R</code> / <code>RAX</code></td><td>Show registers (Enter = next page) / change one register.</td></tr>
<tr><td><code>T8000</code></td><td>Single-step: executes one instruction, Enter = next one.</td></tr>
</table>
<p>Example: <code>A8000</code>, then <code>MOV AL,04</code> <code>MOV BL,04</code> <code>ADD AL,BL</code> <code>MOV [8500],AL</code> <code>HLT</code>, empty line, then <code>G8000</code>, then <code>M8500</code> shows <b>08</b>. Jumps use absolute addresses (<code>JNZ 8003</code>). Use <code>WORD PTR</code> / <code>BYTE PTR</code> when a memory operand has no register. The on-screen keypad types the same letters (MEM=M, REG=R, GO=G, STEP=T). Backspace edits, Esc leaves a prompt. Switch to the old hex-keypad monitor style under Settings. (The editor below uses normal MASM numbers: <code>8500H</code>.)</p>

<h3>Quick start with the editor</h3>
<ol>
<li>Pick a program under <b>Examples</b> or write your own in the editor.</li>
<li>Press <b>Run program</b>. It is assembled, loaded into RAM and executed. The LCD, registers, memory and ports update live.</li>
<li>Use <b>Step</b> to execute one instruction at a time and watch registers change. Click the dot beside a line in the <b>Code</b> tab to set a breakpoint.</li>
</ol>

<h3>Hex-keypad monitor style (Settings)</h3>
<ol>
<li>Write the program and press <b>Type in with keypad</b>. The simulator assembles it and then types each byte for you using MEM / ENTER / NEXT, so you can watch the exact key sequence. (Or enter the bytes yourself.)</li>
<li>Press <b>GO</b>, type the start offset (default 8000), press <b>GO</b> again (or ENTER).</li>
<li>Press <b>RESET</b> to stop a program and return to the monitor.</li>
</ol>

<h3>Keypad / monitor commands</h3>
<table>
<tr><th>Key</th><th>What it does</th></tr>
<tr><td><kbd>MEM</kbd></td><td>Examine / modify memory. Type the offset in hex (use <kbd>SEG</kbd> to edit the segment), press <kbd>ENTER</kbd> to see the byte at that address. Type two hex digits to change it, <kbd>NEXT</kbd> stores it and moves to the next address, <kbd>PREV</kbd> goes back. Press <kbd>MEM</kbd> again to type a new address. Line 2 shows the disassembly of that address.</td></tr>
<tr><td><kbd>REG</kbd></td><td>Show registers: AX BX CX DX SP BP SI DI CS DS SS ES IP FL. <kbd>NEXT</kbd>/<kbd>PREV</kbd> move between them. Type hex digits to change the value, <kbd>ENTER</kbd> to store.</td></tr>
<tr><td><kbd>GO</kbd></td><td>Run a program: press GO, type the offset (and segment through <kbd>SEG</kbd>), press GO or ENTER.</td></tr>
<tr><td><kbd>STEP</kbd></td><td>Single-step. Press STEP once to select it, then STEP (or ENTER) to execute the instruction shown.</td></tr>
<tr><td><kbd>CLR</kbd></td><td>Clears the field you are typing in.</td></tr>
<tr><td><kbd>RESET</kbd></td><td>Hardware reset. RAM contents are kept (as on the real kit). <b>Power cycle</b> at the top clears RAM.</td></tr>
</table>

<h3>PC keyboard shortcuts</h3>
<p><kbd>0-9 A-F</kbd> hex keys, <kbd>M</kbd> MEM, <kbd>R</kbd> REG, <kbd>G</kbd> GO, <kbd>S</kbd> STEP, <kbd>:</kbd> SEG, <kbd>Enter</kbd> ENTER, <kbd>&rarr;</kbd> NEXT, <kbd>&larr;</kbd> PREV, <kbd>Del</kbd> CLR, <kbd>Esc</kbd> RESET. These work whenever the cursor is not inside the editor or a text box.</p>

<h3>Assembler</h3>
<ul>
<li>Intel/MASM style: <code>MOV AX, [BX+SI+4]</code>, <code>BYTE PTR</code>, <code>WORD PTR</code>, <code>OFFSET</code>, <code>SEG</code>, segment overrides (<code>ES:[DI]</code>), <code>SHORT</code>/<code>NEAR</code>/<code>FAR</code> jumps.</li>
<li>Numbers: <code>1234H</code>, <code>0x1234</code>, <code>1010B</code>, <code>255</code>, <code>'A'</code>. A hex number starting with a letter needs a leading 0 (<code>0FFH</code>).</li>
<li>Directives: <code>ORG</code>, <code>DB</code>, <code>DW</code>, <code>DD</code> (with <code>DUP</code>), <code>EQU</code>, <code>=</code>, <code>EVEN</code>, <code>SEGMENT/ENDS</code>, <code>ASSUME</code>, <code>PROC/ENDP</code>, <code>END label</code>.</li>
<li>Without <code>SEGMENT</code> the program is placed at the <b>Default start</b> (0000:8000) or at your <code>ORG</code>. Use RAM addresses 0000-FFFF (the user area of this kit is 8000 upwards by default; the vector table is at 0000-03FF).</li>
<li>8086 only: shifts and rotates take a count of <code>1</code> or <code>CL</code>. There is no <code>PUSH imm</code>, no <code>SHL AX, 4</code>, no 80186+ instructions.</li>
<li>Comments start with <code>;</code>. End your program with <code>HLT</code> (the kit then shows where it stopped) or <code>INT 3</code>.</li>
</ul>

<h3>What happens when a program ends</h3>
<ul>
<li><code>HLT</code>: the LCD shows <b>HLT EXECUTED</b> and the address. Press RESET to continue.</li>
<li><code>INT 3</code>: shows <b>BREAK AT</b> with the address.</li>
<li>Any interrupt without a handler returns to the monitor with a message (for example a divide error shows <b>UNHANDLED INT 00</b>). Install your own handler in the vector table at 0000:(4*n) to use interrupts.</li>
<li>A program that writes to the LCD itself takes over the display; the monitor does not overwrite it until RESET.</li>
</ul>

<h3>Assumed hardware map (editable in Settings)</h3>
<table>
<tr><th>Device</th><th>Address</th></tr>
<tr><td>RAM</td><td>00000 - 0FFFF (64 KB, configurable), contents survive RESET</td></tr>
<tr><td>Monitor ROM</td><td>F0000 - FFFFF (reset vector at FFFF0)</td></tr>
<tr><td>8255 #1 &nbsp;(A, B, C, control)</td><td>I/O 00h, 02h, 04h, 06h</td></tr>
<tr><td>8255 #2 &nbsp;(A, B, C, control)</td><td>I/O 08h, 0Ah, 0Ch, 0Eh</td></tr>
<tr><td>LCD command / status</td><td>I/O 10h (read = busy flag in bit 7)</td></tr>
<tr><td>LCD data</td><td>I/O 12h</td></tr>
</table>
<p>The 8255s start in mode 0 with all ports as inputs (control word 9Bh), as after a hardware reset. Use the <b>I/O ports</b> tab to see output LEDs and to toggle input switches.</p>

<h3>Speed</h3>
<p>By default the program runs at the real 5 MHz clock speed using the documented 8086 instruction timing, so delay loops take the same time as on the kit. Use the Speed list for faster execution while you debug.</p>
`;
  const dlg = document.getElementById('helpDlg');
  document.getElementById('btnHelp').addEventListener('click', () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
  document.getElementById('helpClose').addEventListener('click', () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && dlg.close) dlg.close(); });
})();
