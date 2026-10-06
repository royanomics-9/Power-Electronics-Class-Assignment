"""Drives the real page in headless Chromium and checks that every control does what it says.
Run:  python3 tests/ui_test.py"""
import http.server, threading, socketserver, functools, os, sys, re, json
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{port}/index.html'
passed=0; failed=[]
def ok(name,cond,extra=''):
    global passed
    if cond: passed+=1
    else: failed.append(name+(' :: '+str(extra) if extra!='' else ''))

with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':1000},accept_downloads=True,permissions=['clipboard-read','clipboard-write'])
    pg=ctx.new_page(); errs=[]
    pg.on('console',lambda m: errs.append(m.text) if m.type in('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(URL); pg.wait_for_timeout(600)
    S=lambda: pg.evaluate('({s:window.RL.app.state, m:window.RL.app.res.metrics, key:window.RL.app.res.def.key})')
    num=lambda sel: float(pg.input_value(sel))
    def settle(): pg.wait_for_timeout(200)
    def metric(k): return pg.evaluate(f'window.RL.app.res.metrics.{k}')

    # --- circuit matrix: all eight
    titles={}
    for ph in ('1','3'):
        for t in ('HW','FW','DBR','TCR'):
            pg.click(f'#cm-{ph}-{t}'); settle()
            st=S(); ok(f'matrix {ph}{t} state', st['key']==f'{ph}ph-{t}', st['key'])
            ok(f'matrix {ph}{t} pressed', pg.get_attribute(f'#cm-{ph}-{t}','aria-pressed')=='true')
            ttl=pg.inner_text('#schem-title'); titles[ph+t]=ttl
            nsvg=pg.evaluate("document.querySelectorAll('#schem svg .c[data-id]').length")
            ok(f'matrix {ph}{t} schematic drawn', nsvg>3, nsvg)
            ok(f'matrix {ph}{t} results filled', 'Average voltage' in pg.inner_text('#results'))
            ndev=len(pg.evaluate('window.RL.app.res.def.devices'))
            ok(f'matrix {ph}{t} gantt rows', ndev == {'1HW':1,'1FW':2,'1DBR':4,'1TCR':4,'3HW':3,'3FW':6,'3DBR':6,'3TCR':6}[ph+t])
    ok('eight distinct titles', len(set(titles.values()))==8, titles)

    # --- device type toggle (HW/FW) and alpha availability
    pg.click('#cm-1-HW'); settle()
    ok('HW default diode: alpha disabled', pg.is_disabled('#in-alpha') and pg.is_disabled('#rg-alpha'))
    ok('HW diode: device buttons enabled', not pg.is_disabled('#dev-scr'))
    pg.click('#dev-scr'); settle()
    ok('HW thyristor: alpha enabled', not pg.is_disabled('#in-alpha'))
    ok('HW thyristor: schematic shows T1', pg.evaluate("!!document.querySelector('#schem .c[data-id=T1]')"))
    pg.click('#dev-diode'); settle()
    ok('HW diode again: D1', pg.evaluate("!!document.querySelector('#schem .c[data-id=D1]')"))
    pg.click('#cm-1-DBR'); settle()
    ok('DBR: device buttons locked', pg.is_disabled('#dev-scr') and pg.is_disabled('#dev-diode'))
    ok('DBR: alpha locked', pg.is_disabled('#in-alpha'))
    pg.click('#cm-1-TCR'); settle()
    ok('TCR: alpha enabled', not pg.is_disabled('#in-alpha') and not pg.is_disabled('#rg-alpha'))

    # --- numeric inputs and sliders drive the model
    pg.click('#btn-defaults'); settle()
    st=S()['s']; ok('defaults restored', st['Vrms']==230 and st['alpha']==45 and st['topo']=='TCR', st)
    pg.click('#cm-1-TCR'); pg.check('#chk-Linf'); settle()
    v0=metric('Vavg')
    pg.fill('#in-alpha','60'); settle()
    v60=metric('Vavg'); import math
    ok('alpha box: Vavg = (2Vm/π)cosα', abs(v60-2*230*math.sqrt(2)/math.pi*math.cos(math.radians(60)))<0.5, v60)
    ok('alpha box syncs slider', abs(num('#rg-alpha')-60)<1e-9)
    pg.evaluate("const r=document.getElementById('rg-alpha'); r.value=30; r.dispatchEvent(new Event('input',{bubbles:true}))"); settle()
    ok('alpha slider syncs box', abs(num('#in-alpha')-30)<1e-9)
    ok('alpha slider drives model', abs(metric('Vavg')-2*230*math.sqrt(2)/math.pi*math.cos(math.radians(30)))<0.5)
    pg.fill('#in-V','115'); settle()
    ok('Vs box: Vavg halves', abs(metric('Vavg')-2*115*math.sqrt(2)/math.pi*math.cos(math.radians(30)))<0.5, metric('Vavg'))
    ok('Vs hint updates', '162.6' in pg.inner_text('#v-hint'), pg.inner_text('#v-hint'))
    pg.evaluate("const r=document.getElementById('rg-V'); r.value=230; r.dispatchEvent(new Event('input',{bubbles:true}))"); settle()
    ok('Vs slider -> box', num('#in-V')==230)
    pg.click('#f60'); settle(); ok('60 Hz button', S()['s']['f']==60 and num('#in-f')==60 and pg.get_attribute('#f60','aria-pressed')=='true')
    pg.click('#f50'); settle(); ok('50 Hz button', S()['s']['f']==50)
    pg.fill('#in-f','400'); settle(); ok('freq box 400', S()['s']['f']==400); pg.click('#f50'); settle()
    pg.uncheck('#chk-Linf'); settle()
    ok('Linf off enables L box', not pg.is_disabled('#in-L'))
    pg.fill('#in-R','10'); pg.fill('#in-L','0'); pg.fill('#in-E','0'); settle()
    # resistive load, alpha 30, 1ph TCR -> Vm(1+cosα)/π
    ok('R,L,E boxes: resistive TCR Vavg', abs(metric('Vavg')-230*math.sqrt(2)*(1+math.cos(math.radians(30)))/math.pi)<0.5, metric('Vavg'))
    ok('R box drives Iavg', abs(metric('Iavg')-metric('Vavg')/10)<0.02)
    pg.evaluate("const r=document.getElementById('rg-R'); r.value=40; r.dispatchEvent(new Event('input',{bubbles:true}))"); settle()
    ok('R slider drives Iavg', abs(metric('Iavg')-metric('Vavg')/40)<0.02 and num('#in-R')==40)
    pg.evaluate("const r=document.getElementById('rg-L'); r.value=100; r.dispatchEvent(new Event('input',{bubbles:true}))"); settle()
    ok('L slider -> box and schematic label', num('#in-L')==100 and 'L = 100 mH' in pg.inner_text('#schem'))
    pg.evaluate("const r=document.getElementById('rg-E'); r.value=50; r.dispatchEvent(new Event('input',{bubbles:true}))"); settle()
    ok('E slider -> box and schematic battery', num('#in-E')==50 and pg.evaluate("!!document.querySelector('#schem .c[data-id=E]')"))
    pg.fill('#in-E','0'); settle(); ok('E=0 removes battery symbol', pg.evaluate("!document.querySelector('#schem .c[data-id=E]')"))
    pg.check('#chk-Linf'); settle(); ok('Linf label on schematic', '∞' in pg.inner_text('#schem') and pg.is_disabled('#in-L'))
    pg.uncheck('#chk-Linf'); settle()

    # --- freewheeling diode
    ok('FWD absent initially', pg.evaluate("!document.querySelector('#schem .c[data-id=DF]')"))
    pg.check('#chk-fwd'); settle()
    ok('FWD appears in schematic', pg.evaluate("!!document.querySelector('#schem .c[data-id=DF]')"))
    opts=pg.evaluate("[...document.querySelectorAll('#sel-dev option')].map(o=>o.value)")
    ok('FWD in device list', 'DF' in opts, opts)
    pg.select_option('#sel-dev','DF'); settle()
    ok('device panel switches to DF', 'DF' in pg.inner_text('#ttl-vdev'))
    ok('results show device DF', 'Device DF' in pg.inner_text('#results'))
    pg.uncheck('#chk-fwd'); settle()
    ok('FWD removed, device select resets', pg.input_value('#sel-dev')!='DF')

    # --- presets
    pg.click('#cm-3-TCR'); settle()
    for pid in ['r','rl','linf','rle','dcm','fwd','neg']:
        pg.click(f'#preset-{pid}'); settle()
        ok(f'preset {pid} pressed', pg.get_attribute(f'#preset-{pid}','aria-pressed')=='true')
    s=S()['s']; ok('last preset applied values', s['alpha']==120 and s['Linf'] is True, s)
    ok('negative-average preset gives Vavg<0', metric('Vavg')<0)
    pg.click('#cm-1-DBR'); settle()
    ok('alpha presets disabled on DBR', pg.is_disabled('#preset-dcm') and pg.is_disabled('#preset-neg') and not pg.is_disabled('#preset-r'))
    pg.click('#cm-1-HW'); settle(); pg.click('#preset-dcm'); settle()
    ok('alpha preset on HW switches to thyristor', S()['s']['device']=='scr' and pg.evaluate("!!document.querySelector('#schem .c[data-id=T1]')"))

    # --- transport
    pg.click('#cm-1-TCR'); settle()
    pg.click('#btn-defaults'); settle()
    st0=pg.inner_text('#btn-play')
    if st0=='Pause': pg.click('#btn-play')
    pg.click('#btn-reset-theta'); settle()
    th=lambda: float(pg.inner_text('#out-theta').replace('°',''))
    ok('reset to 0°', th()<0.1, th())
    pg.click('#btn-next'); settle(); ok('step forward 5°', abs(th()-5)<0.2, th())
    pg.click('#btn-next'); pg.click('#btn-next'); settle(); ok('step x3', abs(th()-15)<0.3, th())
    pg.click('#btn-prev'); settle(); ok('step back', abs(th()-10)<0.3, th())
    pg.evaluate("const r=document.getElementById('rg-theta'); r.value=200; r.dispatchEvent(new Event('input',{bubbles:true}))"); settle()
    ok('scrubber moves cursor', abs(th()-200)<0.2, th())
    pg.click('#btn-play'); pg.wait_for_timeout(700)
    ok('play button label', pg.inner_text('#btn-play')=='Pause')
    t1=th(); pg.wait_for_timeout(400); t2=th()
    ok('animation advances', t1!=t2, (t1,t2))
    pg.evaluate("const r=document.getElementById('rg-speed'); r.value=4; r.dispatchEvent(new Event('input',{bubbles:true}))")
    ok('speed label', pg.inner_text('#out-speed')=='4×')
    a=th(); pg.wait_for_timeout(300); b2=th(); fast=(b2-a)%360
    pg.evaluate("const r=document.getElementById('rg-speed'); r.value=1; r.dispatchEvent(new Event('input',{bubbles:true}))")
    a=th(); pg.wait_for_timeout(300); b3=th(); slow=(b3-a)%360
    ok('speed 4x faster than 1x', fast>slow*2, (fast,slow))
    pg.click('#btn-play'); settle()
    ok('pause stops', (lambda x,y:(x==y))(th(), (pg.wait_for_timeout(300), th())[1]))
    ok('paused class', pg.evaluate("document.body.classList.contains('paused')"))
    pg.keyboard.press('Space'); pg.wait_for_timeout(300); ok('space plays', pg.inner_text('#btn-play')=='Pause')
    pg.keyboard.press('Space'); settle(); ok('space pauses', pg.inner_text('#btn-play')=='Play')
    t=th(); pg.keyboard.press('ArrowRight'); settle(); ok('arrow right steps', abs(((th()-t)+360)%360-5)<0.3)

    # --- schematic follows the cursor
    pg.click('#cm-3-DBR'); pg.click('#btn-reset-theta'); settle()
    def on_devs(): return pg.evaluate("[...document.querySelectorAll('#schem .c.on')].map(e=>e.dataset.id).filter(i=>/^[DT]/.test(i)).sort().join(',')")
    exp={45:'D1,D6',100:'D1,D2',160:'D2,D3',220:'D3,D4',280:'D4,D5',340:'D5,D6'}
    for ang,want in exp.items():
        pg.evaluate(f"const r=document.getElementById('rg-theta'); r.value={ang}; r.dispatchEvent(new Event('input',{{bubbles:true}}))"); settle()
        ok(f'3φ DBR at {ang}° conducting {want}', on_devs()==want, on_devs())
        ok(f'3φ DBR at {ang}° mode pill', want.split(',')[0] in pg.inner_text('#mode-pill'))
    nflow=pg.evaluate("document.querySelectorAll('#schem .flow .dash').length"); ok('current path overlay drawn', nflow>5, nflow)

    # --- clicking / hovering waveforms
    pg.click('#btn-reset-theta')
    pg.locator('#cv-vo').scroll_into_view_if_needed(); pg.wait_for_timeout(200); box=pg.locator('#cv-vo').bounding_box()
    pg.mouse.click(box['x']+box['width']*0.5, box['y']+60); settle()
    ok('click on waveform moves cursor to clicked angle', abs(th() - ((box['width']*0.5-58)/(box['width']-70)*360))<6, th())
    pg.mouse.move(box['x']+box['width']*0.25, box['y']+60); settle()
    ok('hover readout shows hovered value', 'vo' in pg.inner_text('#rd-vo'))
    pg.mouse.move(5,5)
    pg.mouse.move(box['x']+box['width']*0.2, box['y']+60); pg.mouse.down(); pg.mouse.move(box['x']+box['width']*0.7, box['y']+60, steps=5); pg.mouse.up(); settle()
    ok('drag scrubs cursor', 230<th()<290, th())

    # --- panel chips
    for pid in ['supply','vo','io','is','idev','vdev','gantt']:
        pg.click(f'#chip-{pid}'); settle()
        ok(f'chip hides {pid}', pg.evaluate(f"document.getElementById('pnl-{pid}').hidden"))
        pg.click(f'#chip-{pid}'); settle()
        ok(f'chip shows {pid}', pg.evaluate(f"!document.getElementById('pnl-{pid}').hidden"))

    # --- tabs
    for tab,pane in [('theory','theory'),('checks','checks'),('spectrum','spectrum')]:
        pg.click(f'#tab-{tab}'); settle()
        ok(f'tab {tab} shows pane', pg.evaluate(f"!document.getElementById('pane-{pane}').hidden"))
        ok(f'tab {tab} aria-selected', pg.get_attribute(f'#tab-{tab}','aria-selected')=='true')
    pg.click('#tab-checks'); settle()
    txt=pg.inner_text('#checks'); ok('all live checks pass', '✗' not in txt, txt)
    ok('checks contain schematic check', 'Schematic matches' in txt)
    pg.click('#tab-theory'); settle(); ok('theory has formulas', 'Peak inverse voltage' in pg.inner_text('#theory'))
    pg.click('#tab-spectrum'); settle()
    pg.locator('#cv-spec-is').scroll_into_view_if_needed(); pg.wait_for_timeout(200); sb=pg.locator('#cv-spec-is').bounding_box(); pg.mouse.move(sb['x']+sb['width']*0.08, sb['y']+100); settle()
    ok('spectrum hover readout', 'Hz' in pg.inner_text('#spec-is-read') or 'DC' in pg.inner_text('#spec-is-read'), pg.inner_text('#spec-is-read'))

    # --- theme
    pg.click('#btn-theme'); settle(); dark=pg.evaluate("document.documentElement.dataset.theme")
    ok('theme toggles', dark in ('dark','light'))
    bg1=pg.evaluate("getComputedStyle(document.body).backgroundColor")
    pg.click('#btn-theme'); settle(); bg2=pg.evaluate("getComputedStyle(document.body).backgroundColor")
    ok('theme changes colours', bg1!=bg2, (bg1,bg2))

    # --- exports
    pg.click('#export-menu summary'); settle()
    with pg.expect_download() as d: pg.click('#btn-csv')
    path=d.value.path(); txt=open(path).read().splitlines()
    ok('csv rows', len(txt)>1400 and txt[1].startswith('theta_deg,time_ms'), (len(txt), txt[1][:60]))
    ok('csv numeric', len(txt[5].split(','))==len(txt[1].split(',')))
    with pg.expect_download() as d: pg.click('#btn-svg')
    svg=open(d.value.path()).read(); ok('svg export', svg.startswith('<svg') and 'viewBox' in svg and '<style>' in svg and 'NaN' not in svg)
    with pg.expect_download() as d: pg.click('#btn-png')
    data=open(d.value.path(),'rb').read(); ok('png export', data[:8]==b'\x89PNG\r\n\x1a\n' and len(data)>20000, len(data))
    pg.click('#btn-link'); pg.wait_for_timeout(300)
    clip=pg.evaluate("navigator.clipboard.readText()"); ok('copy link', 'index.html#' in clip and 'p=3' in clip, clip)
    ok('copy link toast', 'copied' in pg.inner_text('#toast'))

    # --- URL state round trip
    pg.goto(URL+'#p=3&t=TCR&d=scr&V=400&f=60&a=75&R=12&L=30&Li=0&E=40&F=1'); pg.reload(); pg.wait_for_timeout(600)
    s=S()['s']; ok('hash restores state', (s['phases'],s['topo'],s['Vrms'],s['f'],s['alpha'],s['R'],s['Lmh'],s['E'],s['fwd'])==(3,'TCR',400,60,75,12,30,40,True), s)
    ok('hash restores controls', num('#in-V')==400 and pg.is_checked('#chk-fwd'))
    pg.goto(URL+'#p=9&t=XX&V=abc&a=999'); pg.reload(); pg.wait_for_timeout(500)
    s=S()['s']; ok('bad hash falls back safely', s['phases'] in (1,3) and s['alpha']<=180, s)

    # --- warnings
    pg.goto(URL+'#p=1&t=TCR&d=scr&V=230&f=50&a=120&R=20&L=0&Li=1&E=300&F=0'); pg.reload(); pg.wait_for_timeout(600)
    ok('impossible load raises a visible warning', not pg.evaluate("document.getElementById('warn').hidden"), pg.inner_text('#warn'))

    # --- responsive layouts
    for w in (1100, 760, 390):
        pg.set_viewport_size({'width':w,'height':900}); pg.wait_for_timeout(400)
        sw=pg.evaluate("document.documentElement.scrollWidth"); ok(f'no horizontal overflow at {w}px', sw<=w+1, sw)
    ok('no console errors', not errs, errs)
    b.close()
print(f'UI checks: {passed} passed, {len(failed)} failed')
for f in failed[:50]: print('  FAIL',f)
sys.exit(1 if failed else 0)
