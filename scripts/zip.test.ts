import { describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import { hasValidDate, listEntries, readEntries, restamp } from './zip';

const text = (value: string) => new TextEncoder().encode(value);

function sample(mtime: Date): Uint8Array {
  return zipSync(
    {
      'manifest.json': text('{"name":"Detour"}'),
      'chunks/popup.js': text('console.log("popup");'.repeat(50)),
      'icon/16.png': new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]),
    },
    { mtime },
  );
}

// Zero the timestamp words of every entry, in the local headers and in the
// central directory. This is what WXT's zip writer produces.
function withoutDates(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  for (let offset = 0; offset + 4 <= out.length; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) view.setUint32(offset + 10, 0, true);
    if (signature === 0x02014b50) view.setUint32(offset + 12, 0, true);
  }
  return out;
}

describe('listEntries', () => {
  test('reads names and timestamps from the central directory', () => {
    const entries = listEntries(sample(new Date('2026-03-04T05:06:08Z')));
    expect(entries.map((entry) => entry.name)).toEqual([
      'manifest.json',
      'chunks/popup.js',
      'icon/16.png',
    ]);
    expect(entries.every(hasValidDate)).toBe(true);
  });

  test('rejects bytes that are not a zip archive', () => {
    expect(() => listEntries(text('definitely not a zip archive'))).toThrow('Not a zip archive');
  });
});

describe('hasValidDate', () => {
  test('a zeroed timestamp is not a date', () => {
    expect(hasValidDate({ name: 'a', dosDate: 0, dosTime: 0 })).toBe(false);
    // Day 0 with a valid month, and month 0 with a valid day.
    expect(hasValidDate({ name: 'a', dosDate: (46 << 9) | (3 << 5) | 0, dosTime: 0 })).toBe(false);
    expect(hasValidDate({ name: 'a', dosDate: (46 << 9) | (0 << 5) | 4, dosTime: 0 })).toBe(false);
    expect(hasValidDate({ name: 'a', dosDate: (46 << 9) | (3 << 5) | 4, dosTime: 0 })).toBe(true);
  });
});

describe('restamp', () => {
  test('gives every entry a real date and changes nothing else', () => {
    const broken = withoutDates(sample(new Date('2026-03-04T05:06:08Z')));
    expect(listEntries(broken).some(hasValidDate)).toBe(false);

    const fixed = restamp(broken, new Date('2026-11-22T10:00:00Z'));
    const entries = listEntries(fixed);
    expect(entries.every(hasValidDate)).toBe(true);
    expect(entries.map((entry) => entry.name)).toEqual(
      listEntries(broken).map((entry) => entry.name),
    );
    expect(readEntries(fixed)).toEqual(readEntries(broken));
  });
});
