import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createR2, objectKey, presignUrl } from './r2.mjs';

const ENV = { R2_ACCOUNT_ID: 'cuenta', R2_ACCESS_KEY_ID: 'AKID', R2_SECRET_ACCESS_KEY: 'secreto', R2_BUCKET: 'redes' };
const NOW = () => new Date('2026-10-15T12:00:00Z');

test('firma igual que el ejemplo de AWS (SigV4, link prefirmado)', () => {
  const url = presignUrl({
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    date: new Date('2013-05-24T00:00:00Z'),
    expires: 86400,
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('la clave no lleva espacios, tildes ni «·»', () => {
  assert.equal(
    objectKey('Mi primer réel · reel', NOW(), 'portada.jpg'),
    '2026-10-15-mi-primer-reel-reel/portada.jpg',
  );
});

test('put firma la subida con el hash del contenido', async () => {
  const calls = [];
  const r2 = createR2(ENV, { now: NOW, fetch: async (url, init) => (calls.push({ url, init }), { ok: true }) });
  const body = Buffer.from('imagen');
  await r2.put('2026-10-15-x/1.jpg', body, 'image/jpeg');
  const [{ url, init }] = calls;
  assert.equal(url, 'https://cuenta.r2.cloudflarestorage.com/redes/2026-10-15-x/1.jpg');
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers['x-amz-content-sha256'], createHash('sha256').update(body).digest('hex'));
  assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20261015\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('una respuesta de error de R2 avisa', async () => {
  const r2 = createR2(ENV, { now: NOW, fetch: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(r2.remove('x/1.jpg'), /R2 DELETE x\/1\.jpg: 403/);
});

test('el link firmado vence en una hora por defecto', () => {
  const url = createR2(ENV, { now: NOW }).presign('x/1.jpg');
  assert.match(url, /^https:\/\/cuenta\.r2\.cloudflarestorage\.com\/redes\/x\/1\.jpg\?/);
  assert.match(url, /X-Amz-Expires=3600/);
});

test('sin una variable de r2.env avisa cuál falta', () => {
  assert.throws(() => createR2({ ...ENV, R2_BUCKET: '' }), /R2_BUCKET/);
});

test('la fecha de la clave es la UTC', () => {
  assert.equal(objectKey('x', new Date('2026-10-16T01:30:00Z'), 'a.jpg'), '2026-10-16-x/a.jpg');
});
