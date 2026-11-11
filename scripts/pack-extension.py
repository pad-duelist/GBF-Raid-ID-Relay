"""extension/ フォルダを配布用zipにまとめる。

使い方（リポジトリ直下で）:
    python scripts/pack-extension.py

出力: public/downloads/gbf-raid-id-relay-extension.zip
拡張機能を更新したら実行し直してコミットしてください（/extension ページから配布されます）。
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "extension")
OUT_DIR = os.path.join(ROOT, "public", "downloads")
OUT = os.path.join(OUT_DIR, "gbf-raid-id-relay-extension.zip")
TOP = "gbf-raid-id-relay-extension"

os.makedirs(OUT_DIR, exist_ok=True)

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for base, dirs, files in os.walk(SRC):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(base, name)
            rel = os.path.relpath(full, SRC).replace(os.sep, "/")
            z.write(full, f"{TOP}/{rel}")
            count += 1

print(f"{count} files -> {OUT}")
