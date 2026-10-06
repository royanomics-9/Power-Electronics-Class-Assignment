import sys, http.server, threading, socketserver, functools, os
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(Handler.func):
    def log_message(self,*a): pass
Handler=functools.partial(Q, directory=ROOT)
srv=socketserver.TCPServer(('127.0.0.1',0),Handler); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
hash_=sys.argv[1] if len(sys.argv)>1 else ''
out=sys.argv[2] if len(sys.argv)>2 else 'tests/shots/a.png'
w=int(sys.argv[3]) if len(sys.argv)>3 else 1500
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':w,'height':1000})
    errs=[]
    pg.on('console',lambda m: errs.append(m.type+': '+m.text) if m.type in('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append('PAGEERROR: '+str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html'+hash_); pg.wait_for_timeout(800)
    pg.click('#btn-play') if pg.inner_text('#btn-play')=='Pause' else None
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(ROOT,out),full_page=True)
    print('errors:',errs)
    b.close()
