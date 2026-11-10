import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageSize } from './media.mjs';

// Solo la cabecera: imageSize no decodifica la imagen.
const png = (width, height) => {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const jpeg = (width, height) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof0 = Buffer.alloc(19);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
};

test('mide un PNG', () => assert.deepEqual(imageSize(png(1080, 1350)), { width: 1080, height: 1350 }));

test('mide un JPEG salteando los segmentos previos', () =>
  assert.deepEqual(imageSize(jpeg(1080, 1920)), { width: 1080, height: 1920 }));

test('otro formato avisa', () => assert.throws(() => imageSize(Buffer.from('GIF89a......')), /PNG ni un JPEG/));
