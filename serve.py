"""Petit serveur local pour PC TACTIQUE.

Sert le dossier du jeu en désactivant le cache : sans cela, le navigateur garde
d'anciens modules JavaScript en mémoire et les modifications ne prennent pas effet.
"""
import http.server, webbrowser, sys, threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass          # console silencieuse


# Serveur multi-thread : le navigateur charge la vingtaine de modules en parallèle,
# un serveur mono-thread se bloquerait.
http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as httpd:
    url = 'http://localhost:%d/index.html' % PORT
    print('PC TACTIQUE sur %s' % url)
    print('Fermez cette fenetre pour arreter le serveur.')
    threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
