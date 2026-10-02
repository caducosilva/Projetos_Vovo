"""Faz o papel do celular: acha a TV por SSDP e controla o receptor DLNA."""
import http.server
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from html import escape
from pathlib import Path

PASTA = Path(__file__).parent / "midia"
PC = "192.168.0.11"
PORTA_MIDIA = 8099
PORTA_EVENTO = 8098
ADB = ["adb", "-s", "192.168.0.12:5555"]
TIPOS = {".mp4": "video/mp4", ".mkv": "video/x-matroska", ".jpg": "image/jpeg", ".mp3": "audio/mpeg"}
CLASSE = {"video": "object.item.videoItem", "image": "object.item.imageItem", "audio": "object.item.audioItem.musicTrack"}
eventos = []
falhas = []


class Midia(http.server.BaseHTTPRequestHandler):
    """Servidor de arquivo com Range, como o de um app de celular."""

    def log_message(self, *a):
        pass

    def do_HEAD(self):
        self.do_GET(corpo=False)

    def do_GET(self, corpo=True):
        arq = PASTA / self.path.lstrip("/").split("?")[0]
        if not arq.is_file():
            self.send_error(404)
            return
        tam = arq.stat().st_size
        ini, fim = 0, tam - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m:
            ini = int(m.group(1) or 0)
            fim = int(m.group(2)) if m.group(2) else tam - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {ini}-{fim}/{tam}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", TIPOS.get(arq.suffix, "application/octet-stream"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(fim - ini + 1))
        self.end_headers()
        if not corpo:
            return
        with open(arq, "rb") as f:
            f.seek(ini)
            falta = fim - ini + 1
            try:
                while falta > 0:
                    b = f.read(min(65536, falta))
                    if not b:
                        break
                    self.wfile.write(b)
                    falta -= len(b)
            except (ConnectionError, OSError):
                pass


class Evento(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_NOTIFY(self):
        n = int(self.headers.get("Content-Length", 0))
        corpo = self.rfile.read(n).decode("utf-8", "replace")
        estado = re.search(r"TransportState val=&quot;(\w+)", corpo)
        eventos.append((time.strftime("%H:%M:%S"), self.headers.get("SEQ"), estado.group(1) if estado else "(outro)"))
        self.send_response(200)
        self.end_headers()


def servir(classe, porta):
    s = http.server.ThreadingHTTPServer(("0.0.0.0", porta), classe)
    threading.Thread(target=s.serve_forever, daemon=True).start()


def descobrir():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(PC))
    s.bind((PC, 0))
    s.settimeout(1)
    msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n"
           "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n").encode()
    achados = {}
    for _ in range(2):
        s.sendto(msg, ("239.255.255.250", 1900))
    fim = time.time() + 4
    while time.time() < fim:
        try:
            dado, quem = s.recvfrom(4096)
        except socket.timeout:
            continue
        loc = re.search(r"(?im)^location:\s*(\S+)", dado.decode("latin-1"))
        if loc:
            achados[loc.group(1)] = quem[0]
    return achados


def soap(base, servico, acao, args="", tipo=None):
    tipo = tipo or f"urn:schemas-upnp-org:service:{servico}:1"
    corpo = (f'<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
             f's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:{acao} xmlns:u="{tipo}">'
             f"<InstanceID>0</InstanceID>{args}</u:{acao}></s:Body></s:Envelope>").encode()
    req = urllib.request.Request(f"{base}/ctl/{servico}", data=corpo, method="POST", headers={
        "Content-Type": 'text/xml; charset="utf-8"', "SOAPACTION": f'"{tipo}#{acao}"'})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def campo(xml, nome):
    m = re.search(f"<{nome}>(.*?)</{nome}>", xml, re.S)
    return m.group(1) if m else None


def checar(cond, texto):
    print(("  OK   " if cond else "  FALHA ") + texto)
    if not cond:
        falhas.append(texto)


