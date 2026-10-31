"""Import genuine browser captures; crop/compress only, never redraw the UI."""
from pathlib import Path
import hashlib
import json
import shutil
import sys
from PIL import Image
from live_screens import EXAMPLES

ROOT = Path(__file__).resolve().parent
SOURCE = Path(sys.argv[1]).resolve()
DEST = ROOT / 'screenshots/live-20261030'
DEST.mkdir(parents=True, exist_ok=True)
entries = []
for screen in EXAMPLES.values():
    for shot in screen['shots']:
        source = SOURCE / shot['file']
        original = DEST / shot['file']
        shutil.copy2(source, original)
        crop = shot['crop']
        with Image.open(original) as im:
            assert 0 <= crop[0] < crop[2] <= im.width and 0 <= crop[1] < crop[3] <= im.height
            cropped = im.crop(crop)
            asset = DEST / ('crop-' + shot['file'])
            cropped.save(asset, 'JPEG', quality=90, optimize=True)
        entries.append(dict(file=shot['file'], crop=crop, marks=shot['marks'],
            asset='live-20261030/' + asset.name, sha256=hashlib.sha256(asset.read_bytes()).hexdigest(),
            original='live-20261030/' + original.name, originalSha256=hashlib.sha256(original.read_bytes()).hexdigest(),
            captureDate='2026-10-30', kind='actual-mobile-screenshot',
            topic=screen['n'], dataset='mydancr-manual-captures-20261030',
            origin='https://www.mydancr.com/dashboard/venue'))
(ROOT / 'screenshots/live-manifest.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
print(json.dumps(dict(captures=len(entries), screenshots=len({x['file'] for x in entries}))))
