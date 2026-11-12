#!/usr/bin/env python3
"""把 OSM XML 烘焙成紧凑 JSON (data/area.json)。坐标 = 相对中心点的米(×10 取整, 即分米), x 向东, z 向南。"""
import xml.etree.ElementTree as ET, json, math, os, re, hashlib
LAT0, LON0, HALF = 30.2143, 120.2149, 816.0     # V0.2 中心 & 半边长(米) → 1584 m × 1584 m，覆盖区政府 + 星澜里
D = os.path.dirname(__file__)
R = 6378137.0
def proj(lat, lon):
    x = math.radians(lon - LON0) * R * math.cos(math.radians(LAT0))
    n = math.radians(lat - LAT0) * R
    return x, -n
root = ET.parse(os.path.join(D, "..", "data", "osm.xml")).getroot()
nodes = {n.get("id"): proj(float(n.get("lat")), float(n.get("lon"))) for n in root.findall("node")}
def tags(e): return {t.get("k"): t.get("v") for t in e.findall("tag")}
ways = {}
for w in root.findall("way"):
    ways[w.get("id")] = (tags(w), [nd.get("ref") for nd in w.findall("nd") if nd.get("ref") in nodes])
M = HALF + 40
def pts(refs): return [nodes[r] for r in refs]
def inbox(p):
    xs = [a for a, b in p]; zs = [b for a, b in p]
    return max(xs) > -M and min(xs) < M and max(zs) > -M and min(zs) < M
def flat(p): 
    out = []
    for x, z in p: out += [round(x * 10), round(z * 10)]
    return out
def area(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2
def num(s):
    if not s: return None
    m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", s.replace(",", "."))
    return float(m.group(1)) if m else None
def H(id_, salt=""): return int(hashlib.md5((str(id_) + salt).encode()).hexdigest()[:8], 16)

# ---------- 建筑 ----------
BT = {"apartments": 1, "residential": 1, "dormitory": 1, "house": 2, "detached": 2, "commercial": 3, "office": 3, "retail": 3, "hotel": 3,
      "hospital": 4, "school": 5, "kindergarten": 5, "university": 5, "public": 6, "government": 6, "civic": 6, "industrial": 7,
      "garage": 9, "garages": 9, "carport": 9, "parking": 9, "roof": 9, "service": 9, "shed": 9}
bnames_ok = lambda n: n and len(n) >= 3 and not re.search(r"垂梯|楼梯|电梯|号楼|^[A-Za-z0-9 ]+$", n)
buildings = []; est = 0
def add_building(id_, tg, rings):
    global est
    bt = tg.get("building") or ("yes" if "building:part" in tg else "yes")
    if bt == "yes" and "building:part" in tg and tg["building:part"] != "yes": bt = tg["building:part"]
    bt = bt.split(";")[0]
    if bt in ("train_station", "transportation"): return   # 地铁站/高架站房多半跨在路面上，略过以免挡路
    outer = rings[0]; A = area(outer)
    if A < 6: return
    code = BT.get(bt, 0)
    h = num(tg.get("height")); lv = num(tg.get("building:levels"))
    if h is None and lv: h = lv * 3.0 + 1.5
    flag = 0
    if h is None:
        flag = 1; est += 1; r = H(id_)
        if bt in ("apartments", "residential", "dormitory") and A > 400: h = 3.0 * (12 + r % 17)
        elif bt in ("commercial", "office", "retail", "hotel"): h = 3.0 * (8 + r % 15)
        elif bt == "hospital": h = 3.0 * (6 + r % 7)
        elif bt in ("school", "kindergarten", "university"): h = 3.0 * (3 + r % 3)
        elif bt in ("garage", "garages", "carport", "shed", "roof", "service", "parking"): h = 3.0 + (r % 2) * 1.5
        elif bt in ("train_station", "transportation"): h = 3.0 * (2 + r % 3)
        elif bt in ("house", "detached"): h = 3.0 * (2 + r % 3)
        else:
            h = 3.5 if A < 80 else 3.0 * (2 + r % 3) if A < 300 else 3.0 * (6 + r % 11)
    nm = tg.get("name", "")
    buildings.append([round(h * 10), code, flag, nm if bnames_ok(nm) else "", [flat(r) for r in rings]])

for wid, (tg, refs) in ways.items():
    if ("building" in tg or "building:part" in tg) and len(refs) >= 4 and refs[0] == refs[-1]:
        p = pts(refs)
        if inbox(p): add_building(wid, tg, [p])
for r in root.findall("relation"):
    tg = tags(r)
    if "building" in tg and tg.get("type") == "multipolygon":
        outs, ins = [], []
        for m in r.findall("member"):
            if m.get("type") == "way" and m.get("ref") in ways:
                rr = ways[m.get("ref")][1]
                if len(rr) >= 4 and rr[0] == rr[-1]: (ins if m.get("role") == "inner" else outs).append(pts(rr))
        if outs and inbox(outs[0]): add_building(r.get("id"), tg, [outs[0]] + ins)

# ---------- 道路 ----------
WID = {"motorway": 16, "trunk": 16, "primary": 15, "secondary": 12, "tertiary": 9, "unclassified": 7, "residential": 7, "living_street": 6,
       "service": 5, "pedestrian": 4, "footway": 2, "cycleway": 2.5, "path": 1.8, "steps": 2, "track": 3.5, "road": 6}
CLS = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3, "unclassified": 4, "residential": 4, "living_street": 4, "road": 4,
       "service": 5, "pedestrian": 6, "footway": 7, "cycleway": 7, "path": 7, "steps": 7, "track": 5}
