import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer for the build-time bundle archive.
 *
 * Deliberately dependency-free: the SDK is a browser package and should not pull a
 * compression library into its dependency tree for a Node-only build step. Output is a
 * plain deflate/store archive that any standard reader (the host uses JSZip) accepts.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Fixed 1980-01-01 DOS timestamp. Archives stay byte-identical for identical input,
 * which keeps the archive hash stable across rebuilds of unchanged sources.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const ZIP64_LIMIT = 0xffffffff;

/** Extensions whose payload is already compressed — deflating them only costs build time. */
const PRECOMPRESSED_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".br",
  ".gif",
  ".gz",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".png",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
  ".zst",
]);

export function isPrecompressedPath(filePath: string) {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex < 0) {
    return false;
  }
  return PRECOMPRESSED_EXTENSIONS.has(filePath.slice(dotIndex).toLowerCase());
}

export interface ZipArchiveEntry {
  /** POSIX path stored in the archive. */
  path: string;
  data: Uint8Array;
}

interface PreparedEntry {
  nameBytes: Buffer;
  payload: Buffer;
  method: number;
  crc: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Bit 11 marks the file name as UTF-8 rather than CP437. */
const UTF8_NAME_FLAG = 0x0800;

export function createZipArchive(entries: readonly ZipArchiveEntry[]): Buffer {
  const prepared: PreparedEntry[] = [];
  const localChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, "utf8");
    const data = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const store = isPrecompressedPath(entry.path);
    const deflated = store ? null : deflateRawSync(data, { level: 9 });
    // Fall back to storing whenever deflate does not actually pay off.
    const useStored = !deflated || deflated.length >= data.length;
    const payload = useStored ? data : (deflated as Buffer);

    if (data.length > ZIP64_LIMIT || payload.length > ZIP64_LIMIT) {
      throw new Error(`Bundle file "${entry.path}" exceeds the 4 GiB ZIP limit.`);
    }

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8_NAME_FLAG, 6);
    header.writeUInt16LE(useStored ? 0 : 8, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    const crc = crc32(data);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);

    localChunks.push(header, nameBytes, payload);
    prepared.push({
      nameBytes,
      payload,
      method: useStored ? 0 : 8,
      crc,
      uncompressedSize: data.length,
      localHeaderOffset: offset,
    });
    offset += header.length + nameBytes.length + payload.length;

    if (offset > ZIP64_LIMIT) {
      throw new Error("Bundle archive exceeds the 4 GiB ZIP limit.");
    }
  }

  const centralChunks: Buffer[] = [];
  let centralDirectorySize = 0;

  for (const entry of prepared) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAME_FLAG, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.payload.length, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.localHeaderOffset, 42);

    centralChunks.push(header, entry.nameBytes);
    centralDirectorySize += header.length + entry.nameBytes.length;
  }

  if (prepared.length > 0xffff) {
    throw new Error("Bundle archive exceeds the 65535 entry ZIP limit.");
  }

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(prepared.length, 8);
  endRecord.writeUInt16LE(prepared.length, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, endRecord]);
}
