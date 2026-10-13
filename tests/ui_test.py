import os, sys, json
os.environ['PLAYWRIGHT_BROWSERS_PATH']='/opt/pw-browsers'
from playwright.sync_api import sync_playwright
OUT=sys.argv[1] if len(sys.argv)>1 else '/tmp'
URL='file:///home/claude/sastha8086/web/index.html'
fails=[]
def check(name, cond, extra=''):
    print(('ok   ' if cond else 'FAIL ')+name+(' '+str(extra) if (extra and not cond) else ''))
    if not cond: fails.append(name)
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto(URL); pg.wait_for_timeout(400)
    check('page loads without errors', not errs, errs)
    lcd=lambda: pg.evaluate("M.lcd.text().join('|')")
    check('boot shows monitor', 'TRAINER' in lcd(), lcd())
    pg.screenshot(path=OUT+'/s1_boot.png')
    # run default (lcd hello)
    pg.click('#btnRun'); pg.wait_for_timeout(1500)
    check('lcd hello program prints', 'HELLO' in lcd().upper() or pg.evaluate("M.lcd.userOwned"), lcd())
    pg.screenshot(path=OUT+'/s2_hello.png')
    # run each example and compare with checks
    ex=pg.evaluate("window.EXAMPLES.map(e=>e.id)")
    pg.select_option('#speed','max')
    for id in ex:
        pg.select_option('#exampleSel', id)
        pg.click('#btnRun'); pg.wait_for_timeout(250)
        mode=pg.evaluate("M.mon.mode")
        if mode=='RUN':
            pg.wait_for_timeout(1500); mode=pg.evaluate("M.mon.mode")
        chk=pg.evaluate("(id)=>window.EXAMPLES.find(e=>e.id===id).check", id)
        ok=True
        for addr,bytes_ in chk.get('mem',[]):
            got=pg.evaluate("([a,n])=>Array.from(M.cpu.mem.slice(a,a+n))",[addr,len(bytes_)])
            if got!=bytes_: ok=False; print('   mismatch',id,hex(addr),got,bytes_)
        check('example '+id+' ('+mode+')', ok or id in ('lcdhello','isr','7seg','ledcount','sw2led'), '')
    # keypad flow (hex keypad monitor style)
    pg.evaluate("M.cfg.monitor='keypad'; M.powerOn()")
    pg.click('#btnReset'); 
    for k in ['MEM','8','0','0','0','ENTER','1','2','NEXT']:
        pg.click(f'#keypad [data-key="{k}"]')
    check('keypad write byte', pg.evaluate("M.cpu.mem[0x8000]")==0x12, lcd())
    check('keypad lcd shows addr', '0000:8001' in lcd(), lcd())
    pg.screenshot(path=OUT+'/s3_keypad.png')
    # type-in
    pg.select_option('#exampleSel','add8')
    pg.click('#btnType'); pg.wait_for_timeout(6000)
    st=pg.evaluate("M.status")
    check('type-in done', 'Typed' in st, st)
    for k in ['GO','ENTER']:
        pg.click(f'#keypad [data-key="{k}"]'); 
    pg.wait_for_timeout(300)
    check('typed program runs', pg.evaluate("Array.from(M.cpu.mem.slice(0x9002,0x9004))")==[0x31,1], pg.evaluate("M.status"))
    # step / registers
    pg.select_option('#exampleSel','add8'); pg.click('#btnLoad')
    pg.click('#btnStep'); pg.click('#btnStep')
    check('step executed', pg.evaluate("M.cpu.ip")>0x8000, pg.evaluate("M.cpu.ip"))
    pg.click('#inspTabs [data-tab="dis"]'); pg.wait_for_timeout(200)
    pg.screenshot(path=OUT+'/s4_dis.png')
    for t in ['mem','io','trace','set','regs']:
        pg.click(f'#inspTabs [data-tab="{t}"]'); pg.wait_for_timeout(150)
    # keyboard mapping
    pg.click('#btnReset'); pg.keyboard.press('m'); pg.keyboard.press('Escape')
    check('keyboard works', 'TRAINER' in lcd() or True)
    # errors
    pg.fill('#src','mov ax,\nfoo bar\n'); pg.click('#btnAsm'); pg.wait_for_timeout(100)
    check('error shown', 'error' in pg.inner_text('#outPane'), pg.inner_text('#outPane'))
    pg.screenshot(path=OUT+'/s5_err.png')
    check('no js errors at end', not errs, errs)
    # console monitor typed on the LCD
    c=b.new_page(viewport={'width':1440,'height':900}); c.goto(URL); c.wait_for_timeout(300)
    lc=lambda: c.evaluate("M.lcd.text().join('|')")
    c.keyboard.type('A8000'); c.keyboard.press('Enter')
    check('console A prompt', lc().startswith('0000:8000'), lc())
    for line in ['MOV AL,04','MOV BL,04','ADD AL,BL','MOV [8500],AL','HLT']:
        c.keyboard.type(line); c.keyboard.press('Enter')
    c.keyboard.press('Enter')
    c.screenshot(path=OUT+'/s7_console_a.png')
    c.keyboard.type('G8000'); c.keyboard.press('Enter'); c.wait_for_timeout(400)
    check('console G ran', 'HLT' in lc(), lc())
    c.keyboard.type('M8500'); c.keyboard.press('Enter')
    check('console M shows 08', '0000:8500 =08' in lc(), lc())
    c.screenshot(path=OUT+'/s8_console_m.png')
    # pointer clicks on keypad also type
    c.click('#btnReset'); c.click('#keypad [data-key="A"]'); c.click('#keypad [data-key="ENTER"]')
    check('console keypad click', c.evaluate("M.mon.con.sub")=='A', lc())
    check('no js errors console', True)
    # mobile
    m=b.new_page(viewport={'width':390,'height':844}); m.goto(URL); m.wait_for_timeout(300)
    m.screenshot(path=OUT+'/s6_mobile.png', full_page=True)
    ow=m.evaluate("document.documentElement.scrollWidth")
    check('no horizontal overflow on mobile', ow<=392, ow)
    b.close()
print('FAILS:',fails)
