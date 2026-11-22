// Small helpers around store packages (zip archives).

import { unzipSync, zipSync } from 'fflate';

export interface ZipEntry {
  name: string;
  // Raw MS-DOS date and time words, as stored in the archive.
  dosDate: number;
  dosTime: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;

// List the entries of an archive from its central directory. fflate hides the
// stored timestamps, and those are exactly what needs checking here.
export function listEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) end -= 1;
  if (end < 0) throw new Error('Not a zip archive: no end-of-central-directory record.');

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`Corrupt zip archive: bad central directory entry ${index}.`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      dosTime: view.getUint16(offset + 12, true),
      dosDate: view.getUint16(offset + 14, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// An MS-DOS date packs year-1980, month and day. Month 0 or day 0 is not a
// date. Firefox Add-ons rejects an upload whose entries carry one.
export function hasValidDate(entry: ZipEntry): boolean {
  const month = (entry.dosDate >> 5) & 0x0f;
  const day = entry.dosDate & 0x1f;
  return month >= 1 && month <= 12 && day >= 1;
}

// Rewrite an archive with the same entries, in the same order, all stamped
// with `mtime`.
export function restamp(bytes: Uint8Array, mtime: Date): Uint8Array {
  return zipSync(unzipSync(bytes), { mtime });
}

export function readEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