roads = []
for wid, (tg, refs) in ways.items():
    hw = tg.get("highway")
    if hw not in WID or len(refs) < 2: continue
    if tg.get("tunnel") in ("yes", "building_passage", "culvert") or tg.get("covered") == "yes" or (num(tg.get("layer")) or 0) < 0: continue
    if tg.get("area") == "yes": continue
    p = pts(refs)
    if not inbox(p): continue
    w = num(tg.get("width")) or ((num(tg.get("lanes")) or 0) * 3.4 if tg.get("lanes") and hw not in ("footway", "path", "cycleway", "steps") else 0) or WID[hw]
    w = max(1.2, min(w, 40))
    roads.append([CLS[hw], round(w * 10), 1 if tg.get("bridge") == "yes" else 0, tg.get("name", ""), flat(p), 1 if tg.get("oneway") == "yes" else 0])

# ---------- 水 / 绿地 / 其他地面 ----------
GK = {"grass": 1, "park": 1, "garden": 1, "village_green": 1, "meadow": 1, "recreation_ground": 1, "forest": 2, "wood": 2, "scrub": 2,
      "pitch": 3, "sports_centre": 3, "playground": 3, "track": 3, "construction": 4, "brownfield": 4, "parking": 5, "residential": 6,
      "commercial": 7, "industrial": 7, "retail": 7}
water = []; ground = []
def ring_ok(refs): return len(refs) >= 4 and refs[0] == refs[-1]
for wid, (tg, refs) in ways.items():
    if tg.get("natural") == "water" and ring_ok(refs):
        p = pts(refs)
        if inbox(p): water.append([flat(p)])
    k = None
    for key in ("leisure", "landuse", "natural", "amenity"):
        v = tg.get(key)
        if v in GK and v != "water" and not (key == "amenity" and v != "parking"): k = GK[v]; break
    if k and ring_ok(refs) and "building" not in tg:
        p = pts(refs)
        if inbox(p): ground.append([k, flat(p)])
for r in root.findall("relation"):
    tg = tags(r)
    if tg.get("natural") == "water":
        rings = []
        for m in r.findall("member"):
            if m.get("type") == "way" and m.get("ref") in ways and ring_ok(ways[m.get("ref")][1]): rings.append(flat(pts(ways[m.get("ref")][1])))
        if rings: water.append(rings)
WLW = {"river": 18, "canal": 12, "stream": 4, "ditch": 2, "drain": 2}
wlines = []
for wid, (tg, refs) in ways.items():
    ww = tg.get("waterway")
    if ww in WLW and len(refs) >= 2 and tg.get("tunnel") not in ("yes", "culvert") and (num(tg.get("layer")) or 0) >= 0:
        p = pts(refs)
        if inbox(p): wlines.append([round((num(tg.get("width")) or WLW[ww]) * 10), flat(p)])

trees = []
for n in root.findall("node"):
    if tags(n).get("natural") == "tree":
        x, z = proj(float(n.get("lat")), float(n.get("lon")))
        if abs(x) < M and abs(z) < M: trees += [round(x * 10), round(z * 10)]

# 人工地标（OSM 未收录「星澜里」这个名字）。坐标来自租赁页面 / 高德，不是 OSM 几何。
landmarks = []
for nm, la, lo in (("星澜里", 30.2155, 120.2220), ("星澜之城", 30.2145, 120.2230)):
    x, z = proj(la, lo)
    if abs(x) < M and abs(z) < M:
        landmarks.append([nm, round(x * 10), round(z * 10)])

meta = json.load(open(os.path.join(D, "..", "data", "osm.xml.meta.json")))
out = {"v": 2, "c": [LAT0, LON0], "half": HALF, "b": buildings, "r": roads, "w": water, "wl": wlines, "g": ground, "t": trees,
       "lm": landmarks,
       "meta": {"source": meta["source"], "fetched": meta["fetched"], "estimatedHeights": est,
                "centerNote": "V0.2: 30.2143N 120.2146E, half=792m, includes 滨江区政府 and 星澜里/西兴路2333"}}
s = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
open(os.path.join(D, "..", "data", "area.json"), "w", encoding="utf-8").write(s)
hs = sorted(b[0] / 10 for b in buildings)
print(f"center={LAT0},{LON0} half={HALF}m")
print(f"buildings={len(buildings)} (estimated height: {est}) roads={len(roads)} water polys={len(water)} water lines={len(wlines)} green/ground={len(ground)} trees={len(trees)//2} landmarks={landmarks}")
print("json bytes", len(s.encode()), "heights m: median", hs[len(hs)//2] if hs else None, "max", hs[-1] if hs else None, "p95", hs[int(len(hs)*.95)] if hs else None)
# 关键点是否在范围内
for nm, la, lo in (("滨江区政府", 30.2109, 120.2071), ("星澜里", 30.2155, 120.2220), ("星澜之城", 30.2145, 120.2230), ("Xinglan OSM cafe", 30.21727, 120.21776), ("丹枫/西兴交叉口", 30.21873, 120.21691)):
    x, z = proj(la, lo)
    print(f"  {nm}: x={x:.0f}m z={z:.0f}m inside={abs(x)<HALF and abs(z)<HALF}")
