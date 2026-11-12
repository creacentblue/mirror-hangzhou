#!/usr/bin/env python3
"""下载 OSM 数据：先试 Overpass 镜像，全部失败则回退到 OSM 官方 /map API（同一份 OSM 数据）。
输出 data/osm.xml
V0.2 范围：覆盖滨江区政府一带 + 星澜里 / 西兴路 2333 号（约 30.2155N, 120.222E）。"""
import urllib.request, urllib.parse, time, os, json
S, W, N, E = 30.2060, 120.2055, 30.2220, 120.2240   # 比游戏范围略大一圈
UA = "FaustusStudio-MirrorEarth/0.2 (offline prototype baker)"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "osm.xml")
Q = f"""[out:xml][timeout:90];
(way["building"]({S},{W},{N},{E});way["building:part"]({S},{W},{N},{E});way["highway"]({S},{W},{N},{E});
way["natural"~"water|wood|scrub"]({S},{W},{N},{E});way["waterway"]({S},{W},{N},{E});
way["leisure"]({S},{W},{N},{E});way["landuse"]({S},{W},{N},{E});way["amenity"="parking"]({S},{W},{N},{E});
relation["building"]({S},{W},{N},{E});relation["natural"="water"]({S},{W},{N},{E});
node["natural"="tree"]({S},{W},{N},{E}););(._;>;);out;"""
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
def try_overpass():
    for m in MIRRORS:
        try:
            print("Overpass:", m, flush=True)
            req = urllib.request.Request(m, data=urllib.parse.urlencode({"data": Q}).encode(), headers={"User-Agent": UA})
            d = urllib.request.urlopen(req, timeout=40).read()
            if d.startswith(b"<?xml") and b"<way" in d:
                print("  OK", len(d)); return d, m
        except Exception as e:
            print("  fail:", type(e).__name__, str(e)[:80], flush=True)
    return None, None
def try_api():
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={W},{S},{E},{N}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    d = urllib.request.urlopen(req, timeout=90).read()
    print("OSM API OK", len(d)); return d, "api.openstreetmap.org/api/0.6/map"
if __name__ == "__main__":
    d, src = try_overpass()
    if not d: d, src = try_api()
    open(OUT, "wb").write(d)
    json.dump({"source": src, "fetched": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "bbox": [S, W, N, E],
               "note": "V0.2 recenter: include 星澜里 / 西兴路2333 and civic area"},
              open(OUT + ".meta.json", "w"), ensure_ascii=False)
    print("saved", OUT, "via", src)
