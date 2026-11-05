#!/usr/bin/env python3
"""Builds preview.html — a standalone copy of the POS that runs in DEMO mode (no Google Sheet).
Usage: python3 tools/build-preview.py   then open preview.html in a browser."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'apps-script' / 'Index.html').read_text(encoding='utf-8')
qr = (root / 'apps-script' / 'QrImage.html').read_text(encoding='utf-8')
out = re.sub(r"<\?!=\s*include\('QrImage'\);?\s*\?>", lambda m: qr, src)
(root / 'preview.html').write_text(out, encoding='utf-8')
print('wrote', root / 'preview.html')
