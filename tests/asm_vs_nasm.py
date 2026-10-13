#!/usr/bin/env python3
"""Differential test: my assembler vs NASM, compared through ndisasm text."""
import subprocess, json, os, re, sys, tempfile, itertools

HERE = os.path.dirname(os.path.abspath(__file__))
R8 = ['al','cl','dl','bl','ah','ch','dh','bh']
R16 = ['ax','cx','dx','bx','sp','bp','si','di']
SEG = ['es','cs','ss','ds']
MEMS = ['[bx]','[bp]','[si]','[di]','[bx+si]','[bx+di]','[bp+si]','[bp+di]','[bx+5]','[bp-2]','[si+300h]',
        '[1234h]','[bx+si+7Fh]','[bx+di-80h]','[bp+di+1000h]','es:[bx]','cs:[bp+si+2]','[bp+0]','ss:[di]','[di+0FFh]','[bx-1]','[bp+7Fh]','[bp+80h]']
IMM8 = ['0','1','5','7Fh','80h','0FFh','-1','-128','12h']
IMM16 = ['0','1','5','7Fh','80h','0FFh','100h','1234h','0FFFFh','-1','-128','-129','8000h','0FF80h']
ALU = ['add','or','adc','sbb','and','sub','xor','cmp']
tests = []
def T(s): tests.append(s)

for op in ALU:
    for a,b in [('al','bl'),('cl','dh'),('ah','al'),('bh','ch')]: T(f'{op} {a},{b}')
    for a,b in [('ax','bx'),('cx','dx'),('si','di'),('sp','bp'),('di','ax'),('bx','sp')]: T(f'{op} {a},{b}')
    for m in MEMS:
        for r in ['al','dh']: T(f'{op} {r},{m}'); T(f'{op} {m},{r}')
        for r in ['ax','si','bp']: T(f'{op} {r},{m}'); T(f'{op} {m},{r}')
        for i in IMM8: T(f'{op} byte ptr {m},{i}')
        for i in IMM16: T(f'{op} word ptr {m},{i}')
    for r in ['al','cl','bh']:
        for i in IMM8: T(f'{op} {r},{i}')
    for r in ['ax','cx','di','bp']:
        for i in IMM16: T(f'{op} {r},{i}')
# mov
for a in R8:
    for b in R8[:3]: T(f'mov {a},{b}')
    for i in IMM8: T(f'mov {a},{i}')
for a in R16:
    for b in R16[:3]: T(f'mov {a},{b}')
    for i in IMM16: T(f'mov {a},{i}')
    for s in SEG:
        if True: T(f'mov {a},{s}'); 
        if s!='cs': T(f'mov {s},{a}')
for m in MEMS:
    for r in R8: T(f'mov {r},{m}'); T(f'mov {m},{r}')
    for r in R16: T(f'mov {r},{m}'); T(f'mov {m},{r}')
    for s in SEG: T(f'mov {m},{s}')
    for s in ['es','ss','ds']: T(f'mov {s},{m}')
    for i in IMM8: T(f'mov byte ptr {m},{i}')
    for i in IMM16: T(f'mov word ptr {m},{i}')
# push/pop/xchg/test/inc/dec/etc
for r in R16: T(f'push {r}'); T(f'pop {r}'); T(f'inc {r}'); T(f'dec {r}'); T(f'xchg ax,{r}'); T(f'xchg {r},ax'); T(f'neg {r}'); T(f'not {r}'); T(f'mul {r}'); T(f'imul {r}'); T(f'div {r}'); T(f'idiv {r}')
for r in R8: T(f'inc {r}'); T(f'dec {r}'); T(f'neg {r}'); T(f'not {r}'); T(f'mul {r}'); T(f'imul {r}'); T(f'div {r}'); T(f'idiv {r}')
for s in SEG: T(f'push {s}')
for s in ['es','ss','ds']: T(f'pop {s}')
for a,b in [('al','bl'),('cl','dh'),('bx','cx'),('si','di')]: T(f'xchg {a},{b}'); T(f'test {a},{b}')
for m in MEMS:
    T(f'push word ptr {m}'); T(f'pop word ptr {m}')
    for w in ['byte','word']:
        for op in ['inc','dec','neg','not','mul','imul','div','idiv']: T(f'{op} {w} ptr {m}')
    for r in ['al','bx','dh','si']: T(f'xchg {r},{m}'); T(f'xchg {m},{r}'); T(f'test {r},{m}'); T(f'test {m},{r}')
    for i in IMM8: T(f'test byte ptr {m},{i}')
    for i in IMM16: T(f'test word ptr {m},{i}')
    T(f'lea ax,{m}') if not m.startswith(('es:','cs:','ss:')) else None
    T(f'lea di,{m}'); T(f'lds si,{m}'); T(f'les di,{m}'); T(f'lds bx,{m}')
    T(f'jmp word ptr {m}'); T(f'jmp dword ptr {m}'); T(f'call word ptr {m}'); T(f'call dword ptr {m}')
for i in IMM8: T(f'test al,{i}'); T(f'test bl,{i}')
for i in IMM16: T(f'test ax,{i}'); T(f'test dx,{i}')
# shifts
for op in ['rol','ror','rcl','rcr','shl','sal','shr','sar']:
    for r in ['al','dh','ax','si']: T(f'{op} {r},1'); T(f'{op} {r},cl')
    for m in MEMS[:12]:
        T(f'{op} byte ptr {m},1'); T(f'{op} word ptr {m},cl'); T(f'{op} word ptr {m},1'); T(f'{op} byte ptr {m},cl')
