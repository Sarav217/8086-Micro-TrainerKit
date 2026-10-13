/* Example programs.  `check` is used by tests/examples_test.js to prove every example works on the simulated kit. */
(function (root) {
  'use strict';
  const E = [];
  const add = (id, group, title, source, check) => E.push({ id, group, title, source: source.replace(/^\n/, ''), check: check || {} });

  /* ---------------------------------------------------------------- arithmetic */
  add('add8', 'Arithmetic', 'Add two 8-bit numbers', `
; Add two 8-bit numbers with carry.
; Input : 9000h = first number, 9001h = second number
; Output: 9002h = sum, 9003h = carry (0 or 1)
        ORG 8000H
        MOV SI, 9000H
        MOV AL, [SI]         ; first number
        ADD AL, [SI+1]       ; + second number
        MOV [SI+2], AL       ; store sum
        MOV AL, 0
        ADC AL, 0            ; AL = carry flag
        MOV [SI+3], AL
        HLT

        ORG 9000H
        DB 0F5H, 3CH         ; F5 + 3C = 131  -> sum 31, carry 1
`, { mem: [[0x9002, [0x31, 0x01]]] });

  add('sub16', 'Arithmetic', 'Subtract two 16-bit numbers', `
; 16-bit subtraction with borrow flag.
; Input : 9000h-9001h = minuend, 9002h-9003h = subtrahend
; Output: 9004h-9005h = difference, 9006h = borrow (0/1)
        ORG 8000H
        MOV AX, [9000H]
        SUB AX, [9002H]
        MOV [9004H], AX
        MOV AL, 0
        ADC AL, 0            ; AL = borrow (CF)
        MOV [9006H], AL
        HLT

        ORG 9000H
        DW 5678H, 1234H      ; 5678 - 1234 = 4444
`, { mem: [[0x9004, [0x44, 0x44, 0x00]]] });

  add('mul8', 'Arithmetic', '8-bit multiplication', `
; Unsigned 8-bit multiply.  9000h x 9001h -> 16-bit product at 9002h (low byte first)
        ORG 8000H
        MOV AL, [9000H]
        MOV BL, [9001H]
        MUL BL               ; AX = AL * BL
        MOV [9002H], AX
        HLT

        ORG 9000H
        DB 0FH, 0EH          ; 15 x 14 = 210 = D2h
`, { mem: [[0x9002, [0xD2, 0x00]]] });

  add('div16', 'Arithmetic', '32-bit by 16-bit division', `
; DX:AX / CX -> quotient in AX, remainder in DX
; 100000 (000186A0h) / 7 = 14285 (37CDh) remainder 5
        ORG 8000H
        MOV DX, 0001H
        MOV AX, 86A0H
        MOV CX, 7
        DIV CX
        MOV [9000H], AX      ; quotient
        MOV [9002H], DX      ; remainder
        HLT
`, { mem: [[0x9000, [0xCD, 0x37, 0x05, 0x00]]] });

  add('add32', 'Arithmetic', '32-bit addition (ADD / ADC)', `
; 0001FFFFh + 00000001h = 00020000h
; Result: DX:AX, stored low word first at 9000h
        ORG 8000H
        MOV AX, 0FFFFH
        MOV DX, 0001H
        ADD AX, 0001H
        ADC DX, 0000H
        MOV [9000H], AX
        MOV [9002H], DX
        HLT
`, { mem: [[0x9000, [0x00, 0x00, 0x02, 0x00]]] });

  add('bcd', 'Arithmetic', 'BCD addition (DAA)', `
; Add two packed BCD numbers: 47 + 38 = 85
        ORG 8000H
        MOV AL, 47H
        ADD AL, 38H
        DAA                  ; decimal adjust
        MOV [9000H], AL
        HLT
`, { mem: [[0x9000, [0x85]]] });

  add('fact', 'Arithmetic', 'Factorial of a number', `
; N! for N = 5  -> 120 (78h)   (N must be 8 or less to fit in 16 bits)
        ORG 8000H
        MOV CL, 5            ; N
        MOV AX, 1
        MOV CH, 0
NEXT:   MUL CX               ; AX = AX * CX   (DX:AX)
        LOOP NEXT
        MOV [9000H], AX
        HLT
`, { mem: [[0x9000, [0x78, 0x00]]] });

  add('fib', 'Arithmetic', 'Fibonacci series', `
; First 10 Fibonacci numbers stored from 9000h
        ORG 8000H
        MOV DI, 9000H
        MOV BYTE PTR [DI], 0
        MOV BYTE PTR [DI+1], 1
        MOV CX, 8
        INC DI
NEXT:   MOV AL, [DI-1]
        ADD AL, [DI]
        INC DI
        MOV [DI], AL
        LOOP NEXT
        HLT
`, { mem: [[0x9000, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]]] });

  add('ones', 'Arithmetic', 'Count the 1 bits in a byte', `
; Number of 1s in the byte at 9000h -> result at 9001h
        ORG 8000H
        MOV AL, [9000H]
        MOV CX, 8
        MOV BL, 0
AGAIN:  ROL AL, 1
        ADC BL, 0            ; add the bit that rotated into carry
        LOOP AGAIN
        MOV [9001H], BL
        HLT

        ORG 9000H
        DB 0B7H              ; 10110111b -> six 1s
`, { mem: [[0x9001, [6]]] });

  /* ---------------------------------------------------------------- arrays */
  add('sum', 'Arrays and strings', 'Sum of N numbers', `
; Sum of 8 bytes starting at 9000h; 16-bit result at 9100h
        ORG 8000H
        MOV SI, 9000H
        MOV CX, 8
        MOV AX, 0
NEXT:   MOV BL, [SI]
        MOV BH, 0
        ADD AX, BX
        INC SI
        LOOP NEXT
        MOV [9100H], AX
        HLT

        ORG 9000H
        DB 10, 20, 30, 40, 50, 60, 70, 80     ; sum = 360 = 0168h
`, { mem: [[0x9100, [0x68, 0x01]]] });

  add('largest', 'Arrays and strings', 'Largest number in an array', `
; Largest (unsigned) of 8 bytes at 9000h -> result at 9100h
        ORG 8000H
        MOV SI, 9000H
        MOV CX, 7            ; 8 numbers need 7 comparisons
        MOV AL, [SI]
NEXT:   INC SI
        CMP AL, [SI]
        JAE SKIP             ; keep AL if AL >= [SI]
        MOV AL, [SI]
SKIP:   LOOP NEXT
        MOV [9100H], AL
        HLT

        ORG 9000H
        DB 12H, 0A5H, 33H, 7FH, 0E1H, 05H, 99H, 40H
`, { mem: [[0x9100, [0xE1]]] });

  add('smallest', 'Arrays and strings', 'Smallest number in an array', `
; Smallest (unsigned) of 8 bytes at 9000h -> result at 9100h
        ORG 8000H
        MOV SI, 9000H
        MOV CX, 7
        MOV AL, [SI]
NEXT:   INC SI
        CMP AL, [SI]
        JBE SKIP             ; keep AL if AL <= [SI]
        MOV AL, [SI]
SKIP:   LOOP NEXT
        MOV [9100H], AL
        HLT

        ORG 9000H
        DB 12H, 0A5H, 33H, 7FH, 0E1H, 05H, 99H, 40H
`, { mem: [[0x9100, [0x05]]] });

  add('sortasc', 'Arrays and strings', 'Sort ascending (bubble sort)', `
; Bubble sort of 8 unsigned bytes at 9000h, smallest first
        ORG 8000H
        MOV CL, 7            ; passes
OUTER:  MOV SI, 9000H
        MOV CH, 7            ; comparisons per pass
INNER:  MOV AL, [SI]
        CMP AL, [SI+1]
        JBE NOSWAP
        XCHG AL, [SI+1]      ; swap the two bytes
        MOV [SI], AL
NOSWAP: INC SI
        DEC CH
        JNZ INNER
        DEC CL
        JNZ OUTER
        HLT

        ORG 9000H
        DB 64H, 22H, 0F0H, 01H, 55H, 0AH, 99H, 03H
`, { mem: [[0x9000, [0x01, 0x03, 0x0A, 0x22, 0x55, 0x64, 0x99, 0xF0]]] });

  add('sortdesc', 'Arrays and strings', 'Sort descending (bubble sort)', `
; Bubble sort of 8 unsigned bytes at 9000h, largest first
        ORG 8000H
        MOV CL, 7
OUTER:  MOV SI, 9000H
        MOV CH, 7
INNER:  MOV AL, [SI]
        CMP AL, [SI+1]
        JAE NOSWAP
        XCHG AL, [SI+1]
        MOV [SI], AL
NOSWAP: INC SI
        DEC CH
        JNZ INNER
        DEC CL
        JNZ OUTER
        HLT

        ORG 9000H
        DB 64H, 22H, 0F0H, 01H, 55H, 0AH, 99H, 03H
`, { mem: [[0x9000, [0xF0, 0x99, 0x64, 0x55, 0x22, 0x0A, 0x03, 0x01]]] });

  add('blockmove', 'Arrays and strings', 'Block move (REP MOVSB)', `
; Copy 10 bytes from 9000h to 9100h using the string instructions
        ORG 8000H
        MOV SI, 9000H        ; source  (DS:SI)
        MOV DI, 9100H        ; destination (ES:DI)
        MOV CX, 10
        CLD                  ; auto-increment
        REP MOVSB
        HLT

        ORG 9000H
        DB 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
`, { mem: [[0x9100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]] });

  add('strrev', 'Arrays and strings', 'Reverse a string', `
; Reverse the 6-character string at 9000h into 9100h
        ORG 8000H
        MOV SI, 9005H        ; last character
        MOV DI, 9100H
        MOV CX, 6
NEXT:   MOV AL, [SI]
        MOV [DI], AL
        DEC SI
        INC DI
        LOOP NEXT
        HLT

        ORG 9000H
        DB 'SASTHA'          ; reversed: AHTSAS
`, { mem: [[0x9100, [0x41, 0x48, 0x54, 0x53, 0x41, 0x53]]] });

  add('palin', 'Arrays and strings', 'Palindrome check', `
; Is the 9-character string at 9000h a palindrome?   9100h = 1 (yes) or 0 (no)
        ORG 8000H
        MOV SI, 9000H        ; first character
        MOV DI, 9008H        ; last character
        MOV CX, 4            ; compare 4 pairs
CHECK:  MOV AL, [SI]
        CMP AL, [DI]
        JNE NOTPAL
        INC SI
        DEC DI
        LOOP CHECK
        MOV BYTE PTR [9100H], 1
        HLT
NOTPAL: MOV BYTE PTR [9100H], 0
        HLT

        ORG 9000H
        DB 'MALAYALAM'
`, { mem: [[0x9100, [1]]] });

  add('hex2asc', 'Arrays and strings', 'Byte to two ASCII hex digits', `
; Convert the byte at 9000h into two ASCII characters at 9001h/9002h
        ORG 8000H
        MOV AL, [9000H]
        MOV AH, AL
        MOV CL, 4
        SHR AL, CL           ; high nibble
        CALL TOASC
        MOV [9001H], AL
        MOV AL, AH
        AND AL, 0FH          ; low nibble
        CALL TOASC
        MOV [9002H], AL
        HLT

TOASC:  ADD AL, 30H          ; 0-9 -> '0'-'9'
        CMP AL, 3AH
        JB DONE
        ADD AL, 7            ; A-F
DONE:   RET

        ORG 9000H
        DB 0AFH              ; -> 'A' 'F'
`, { mem: [[0x9001, [0x41, 0x46]]] });

  /* ---------------------------------------------------------------- 8255 / LCD / interrupts */
  add('sw2led', 'I/O (8255, LCD, interrupts)', 'Switches to LEDs (8255 #1)', `
; 8255 #1 (ports 00h, 02h, 04h, control 06h)
; Port A = input (switches), Port B = output (LEDs).  Runs until RESET.
; In the I/O tab, click the Port A switches and watch Port B follow.
        ORG 8000H
        MOV AL, 90H          ; control word: A in, B out, C out (mode 0)
        OUT 06H, AL
AGAIN:  IN AL, 00H           ; read switches
        OUT 02H, AL          ; show on LEDs
        JMP AGAIN
`, { run: 3000, ppiPins: [[0, 0, 0x5A]], ppiLatch: [[0, 1, 0x5A]] });

  add('ledcount', 'I/O (8255, LCD, interrupts)', 'Binary LED counter with delay', `
; Port B LEDs count in binary; the delay loop takes about 0.22 s at 5 MHz.
; Runs until RESET.
        ORG 8000H
        MOV AL, 80H          ; all ports output
        OUT 06H, AL
        MOV BL, 0
LOOP1:  MOV AL, BL
        OUT 02H, AL          ; show counter
        CALL DELAY
        INC BL
        JMP LOOP1

DELAY:  MOV CX, 0FFFFH       ; 65535 x LOOP (17 clocks) = about 0.22 s
D1:     LOOP D1
        RET
`, { cyclesRun: 5000000, ppiLatchRange: [0, 1, 2, 3] });

  add('7seg', 'I/O (8255, LCD, interrupts)', 'Digit to 7-segment code (XLAT)', `
; Look up the 7-segment pattern for a digit with XLAT and send it to Port A
        ORG 8000H
        MOV AL, 80H          ; all ports output
        OUT 06H, AL
        MOV BX, OFFSET TABLE
        MOV AL, 5            ; digit to show
        XLAT                 ; AL = TABLE[AL]
        OUT 00H, AL
        HLT

TABLE:  DB 3FH, 06H, 5BH, 4FH, 66H, 6DH, 7DH, 07H, 7FH, 6FH
`, { ppiLatch: [[0, 0, 0x6D]] });

  add('lcdhello', 'I/O (8255, LCD, interrupts)', 'Write text on the LCD', `
; HD44780 16x2 LCD at I/O ports 10h (command) and 12h (data).
; (Port addresses are editable in Settings.)
        ORG 8000H
        MOV AL, 38H          ; 8-bit, 2 lines, 5x8 font
        OUT 10H, AL
        MOV AL, 0CH          ; display on, cursor off
        OUT 10H, AL
        MOV AL, 01H          ; clear display
        OUT 10H, AL
        CALL WAITLCD
        MOV AL, 80H          ; cursor to line 1, column 0
        OUT 10H, AL
        MOV SI, OFFSET MSG1
        CALL PRINT
        MOV AL, 0C0H         ; cursor to line 2, column 0
        OUT 10H, AL
        MOV SI, OFFSET MSG2
        CALL PRINT
        HLT

PRINT:  MOV AL, [SI]
        CMP AL, 0
        JE  DONE
        CALL WAITLCD
        OUT 12H, AL
        INC SI
        JMP PRINT
DONE:   RET

WAITLCD:                     ; wait while the busy flag (bit 7) is set
        PUSH AX
W1:     IN AL, 10H
        TEST AL, 80H
        JNZ W1
        POP AX
        RET

MSG1:   DB 'SASTHA 8086', 0
MSG2:   DB 'TRAINER KIT', 0
`, { lcd: ['SASTHA 8086', 'TRAINER KIT'] });

  add('isr', 'I/O (8255, LCD, interrupts)', 'Software interrupt with your own handler', `
; Install a handler for INT 40h in the vector table (0000:0100h) and call it twice
        ORG 8000H
        XOR AX, AX
        MOV DS, AX
        MOV WORD PTR [0100H], OFFSET ISR     ; vector 40h = 4 x 40h = 0100h (offset)
        MOV WORD PTR [0102H], 0000H          ;                          (segment)
        MOV BX, 0
        INT 40H
        INT 40H
        MOV [9000H], BX      ; BX = 2 (handler ran twice)
        HLT

ISR:    INC BX
        IRET
`, { mem: [[0x9000, [2, 0]]] });

  add('stack', 'I/O (8255, LCD, interrupts)', 'Subroutine and stack demo', `
; CALL/RET and PUSH/POP.  SQUARE doubles as a multiplication subroutine.
        ORG 8000H
        MOV SP, 7FF0H
        MOV AL, 12
        CALL SQUARE          ; AX = 144
        MOV [9000H], AX
        MOV AL, 25
        CALL SQUARE          ; AX = 625
        MOV [9002H], AX
        HLT

SQUARE: PUSH BX
        MOV BL, AL
        MUL BL
        POP BX
        RET
`, { mem: [[0x9000, [144, 0, 0x71, 0x02]]] });

  root.EXAMPLES = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
