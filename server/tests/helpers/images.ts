/**
 * Tiny, syntactically-valid image buffers whose magic bytes are enough for the
 * server's `sniffImageMime` to recognise them. They are not real decodable
 * images — the proof pipeline only sniffs the leading bytes, never decodes — so
 * these keep the upload tests fast and dependency-free.
 */

/** A buffer that starts with the PNG signature (89 50 4E 47 0D 0A 1A 0A). */
export function pngBuffer(sizeBytes = 64): Buffer {
  const buf = Buffer.alloc(Math.max(sizeBytes, 16), 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return buf;
}

/** A buffer that starts with the JPEG SOI marker (FF D8 FF). */
export function jpegBuffer(sizeBytes = 64): Buffer {
  const buf = Buffer.alloc(Math.max(sizeBytes, 16), 0);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buf);
  return buf;
}

/** A "RIFF"…"WEBP" container header buffer. */
export function webpBuffer(sizeBytes = 64): Buffer {
  const buf = Buffer.alloc(Math.max(sizeBytes, 16), 0);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

/** Bytes that are NOT any accepted image (a spoof: declared image, real garbage). */
export function notAnImageBuffer(): Buffer {
  return Buffer.from('This is definitely not an image file. %PDF-1.4 MZ', 'utf8');
}