# in/out
for p in ['0','5','0F0h','0FFh','80h']:
    T(f'in al,{p}'); T(f'in ax,{p}'); T(f'out {p},al'); T(f'out {p},ax')
T('in al,dx'); T('in ax,dx'); T('out dx,al'); T('out dx,ax')
# misc
for x in ['nop','hlt','clc','stc','cmc','cld','std','cli','sti','cbw','cwd','sahf','lahf','pushf','popf','daa','das','aaa','aas','into','iret','wait',
          'movsb','movsw','cmpsb','cmpsw','stosb','stosw','lodsb','lodsw','scasb','scasw','xlat','ret','retf','ret 4','retf 8','ret 0FFFFh','aam','aad','aam 8','aad 8',
          'int 0','int 3','int 21h','int 0FFh','rep movsb','repe cmpsb','repne scasb','rep stosw','repz cmpsw','repnz scasw','lock inc word ptr [bx]','rep movsw','rep lodsb']:
    T(x)
# jumps (absolute targets, org 0)
for x in ['jmp 10h','jmp 0','jmp 200h','jmp short 10h','jmp 1234h:5678h','call 1234h:5678h','call 100h','call 0','call 0F000h','jmp ax','jmp bx','jmp si','call ax','call di','call cx','jmp 7Fh','jmp 81h','jmp 82h','jmp 0FFFFh']:
    T(x)
for cc in ['jo','jno','jb','jnae','jc','jae','jnb','jnc','je','jz','jne','jnz','jbe','jna','ja','jnbe','js','jns','jp','jpe','jnp','jpo','jl','jnge','jge','jnl','jle','jng','jg','jnle','loop','loope','loopz','loopne','loopnz','jcxz']:
    T(f'{cc} 10h'); T(f'{cc} 0'); T(f'{cc} 7Fh'); T(f'{cc} 0FFFFh'); T(f'{cc} 81h')
# size prefixes for strings with operands
T('movs byte ptr es:[di],byte ptr [si]'); T('movs word ptr [di],word ptr [si]'); T('cmps byte ptr [si],byte ptr es:[di]')
T('stos byte ptr [di]'); T('stos word ptr [di]'); T('lods byte ptr [si]'); T('lods word ptr es:[si]'); T('scas byte ptr [di]'); T('scas word ptr [di]')

def to_nasm(s):
    s = re.sub(r'\b(byte|word|dword) ptr ', r'\1 ', s)
    s = re.sub(r'\b(es|cs|ss|ds):\[([^\]]+)\]', r'[\1:\2]', s)
    s = re.sub(r'\b(0[0-9A-Fa-f]*[hH]|[0-9][0-9A-Fa-f]*h)\b', lambda m: '0x'+m.group(0)[:-1], s)
    s = s.replace('jmp short','jmp short').replace('movs ','movs ')
    return s

def nasm_bytes(lines):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d,'a.asm'); out = os.path.join(d,'a.bin')
        open(src,'w').write('bits 16\norg 0\n'+'\n'.join(lines)+'\n')
        r = subprocess.run(['nasm','-f','bin','-o',out,src],capture_output=True,text=True)
        if r.returncode: return None, r.stderr.strip().splitlines()[0] if r.stderr else 'nasm error'
        return open(out,'rb').read(), None

def disasm(b):
    with tempfile.NamedTemporaryFile(delete=False,suffix='.bin') as f: f.write(b); n=f.name
    r = subprocess.run(['ndisasm','-b','16',n],capture_output=True,text=True); os.unlink(n)
    out=[]
    for ln in r.stdout.splitlines():
        parts = ln.split(None,2)
        if len(parts)>=3: out.append(parts[2].strip())
        elif parts and out: out[-1]+=''
    return out

def norm(lst):
    res=[]
    for t in lst:
        t=t.lower()
        t=re.sub(r'\s+',' ',t)
        m=re.match(r'^(xchg|test) (\S+),(\S+)$',t)
        if m: t=f'{m.group(1)} '+','.join(sorted([m.group(2),m.group(3)]))
        t=re.sub(r'\bshort ','',t); t=re.sub(r'\bnear ','',t)
        res.append(t)
    return res

def main():
    mine = json.loads(subprocess.run(['node',os.path.join(HERE,'asm_batch.js')],input=json.dumps(tests),capture_output=True,text=True,check=True).stdout)
    bad=0; both_err=0; ok=0; diffbytes=0; lengthdiff=0; mine_err=[]; nasm_err=[]
    for t,m in zip(tests,mine):
        nb, nerr = nasm_bytes([to_nasm(t)])
        if m.get('err') and nerr: both_err+=1; continue
        if m.get('err'): mine_err.append((t,m.get('err'))); bad+=1; continue
        if nerr: nasm_err.append((t,nerr)); continue      # nasm rejected, mine accepted: informational
        mb = bytes(m['bytes'])
        dm = norm(disasm(mb)); dn = norm(disasm(nb))
        if dm != dn:
            bad+=1; print(f'MISMATCH  {t:45s} mine={mb.hex()} {dm}   nasm={nb.hex()} {dn}')
        else:
            ok+=1
            if mb!=nb: diffbytes+=1
            if len(mb)!=len(nb): lengthdiff+=1
    print(f'\n{len(tests)} tests: identical-instruction={ok} (different-but-equivalent encodings={diffbytes}, different length={lengthdiff}) both-rejected={both_err} mismatches/errors={bad}')
    print('--- mine rejected, nasm accepted:'); [print('  ',t,'=>',e) for t,e in mine_err[:40]]
    print('--- nasm rejected, mine accepted:'); [print('  ',t,'=>',e) for t,e in nasm_err[:40]]
    sys.exit(1 if bad else 0)
if __name__ == "__main__":
    main()
