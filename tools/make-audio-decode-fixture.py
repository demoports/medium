#!/usr/bin/env python3
"""Generate sparse FFmpeg PCM references for the browser MP3 origin check."""
import array
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
result = {
    'origin': 'ffmpeg full-file MP3 decode; channel zero; samples distributed from 0.05 through 1.05 seconds',
    'sampleRates': {},
}
for rate in (44100, 48000):
    data = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(root / 'assets/medium.mp3'),
        '-t', '1.1', '-ar', str(rate), '-ac', '2', '-f', 'f32le', '-',
    ])
    pcm = array.array('f', data)
    import sys
    if sys.byteorder != 'little':
        pcm.byteswap()
    start, stride = int(rate * .05), round(rate / 512)
    result['sampleRates'][rate] = {
        'start': start, 'stride': stride,
        'channel0': [pcm[(start + i * stride) * 2] for i in range(512)],
    }
path = root / 'tests/fixtures/audio-decode.json'
path.write_text(json.dumps(result, indent=2) + '\n')
print(path)