def assinar(base, servico):
    req = urllib.request.Request(f"{base}/evt/{servico}", method="SUBSCRIBE", headers={
        "CALLBACK": f"<http://{PC}:{PORTA_EVENTO}/ev>", "NT": "upnp:event", "TIMEOUT": "Second-1800"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.headers.get("SID")


def estado(base):
    return campo(soap(base, "AVTransport", "GetTransportInfo")[1], "CurrentTransportState")


def esperar(base, alvo, seg=20):
    fim = time.time() + seg
    while time.time() < fim:
        e = estado(base)
        if e == alvo:
            return True
        time.sleep(0.5)
    return False


def tela(nome):
    caminho = PASTA.parent / f"tela_{nome}.png"
    with open(caminho, "wb") as f:
        subprocess.run(ADB + ["exec-out", "screencap", "-p"], stdout=f, check=False)
    return caminho


def topo():
    out = subprocess.run(ADB + ["shell", "dumpsys", "activity", "activities"], capture_output=True, text=True).stdout
    m = re.search(r"mResumedActivity: .*? (\S+/\S+)", out)
    return m.group(1) if m else "?"


def mandar(base, arquivo, classe, titulo):
    url = f"http://{PC}:{PORTA_MIDIA}/{arquivo}"
    mime = TIPOS[Path(arquivo).suffix]
    didl = (f'<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            f'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="1" parentID="0" restricted="1">'
            f"<dc:title>{escape(titulo)}</dc:title><upnp:class>{CLASSE[classe]}</upnp:class>"
            f'<res protocolInfo="http-get:*:{mime}:*">{escape(url)}</res></item></DIDL-Lite>')
    st, r = soap(base, "AVTransport", "SetAVTransportURI",
                 f"<CurrentURI>{escape(url)}</CurrentURI><CurrentURIMetaData>{escape(didl)}</CurrentURIMetaData>")
    checar(st == 200, f"SetAVTransportURI {arquivo} -> HTTP {st}")
    st, _ = soap(base, "AVTransport", "Play", "<Speed>1</Speed>")
    checar(st == 200, f"Play -> HTTP {st}")


def main():
    servir(Midia, PORTA_MIDIA)
    servir(Evento, PORTA_EVENTO)

    print("== Busca SSDP (igual o celular faz)")
    achados = descobrir()
    for loc, ip in achados.items():
        print("   ", ip, loc)
    loc = next((l for l in achados if ":49494/" in l), None)
    checar(loc is not None, "TV da Vovo apareceu na busca MediaRenderer")
    if not loc:
        sys.exit(1)
    base = loc.rsplit("/", 1)[0]
    desc = urllib.request.urlopen(loc, timeout=5).read().decode()
    checar(campo(desc, "friendlyName") == "TV da Vovó", f"nome na rede: {campo(desc, 'friendlyName')}")
    for s in ("AVTransport", "RenderingControl", "ConnectionManager"):
        x = urllib.request.urlopen(f"{base}/{s}.xml", timeout=5).read().decode()
        checar("<actionList>" in x and x.count("<action>") >= 3, f"SCPD {s}: {x.count('<action>')} acoes")
    st, r = soap(base, "ConnectionManager", "GetProtocolInfo", tipo="urn:schemas-upnp-org:service:ConnectionManager:1")
    checar(st == 200 and "video/x-matroska" in (campo(r, "Sink") or ""), "GetProtocolInfo aceita MKV")

    sid = assinar(base, "AVTransport")
    checar(bool(sid), f"SUBSCRIBE AVTransport -> {sid}")
    time.sleep(1)
    checar(len(eventos) >= 1, f"evento inicial recebido: {eventos[:1]}")

    print("== Video MP4 1080p")
    mandar(base, "teste.mp4", "video", "Video de teste MP4")
    checar(esperar(base, "PLAYING"), f"tocando (estado {estado(base)})")
    checar("TocadorActivity" in topo(), f"tela na TV: {topo()}")
    time.sleep(4)
    pos = soap(base, "AVTransport", "GetPositionInfo")[1]
    rel, dur = campo(pos, "RelTime"), campo(pos, "TrackDuration")
    checar(rel not in (None, "0:00:00") and dur == "0:00:40", f"posicao {rel} de {dur}")
    print("    print:", tela("mp4"))
    soap(base, "AVTransport", "Pause")
    checar(esperar(base, "PAUSED_PLAYBACK", 5), "pausou")
    p1 = campo(soap(base, "AVTransport", "GetPositionInfo")[1], "RelTime")
    time.sleep(2)
    p2 = campo(soap(base, "AVTransport", "GetPositionInfo")[1], "RelTime")
    checar(p1 == p2, f"pausado de verdade (posicao parada em {p1} e {p2})")
    soap(base, "AVTransport", "Seek", "<Unit>REL_TIME</Unit><Target>0:00:25</Target>")
    soap(base, "AVTransport", "Play", "<Speed>1</Speed>")
    checar(esperar(base, "PLAYING", 5), "voltou a tocar")
    time.sleep(2)
    p3 = campo(soap(base, "AVTransport", "GetPositionInfo")[1], "RelTime")
    checar(p3 is not None and "0:00:25" <= p3 <= "0:00:29", f"avancou para 0:00:25 (agora {p3})")

    print("== Volume")
    v0 = campo(soap(base, "RenderingControl", "GetVolume", "<Channel>Master</Channel>")[1], "CurrentVolume")
    soap(base, "RenderingControl", "SetVolume", "<Channel>Master</Channel><DesiredVolume>7</DesiredVolume>")
    v1 = campo(soap(base, "RenderingControl", "GetVolume", "<Channel>Master</Channel>")[1], "CurrentVolume")
    checar(v1 is not None and abs(int(v1) - 7) <= 4, f"volume {v0} -> pedido 7 -> {v1}")
    soap(base, "RenderingControl", "SetVolume", f"<Channel>Master</Channel><DesiredVolume>{v0}</DesiredVolume>")
    v2 = campo(soap(base, "RenderingControl", "GetVolume", "<Channel>Master</Channel>")[1], "CurrentVolume")
    checar(v2 == v0, f"volume devolvido para {v0} (agora {v2})")

    print("== MKV com audio AC3 5.1 (o caso que o Chromecast sofre)")
    mandar(base, "teste_ac3.mkv", "video", "Filme MKV AC3")
    checar(esperar(base, "PLAYING"), f"tocando (estado {estado(base)})")
    time.sleep(4)
    rel = campo(soap(base, "AVTransport", "GetPositionInfo")[1], "RelTime")
    checar(rel not in (None, "0:00:00"), f"MKV andando: {rel}")
    print("    print:", tela("mkv"))

    print("== Foto 4000x3000")
    mandar(base, "teste.jpg", "image", "Foto de teste")
    checar(esperar(base, "PLAYING", 15), f"foto na tela (estado {estado(base)})")
    time.sleep(1)
    print("    print:", tela("foto"))

    print("== Musica MP3")
    mandar(base, "teste.mp3", "audio", "Musica de teste")
    checar(esperar(base, "PLAYING"), f"tocando (estado {estado(base)})")
    time.sleep(3)
    rel = campo(soap(base, "AVTransport", "GetPositionInfo")[1], "RelTime")
    checar(rel not in (None, "0:00:00"), f"musica andando: {rel}")
    print("    print:", tela("musica"))

    print("== Stop")
    soap(base, "AVTransport", "Stop")
    checar(esperar(base, "STOPPED", 5), f"parou (estado {estado(base)})")
    time.sleep(1.5)
    checar("inicio/.MainActivity" in topo(), f"TV voltou para o Inicio: {topo()}")

    time.sleep(1)
    estados = [e[2] for e in eventos]
    print("== Eventos recebidos:", estados)
    checar("PLAYING" in estados and "PAUSED_PLAYBACK" in estados and "STOPPED" in estados,
           "eventos de tocando/pausado/parado chegaram ao celular")

    print()
    print("RESULTADO:", "TUDO OK" if not falhas else f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
