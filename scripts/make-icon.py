"""Create the small original application icon (standard library only)."""
import struct
from pathlib import Path
size = 32
pixels = bytearray()
for y in reversed(range(size)):
    for x in range(size):
        plane = (14 <= x <= 17 and 5 <= y <= 26) or (12 <= y <= 21 and abs(x - 15.5) <= (y - 10) * 1.2) or (24 <= y <= 27 and abs(x - 15.5) <= 4)
        pixels.extend((225, 235, 232, 255) if plane else (38, 31, 23, 255))
bitmap = struct.pack('<IIIHHIIIIII', 40, size, size*2, 1, 32, 0, len(pixels), 0, 0, 0, 0) + pixels + bytes(size * 4)
target = Path(__file__).resolve().parents[1] / 'src-tauri/icons/icon.ico'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(bitmap), 22) + bitmap)
