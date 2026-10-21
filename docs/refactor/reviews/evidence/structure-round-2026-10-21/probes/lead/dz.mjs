// Decompress a DSH session.v4.jsonl.zstd (concatenated Zstandard frames) to stdout, frame by frame, with the frame
// scan of dsh-session-persistence-jsonl (scanZstdFrames). A torn final frame is skipped. (lead, 2026-10-21)
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
const buf = readFileSync(process.argv[2]);
const MAGIC = 4247762216;
let off = 0;
while (off + 4 <= buf.length) {
  const start = off;
  if (buf.readUInt32LE(off) !== MAGIC) throw new Error(`bad magic at ${off}`);
  off += 4;
  const d = buf.readUInt8(off); off += 1;
  const csFlag = d >>> 6, single = (d & 32) !== 0, checksum = (d & 4) !== 0, dict = d & 3;
  const dictBytes = dict === 3 ? 4 : dict;
  const csBytes = csFlag === 0 ? (single ? 1 : 0) : 1 << csFlag;
  off += (single ? 0 : 1) + dictBytes + csBytes;
  let torn = false;
  for (;;) {
    if (buf.length - off < 3) { torn = true; break; }
    const h = buf.readUIntLE(off, 3); off += 3;
    const last = (h & 1) !== 0, type = (h >>> 1) & 3, size = h >>> 3;
    off += type === 1 ? 1 : size;
    if (off > buf.length) { torn = true; break; }
    if (last) break;
  }
  if (torn) break;
  if (checksum) off += 4;
  if (off > buf.length) break;
  process.stdout.write(zstdDecompressSync(buf.subarray(start, off)));
}
