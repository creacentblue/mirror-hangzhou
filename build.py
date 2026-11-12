#!/usr/bin/env python3
"""Build index.html: bundle three.js with esbuild, inline baked data and CSS.

Usage:  python3 build.py [--bake]
  --bake   rebuild data/area.json from data/osm.xml first
  To re-download OSM data, run: python3 tools/fetch_osm.py
"""
import os, shutil, subprocess, sys

D = os.path.dirname(os.path.abspath(__file__))
os.chdir(D)

if "--bake" in sys.argv:
    subprocess.check_call([sys.executable, "tools/bake.py"])

os.makedirs("build", exist_ok=True)

def find_esbuild():
    local = os.path.join(D, "node_modules", ".bin", "esbuild")
    if os.path.isfile(local):
        env = os.environ.copy()
        env["PATH"] = os.path.dirname(local) + os.pathsep + env.get("PATH", "")
        env["NODE_PATH"] = os.path.join(D, "node_modules")
        return [local], env
    exe = shutil.which("esbuild")
    if exe:
        return [exe], os.environ.copy()
    if shutil.which("npx"):
        return ["npx", "--yes", "esbuild"], os.environ.copy()
    sys.exit("esbuild not found. Install it (npm install esbuild) and retry.")

cmd, env = find_esbuild()
subprocess.check_call(
    cmd + [
        "src/main.js",
        "--bundle",
        "--minify",
        "--format=iife",
        "--target=es2019",
        "--outfile=build/bundle.js",
        "--log-level=warning",
    ],
    env=env,
)

js = open("build/bundle.js", encoding="utf-8").read().replace("</script", "<\\/script")
css = open("src/style.css", encoding="utf-8").read()
data = open("data/area.json", encoding="utf-8").read().replace("</", "<\\/")
html = (
    open("src/template.html", encoding="utf-8")
    .read()
    .replace("{{STYLE}}", css)
    .replace("{{DATA}}", data)
    .replace("{{SCRIPT}}", js)
)
open("index.html", "w", encoding="utf-8").write(html)
print("index.html", round(os.path.getsize("index.html") / 1024), "KB")
