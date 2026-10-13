# 8086 Trainer Kit Simulator (Sastha 8086 trainer model)

Open `web/index.html` in Chrome / Edge / Firefox. No server or internet needed.

## Use
* **Type on the LCD (default):** `A8000` Enter, then one instruction per line (hex numbers), empty line to finish; `G8000` runs; `M8500` shows/changes memory; also `D`, `U`, `R`, `T`. Switch to hex-keypad monitor style in Settings.
* **Run program** - assemble the editor text, load into RAM, run on the kit.
* **Type in with keypad** - assembles, then enters the bytes with MEM / ENTER / NEXT as on the real kit. Then press GO, GO.
* **Step**, **Pause/Resume**, breakpoints (Code tab), speed (real 5 MHz timing or faster).
* Inspector: registers/flags (editable), memory (editable), disassembly, 8255 ports (click input bits), trace, settings.
* PC keyboard: 0-9 A-F, M MEM, R REG, G GO, S STEP, Enter, arrows, : SEG, Del CLR, Esc RESET.

## What is exact and what is assumed
* Exact: 8086 CPU (all instructions/flags/quirks; 646,000 hardware test vectors pass), documented clock timing, assembler (cross-checked with NASM) and disassembler (ndisasm).
* Reconstructed (not visible in a photo): monitor firmware behaviour and LCD messages, keypad layout, port map (8255 #1 at 00h, #2 at 08h, LCD cmd 10h / data 12h), RAM 64 KB at 0000-FFFF, ROM at F0000. Change addresses in Settings; send your manual or EPROM dump to match the real monitor exactly.

## Tests (need Node; ui_test.py needs Python Playwright)
`node tests/console_tests.js`, `node tests/trainer_tests.js`, `node tests/examples_test.js`, `python3 tests/ui_test.py <outdir>`,
`node tests/run_vectors.js <vector dir>` (SingleStepTests/8086 vectors, not bundled).
