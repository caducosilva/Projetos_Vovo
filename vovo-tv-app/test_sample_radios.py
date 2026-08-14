import json
import urllib.request
import ssl
from concurrent.futures import ThreadPoolExecutor

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

with open(r"C:\Users\abobi\Downloads\vovo-tv-app\src\data\default_channels.json", "r", encoding="utf-8") as f:
    channels = json.load(f)

radios = [c for c in channels if c.get("isRadio") or "rádio" in c.get("group","").lower()]

print(f"Total radios in JSON: {len(radios)}")

def probe(r):
    url = r["url"]
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "*/*",
        "Range": "bytes=0-1024"
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=3.0) as resp:
            code = resp.getcode()
            data = resp.read(512)
            content_type = resp.headers.get("Content-Type", "")
            return (True, r["name"], url, code, content_type, len(data))
    except Exception as e:
        return (False, r["name"], url, str(e), "", 0)

with ThreadPoolExecutor(max_workers=30) as ex:
    results = list(ex.map(probe, radios[:50]))

ok_count = sum(1 for res in results if res[0])
print(f"Working radios in first 50 sample: {ok_count} / 50")
for ok, name, url, code, ctype, l in results[:15]:
    st = "OK" if ok else "FAIL"
    print(f"[{st}] {name} ({ctype}) -> {code}")
