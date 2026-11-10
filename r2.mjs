// Sube archivos al bucket privado de R2 y firma links temporales para que Meta los descargue.
// Firma SigV4 de S3 (R2 es compatible): https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const REGION = 'auto';
const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (path) => path.split('/').map(encode).join('/');
const amzDate = (date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');
const signingKey = (secret, day, region) => hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
const sign = (secret, day, region, stringToSign) =>
  createHmac('sha256', signingKey(secret, day, region)).update(stringToSign).digest('hex');

export const readEnvFile = (path) =>
  Object.fromEntries(
    readFileSync(path, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );

export const presignUrl = ({ host, path, accessKeyId, secretAccessKey, region, date, expires }) => {
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const queryString = Object.keys(query).sort().map((key) => `${encode(key)}=${encode(query[key])}`).join('&');
  const canonical = ['GET', encodePath(path), queryString, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const signature = sign(secretAccessKey, day, region, ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n'));
  return `https://${host}${encodePath(path)}?${queryString}&X-Amz-Signature=${signature}`;
};

const slug = (text) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const objectKey = (folderName, date, fileName) => `${date.toISOString().slice(0, 10)}-${slug(folderName)}/${fileName}`;

export const createR2 = (env, { fetch = globalThis.fetch, now = () => new Date(), source = 'r2.env' } = {}) => {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`${source}: falta ${missing.join(', ')}.`);
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const objectPath = (key) => `/${env.R2_BUCKET}/${key}`;

  const send = async (method, key, body = Buffer.alloc(0), contentType) => {
    const stamp = amzDate(now());
    const day = stamp.slice(0, 8);
    const scope = `${day}/${REGION}/s3/aws4_request`;
    const headers = { host, 'x-amz-content-sha256': sha256(body), 'x-amz-date': stamp, ...(contentType && { 'content-type': contentType }) };
    const names = Object.keys(headers).sort();
    const canonical = [method, encodePath(objectPath(key)), '', ...names.map((name) => `${name}:${headers[name]}`), '', names.join(';'), headers['x-amz-content-sha256']].join('\n');
    const signature = sign(env.R2_SECRET_ACCESS_KEY, day, REGION, ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n'));
    const { host: _host, ...sent } = headers;
    const response = await fetch(`https://${host}${encodePath(objectPath(key))}`, {
      method,
      body: method === 'PUT' ? body : undefined,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
    });
    if (!response.ok) throw new Error(`R2 ${method} ${key}: ${response.status}`);
  };

  return {
    put: (key, body, contentType) => send('PUT', key, body, contentType),
    remove: (key) => send('DELETE', key),
    presign: (key, expires = 3600) =>
      presignUrl({ host, path: objectPath(key), accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: REGION, date: now(), expires }),
  };
};
