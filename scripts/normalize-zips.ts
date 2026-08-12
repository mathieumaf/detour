/**
 * Re-pack WXT store zips so every entry has a valid DOS date.
 *
 * WXT 0.21 switched from jszip to @aklinker1/zero-zip, which writes
 * last-mod time/date as 0x0000. Decoded that is 1980-00-00 (month=0, day=0),
 * which is invalid per APPNOTE. AMO then rejects the upload as
 * "Unsupported file type" / "Upload is not valid" even though CRC and
 * `unzip -t` pass.
 *
 * Run after `wxt zip` / `wxt zip -b firefox`. Rewrites matching zips in
 * `.output/` in place; paths and uncompressed contents are preserved.
 */
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const OUTPUT_DIR = ".output";
const ZIP_SUFFIXES = ["-chrome.zip", "-firefox.zip", "-sources.zip"] as const;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

function u32(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>>
    0
  );
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function writeU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

/** DOS date/time from a UTC Date. Month 1–12, day 1–31 (never 0x0000). */
function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | (seconds >> 1),
  };
}

function findEocd(buf: Uint8Array): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) !== SIG_EOCD) continue;
    const commentLen = u16(buf, i + 20);
    if (i + 22 + commentLen === buf.length) return i;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

interface Entry {
  name: string;
  data: Uint8Array;
  store: boolean;
}

function readZip(buf: Uint8Array): Entry[] {
  const eocd = findEocd(buf);
  const entryCount = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported");
  }

  const entries: Entry[] = [];
  let cdPos = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (u32(buf, cdPos) !== SIG_CENTRAL) {
      throw new Error(`Invalid central-directory signature at entry ${i}`);
    }
    const flags = u16(buf, cdPos + 8);
    const method = u16(buf, cdPos + 10);
    const compressedSize = u32(buf, cdPos + 20);
    const nameLen = u16(buf, cdPos + 28);
    const extraLen = u16(buf, cdPos + 30);
    const commentLen = u16(buf, cdPos + 32);
    const localOffset = u32(buf, cdPos + 42);
    const name = new TextDecoder("utf-8").decode(
      buf.subarray(cdPos + 46, cdPos + 46 + nameLen),
    );

    if (u32(buf, localOffset) !== SIG_LOCAL) {
      throw new Error(`Invalid local header for ${name}`);
    }
    const localNameLen = u16(buf, localOffset + 26);
    const localExtraLen = u16(buf, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === METHOD_STORE) {
      data = compressed.slice();
    } else if (method === METHOD_DEFLATE) {
      data = new Uint8Array(inflateRawSync(compressed));
    } else {
      throw new Error(`Unsupported compression method ${method} for ${name}`);
    }

    if (flags & 0x1) {
      throw new Error(`Encrypted ZIP entry is not supported: ${name}`);
    }

    entries.push({
      name,
      data,
      store: method === METHOD_STORE,
    });
    cdPos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(entries: Entry[], stamp: Date): Uint8Array {
  const { dosTime, dosDate } = toDosDateTime(stamp);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const deflated = entry.store
      ? entry.data
      : new Uint8Array(deflateRawSync(entry.data));
    const useStore = entry.store || deflated.length >= entry.data.length;
    const payload = useStore ? entry.data : deflated;
    const method = useStore ? METHOD_STORE : METHOD_DEFLATE;
    const flags = /[^\x00-\x7F]/.test(entry.name) ? 0x0800 : 0;

    const local = new Uint8Array(30 + nameBytes.length);
    writeU32(local, 0, SIG_LOCAL);
    writeU16(local, 4, 20);
    writeU16(local, 6, flags);
    writeU16(local, 8, method);
    writeU16(local, 10, dosTime);
    writeU16(local, 12, dosDate);
    writeU32(local, 14, crc);
    writeU32(local, 18, payload.length);
    writeU32(local, 22, entry.data.length);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    local.set(nameBytes, 30);

    localParts.push(local, payload);

    const central = new Uint8Array(46 + nameBytes.length);
    writeU32(central, 0, SIG_CENTRAL);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, flags);
    writeU16(central, 10, method);
    writeU16(central, 12, dosTime);
    writeU16(central, 14, dosDate);
    writeU32(central, 16, crc);
    writeU32(central, 20, payload.length);
    writeU32(central, 24, entry.data.length);
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, 0);
    writeU32(central, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + payload.length;
  }

  const centralDir = concat(centralParts);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, SIG_EOCD);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, entries.length);
  writeU16(eocd, 10, entries.length);
  writeU32(eocd, 12, centralDir.length);
  writeU32(eocd, 16, offset);
  writeU16(eocd, 20, 0);

  return concat([...localParts, centralDir, eocd]);
}

function formatDos(dosDate: number, dosTime: number): string {
  const year = 1980 + (dosDate >> 9);
  const month = (dosDate >> 5) & 0xf;
  const day = dosDate & 0x1f;
  const hours = dosTime >> 11;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

async function normalizeZip(path: string, stamp: Date): Promise<void> {
  const original = new Uint8Array(await readFile(path));
  const entries = readZip(original);
  const names = entries.map((e) => e.name);
  const rewritten = writeZip(entries, stamp);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, rewritten);
  await rename(tmp, path);

  const { dosDate, dosTime } = toDosDateTime(stamp);
  const roundTrip = readZip(new Uint8Array(await readFile(path)));
  const roundNames = roundTrip.map((e) => e.name);
  if (roundNames.length !== names.length || roundNames.some((n, i) => n !== names[i])) {
    throw new Error(`${path}: entry paths changed while rewriting`);
  }
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!.data;
    const b = roundTrip[i]!.data;
    if (a.length !== b.length || a.some((byte, j) => byte !== b[j])) {
      throw new Error(`${path}: contents changed for ${names[i]}`);
    }
  }

  console.log(
    `normalized ${path} (${entries.length} entries, DOS ${formatDos(dosDate, dosTime)} UTC)`,
  );
}

async function main(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(OUTPUT_DIR);
  } catch {
    throw new Error(`No ${OUTPUT_DIR}/ directory — run bun run zip first`);
  }

  const zips = names
    .filter((name) => ZIP_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .sort();
  if (zips.length === 0) {
    throw new Error(
      `No ${ZIP_SUFFIXES.join("/")} files in ${OUTPUT_DIR}/ — run bun run zip first`,
    );
  }

  const stamp = new Date();
  for (const name of zips) {
    await normalizeZip(join(OUTPUT_DIR, name), stamp);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
