import sys, http.server, threading, socketserver, functools, os
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
circuits=[('1','HW','scr'),('1','FW','scr'),('1','DBR','diode'),('1','TCR','scr'),('3','HW','scr'),('3','FW','scr'),('3','DBR','diode'),('3','TCR','scr')]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1500,'height':1000})
    errs=[]
    pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror',lambda e: errs.append('PAGEERROR: '+str(e)))
    for ph,t,d in circuits:
        h=f'#p={ph}&t={t}&d={d}&V=230&f=50&a=30&R=20&L=45&Li=0&E=0&F={1 if t in ("HW","FW") else 0}'
        pg.goto(f'http://127.0.0.1:{port}/index.html'+h); pg.reload(); pg.wait_for_timeout(500)
        if pg.inner_text('#btn-play')=='Pause': pg.click('#btn-play')
        pg.evaluate("document.getElementById('rg-theta').value=120; document.getElementById('rg-theta').dispatchEvent(new Event('input'))")
        pg.wait_for_timeout(250)
        pg.locator('.schem').screenshot(path=f'{ROOT}/tests/shots/sch_{ph}{t}.png')
    print('errors',errs)
    b.close()
