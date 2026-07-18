#!/usr/bin/env python3
"""install-room-art.py — take a pipeline output directory to production scenes:
1. letterbox bars cropped off every room (see crop-bars.py logic),
2. rooms sharing an identical description share ONE painting (a classic Eamon
   maze is many rooms of identical text — the sameness is the puzzle),
3. result copied to public/scenes/<adventure-id>/room-N.png.

usage: python3 tools/install-room-art.py data/adventures/<id>.json
"""
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

manifest = json.load(open(sys.argv[1]))
adv = manifest['adventure']['id']
src_dir = Path(f'art-out/pipeline/{adv}')
dst_dir = Path(f'public/scenes/{adv}')
dst_dir.mkdir(parents=True, exist_ok=True)

report_path = Path(f'art-out/pipeline-report-{adv}.json')
verdicts = {}
if report_path.exists():
    for e in json.load(open(report_path)):
        verdicts[e['room']] = e.get('verdict', 'unknown')

groups = defaultdict(list)
for loc in manifest['locations']:
    groups[loc['narration_text'] or f"__{loc['room_number']}"].append(loc['room_number'])

installed = missing = 0
for text, rooms in groups.items():
    # Best source in the group: a passing paint wins; otherwise any existing file.
    candidates = [r for r in rooms if (src_dir / f'room-{r}.png').exists()]
    if not candidates:
        print(f'MISSING art for rooms {rooms}')
        missing += len(rooms)
        continue
    best = next((r for r in candidates if verdicts.get(r) == 'pass'), candidates[0])
    src = src_dir / f'room-{best}.png'
    primary = dst_dir / f'room-{best}.png'
    subprocess.run(['python3', 'tools/crop-bars.py', str(src), str(primary)], check=True)
    for r in rooms:
        if r != best:
            (dst_dir / f'room-{r}.png').write_bytes(primary.read_bytes())
    installed += len(rooms)
print(f'installed {installed} rooms ({len(groups)} distinct paintings), missing {missing}')
