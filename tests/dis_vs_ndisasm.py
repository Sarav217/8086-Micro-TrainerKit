#!/usr/bin/env python3
import subprocess, json, re, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asm_vs_nasm as T

def hexnorm(t):
    t = t.lower()
    t = re.sub(r'\b([0-9][0-9a-f]*)h\b', lambda m: '0x%x' % int(m.group(1), 16), t)
    t = re.sub(r'0x0+([0-9a-f])', r'0x\1', t)
    t = re.sub(r'\b(byte|word|dword) ptr ', r'\1 ', t)
    t = re.sub(r'\b(es|cs|ss|ds):\[([^\]]+)\]', r'[\1:\2]', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t
ALIASES = {'jc':'jb','jnc':'jnb','jna':'jbe','jnbe':'ja','jpe':'jp','jpo':'jnp','jnl':'jge','jng':'jle','jnge':'jl','jnle':'jg','jnae':'jb','je':'jz','jne':'jnz',
           'loope':'loopz','loopne':'loopnz','repe':'rep','repz':'rep','repnz':'repne','pushfw':'pushf','popfw':'popf','iretw':'iret','xlatb':'xlat','int3':'int 3'}
def canon(t):
    t = hexnorm(t)
    t = t.replace('jmp dword [','jmp far [').replace('call dword [','call far [')
    t = re.sub(r'^(call|jmp) word (0x[0-9a-f]+:0x[0-9a-f]+)', r'\1 \2', t)
    t = re.sub(r'\b(call|jmp) near ', r'\1 ', t)
    t = re.sub(r'^(call|jmp) word \[', r'\1 [', t)
    words = t.split(' ')
    out=[]
    for w in words: out.append(ALIASES.get(w, w))
    t=' '.join(out)
    m=re.match(r'^(rep|repne) (.*)$', t)
    if re.match(r'^(xchg|test) (\S+),(\S+)$', t):
        mm=re.match(r'^(xchg|test) (\S+),(\S+)$', t); t=f'{mm.group(1)} '+','.join(sorted([mm.group(2),mm.group(3)]))
    t = re.sub(r',byte \+(0x[0-9a-f]+)$', r',\1', t)
    mneg = re.search(r',byte -(0x[0-9a-f]+)$', t)
    if mneg: t = t[:mneg.start()] + ',0x%x' % ((0x10000 - int(mneg.group(1), 16)) & 0xFFFF)
    t = re.sub(r'\baam 0xa$','aam',t); t=re.sub(r'\baad 0xa$','aad',t)
    return t

def run():
    mine = json.loads(subprocess.run(['node', os.path.join(T.HERE,'asm_batch.js')], input=json.dumps(T.tests), capture_output=True, text=True, check=True).stdout)
    items = []
    for t, m in zip(T.tests, mine):
        if m.get('err'): continue
        nb, nerr = T.nasm_bytes([T.to_nasm(t)])
        if nerr: continue
        if nb[:1] == b'\x0f' or b'\x66' in nb[:2]: continue   # NASM 386-only encodings
        items.append((t, nb))
        items.append((t+' [mine]', bytes(m['bytes'])))
    dis = json.loads(subprocess.run(['node', os.path.join(T.HERE,'dis_batch.js')], input=json.dumps([b.hex() for _,b in items]), capture_output=True, text=True, check=True).stdout)
    bad = 0; ok = 0; seen = set()
    for (t, b), d in zip(items, dis):
        nd = T.disasm(b)
        if len(nd) != 1:
            # ndisasm decoded into several instructions (e.g. prefix split) - compare joined
            ntext = ' ; '.join(canon(x) for x in nd)
        else:
            ntext = canon(nd[0])
        mtext = canon(d['text'])
        if d['len'] != len(b) or mtext != ntext:
            key = (mtext, ntext)
            if key in seen: continue
            seen.add(key); bad += 1
            print(f'DIFF {t:42s} bytes={b.hex():14s} mine={d["text"]!r:38s} ndisasm={nd}')
        else: ok += 1
    print(f'\n{ok} ok, {bad} distinct differences')
    sys.exit(1 if bad else 0)
run()
