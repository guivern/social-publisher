import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { borrar, check, publish } from './publicar.mjs';

const VERTICAL = { width: 1080, height: 1920 };
const TEXTO = `---
formato: reel
redes: [instagram, facebook]
ubicacion: "123456789012345"
video: v.mp4
portada: p.png
---
## Instagram

Un texto de prueba.

## Facebook

Un texto de prueba.
`;

const piece = (texto = TEXTO) => {
  const dir = mkdtempSync(join(tmpdir(), 'pieza-'));
  writeFileSync(join(dir, 'texto.md'), texto);
  writeFileSync(join(dir, 'v.mp4'), 'mp4');
  writeFileSync(join(dir, 'p.png'), 'png');
  return dir;
};

// Meta y R2 simulados: anotan lo que se publica y lo que se sube o borra.
const fakeDeps = ({ failOn } = {}) => {
  const published = [];
  const r2 = { uploaded: [], removed: [] };
  const graph = {
    get: async (path) => {
      if (path.endsWith('content_publishing_limit')) return { data: [{ quota_usage: 3, config: { quota_total: 100 } }] };
      if (path === 'ig_audio') return { audio: [{ audio_id: '135', title: 'Fly 15s', duration_in_ms: 15000 }] };
      return {};
    },
    post: async () => ({}),
  };
  return {
    published,
    r2State: r2,
    deps: {
      readFile: readFileSync,
      writeFile: writeFileSync,
      exists: existsSync,
      sizeOf: () => VERTICAL,
      toJpeg: (from, to) => writeFileSync(to, 'jpg'),
      tempDir: () => mkdtempSync(join(tmpdir(), 'jpg-')),
      now: () => new Date('2026-10-15T12:00:00Z'),
      sleep: async () => {},
      log: () => {},
      r2: {
        put: async (key) => r2.uploaded.push(key),
        remove: async (key) => r2.removed.push(key),
        presign: (key) => `https://r2/${key}`,
      },
      connect: async () => ({ graph, page: graph, accounts: { igId: 'IG', pageId: 'P' } }),
      publishInstagram: async (_graph, _id, post) => {
        if (failOn === 'instagram') throw new Error('falló Instagram');
        published.push(['instagram', post]);
        return { id: 'M', permalink: 'https://www.instagram.com/reel/X/' };
      },
      publishFacebook: async (_page, _id, post) => {
        if (failOn === 'facebook') throw new Error('falló Facebook');
        published.push(['facebook', post]);
        return { id: 'F', permalink: 'https://www.facebook.com/reel/F' };
      },
    },
  };
};

test('check aprueba un reel completo sin publicar nada', async () => {
  const { deps, published, r2State } = fakeDeps();
  const result = await check(piece(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(published, []);
  assert.deepEqual(r2State.uploaded, []);
});

test('publish publica en las dos redes, guarda publicado.json y borra R2', async () => {
  const { deps, published, r2State } = fakeDeps();
  const dir = piece();
  assert.equal(await publish(dir, deps), true);
  assert.deepEqual(published.map(([red]) => red), ['instagram', 'facebook']);
  assert.equal(published[0][1].coverUrl, `https://r2/${r2State.uploaded[0]}`);
  assert.equal(published[0][1].locationId, '123456789012345');
  const saved = JSON.parse(readFileSync(join(dir, 'publicado.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved), ['instagram', 'facebook']);
  assert.equal(saved.instagram.permalink, 'https://www.instagram.com/reel/X/');
  assert.deepEqual(r2State.removed, r2State.uploaded);
});

test('si Facebook falla, Instagram queda anotado, R2 se borra y el reintento publica solo Facebook', async () => {
  const dir = piece();
  const first = fakeDeps({ failOn: 'facebook' });
  await assert.rejects(publish(dir, first.deps), /falló Facebook/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'publicado.json'), 'utf8'))), ['instagram']);
  assert.deepEqual(first.r2State.removed, first.r2State.uploaded);

  const second = fakeDeps();
  await publish(dir, second.deps);
  assert.deepEqual(second.published.map(([red]) => red), ['facebook']);
  assert.deepEqual(second.r2State.uploaded, []);
});

test('publish no hace nada si todo ya estaba publicado', async () => {
  const dir = piece();
  writeFileSync(join(dir, 'publicado.json'), JSON.stringify({ instagram: { id: 'M' }, facebook: { id: 'F' } }));
  const { deps, published } = fakeDeps();
  assert.equal(await publish(dir, deps), true);
  assert.deepEqual(published, []);
});

test('publish no publica si check falla', async () => {
  const { deps, published } = fakeDeps();
  assert.equal(await publish(piece(TEXTO.replace('portada: p.png\n', '')), deps), false);
  assert.deepEqual(published, []);
});

test('si no puede anotar publicado.json, lo dice fuerte y pide no reintentar', async () => {
  const { deps } = fakeDeps();
  const logs = [];
  const failing = {
    ...deps,
    log: (text) => logs.push(text),
    writeFile: (path, data) => {
      if (path.endsWith('publicado.json')) throw new Error('EBUSY');
      return writeFileSync(path, data);
    },
  };
  await assert.rejects(publish(piece(), failing), /no reintentes/);
  assert.match(logs.join('\n'), /PUBLICADO en Instagram/);
});

test('el ensayo de una historia no muestra texto: las historias no lo llevan', async () => {
  const { deps } = fakeDeps();
  const logs = [];
  const dir = mkdtempSync(join(tmpdir(), 'historia-'));
  writeFileSync(join(dir, 'texto.md'), '---\nformato: historia\nredes: [instagram]\nimagenes: [h.png]\n---\n## Instagram\n\nNota interna.\n');
  writeFileSync(join(dir, 'h.png'), 'png');
  await check(dir, { ...deps, log: (text) => logs.push(text) });
  assert.doesNotMatch(logs.join('\n'), /Nota interna/);
});

test('el reel con música va a Instagram por link de R2, con audio en silencio sumado', async () => {
  const { deps, published, r2State } = fakeDeps();
  const silenced = [];
  const dir = piece(TEXTO.replace('ubicacion:', 'musica: { titulo: Fly 15s, audio_id: "135" }\nubicacion:'));
  await publish(dir, { ...deps, addSilentAudio: (from, to) => (silenced.push(from), writeFileSync(to, 'mp4+audio')) });
  const [, igPost] = published.find(([red]) => red === 'instagram');
  assert.equal(silenced.length, 1);
  assert.match(igPost.videoUrl, /^https:\/\/r2\/.*\/video\.mp4$/);
  assert.ok(r2State.uploaded.some((key) => key.endsWith('/video.mp4')));
  assert.deepEqual(r2State.removed, r2State.uploaded);
});

test('la copia de Facebook del reel lleva la música de la Sound Collection mezclada; Instagram no', async () => {
  const { deps, published } = fakeDeps();
  const mixed = [];
  const dir = piece(TEXTO.replace('ubicacion:', 'musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "135", facebook: fly.mp3 }\nubicacion:'));
  writeFileSync(join(dir, 'fly.mp3'), 'mp3');
  await publish(dir, {
    ...deps,
    addSilentAudio: (from, to) => writeFileSync(to, 'silencio'),
    addMusic: (video, music, to) => (mixed.push(music), writeFileSync(to, 'con-musica')),
  });
  assert.deepEqual(mixed, [join(dir, 'fly.mp3')]);
  const facebook = published.find(([red]) => red === 'facebook')[1];
  const instagram = published.find(([red]) => red === 'instagram')[1];
  assert.equal(facebook.video.toString(), 'con-musica');
  assert.equal(instagram.video.toString(), 'mp4');
});

test('check frena si falta el archivo de música para Facebook', async () => {
  const { deps } = fakeDeps();
  const result = await check(piece(TEXTO.replace('ubicacion:', 'musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "135", facebook: fly.mp3 }\nubicacion:')), deps);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /fly\.mp3: no existe/);
});

test('un archivo que no se puede medir es un error del ensayo, no un error crudo', async () => {
  const { deps } = fakeDeps();
  const result = await check(piece(), { ...deps, sizeOf: () => { throw new Error('formato no soportado'); } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /v\.mp4: formato no soportado/);
});

test('el cupo de Instagram no frena un reintento que solo publica Facebook', async () => {
  const { deps } = fakeDeps();
  const dir = piece();
  writeFileSync(join(dir, 'publicado.json'), JSON.stringify({ instagram: { id: 'M' } }));
  const full = { ...deps, connect: async () => ({ ...(await deps.connect()), graph: { get: async () => ({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] }) } }) };
  assert.equal((await check(dir, full)).ok, true);
});

test('borrar sin confirmar solo muestra qué borraría', async () => {
  const { deps } = fakeDeps();
  const removed = [];
  const dir = piece();
  writeFileSync(join(dir, 'publicado.json'), JSON.stringify({ instagram: { id: 'M', permalink: 'https://ig/M' }, facebook: { id: 'F' } }));
  const logs = [];
  await borrar(dir, [], { ...deps, log: (t) => logs.push(t), deleteMedia: async (_g, id) => removed.push(id) });
  assert.deepEqual(removed, []);
  assert.match(logs.join('\n'), /https:\/\/ig\/M/);
  assert.match(logs.join('\n'), /--confirmar/);
});

test('borrar con --confirmar borra cada red con su token y la saca de publicado.json', async () => {
  const { deps } = fakeDeps();
  const removed = [];
  const dir = piece();
  writeFileSync(join(dir, 'publicado.json'), JSON.stringify({ instagram: { id: 'M' }, facebook: { id: 'F' } }));
  const graph = { name: 'sistema' };
  const page = { name: 'pagina' };
  await borrar(dir, ['facebook', '--confirmar'], {
    ...deps,
    connect: async () => ({ graph, page, accounts: {} }),
    deleteMedia: async (g, id) => removed.push([g.name, id]),
  });
  assert.deepEqual(removed, [['pagina', 'F']]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'publicado.json'), 'utf8'))), ['instagram']);
});

test('con música en Facebook, el texto de Facebook nombra el tema al final; el de Instagram no', async () => {
  const { deps, published } = fakeDeps();
  const logs = [];
  const dir = piece(TEXTO.replace('ubicacion:', 'musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "135", facebook: fly.mp3 }\nubicacion:'));
  writeFileSync(join(dir, 'fly.mp3'), 'mp3');
  await publish(dir, { ...deps, log: (t) => logs.push(t), addSilentAudio: (f, t) => writeFileSync(t, 's'), addMusic: (v, m, t) => writeFileSync(t, 'm') });
  const caption = (red) => published.find(([name]) => name === red)[1].caption;
  assert.match(caption('facebook'), /\n\nMúsica: «Fly 15s» de Tony Dark Eyes\.$/);
  assert.doesNotMatch(caption('instagram'), /Música:/);
  assert.match(logs.join('\n'), /Música: «Fly 15s» de Tony Dark Eyes\./);
});

test('borrar con una red mal escrita no borra nada (no es «todas»)', async () => {
  const { deps } = fakeDeps();
  const removed = [];
  const dir = piece();
  writeFileSync(join(dir, 'publicado.json'), JSON.stringify({ instagram: { id: 'M' }, facebook: { id: 'F' } }));
  for (const typo of ['instagran', 'Instagram', 'fb'])
    await assert.rejects(borrar(dir, [typo, '--confirmar'], { ...deps, deleteMedia: async (_g, id) => removed.push(id) }), /no es una red/);
  assert.deepEqual(removed, []);
});

test('si no puede anotar el borrado en publicado.json, lo dice y corta', async () => {
  const { deps } = fakeDeps();
  const dir = piece();
  writeFileSync(join(dir, 'publicado.json'), JSON.stringify({ instagram: { id: 'M' }, facebook: { id: 'F' } }));
  const removed = [];
  const failing = {
    ...deps,
    connect: async () => ({ graph: {}, page: {}, accounts: {} }),
    deleteMedia: async (_g, id) => removed.push(id),
    writeFile: () => { throw new Error('EBUSY'); },
  };
  await assert.rejects(borrar(dir, ['--confirmar'], failing), /BORRADO en Instagram, pero no pude anotarlo/);
  assert.deepEqual(removed, ['M']);
});

test('avisa si el texto de Facebook ya nombra la música a mano (saldría dos veces)', async () => {
  const { deps } = fakeDeps();
  const dir = piece(TEXTO.replace('ubicacion:', 'musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "135", facebook: fly.mp3 }\nubicacion:')
    .replace(/(## Facebook\n\nUn texto de prueba\.)/, '$1\n\nMúsica: Fly'));
  writeFileSync(join(dir, 'fly.mp3'), 'mp3');
  const { warnings } = await check(dir, deps);
  assert.match(warnings.join(), /ya nombra la música/);
});

test('encuentra un archivo cuyo nombre quedó en NFD (Drive, Mac)', async () => {
  const { deps } = fakeDeps();
  const dir = piece(TEXTO.replace('portada: p.png', 'portada: portada-canción.png'));
  writeFileSync(join(dir, 'portada-canción.png'.normalize('NFD')), 'png');
  const result = await check(dir, deps);
  assert.equal(result.ok, true, result.errors.join());
});

test('el ensayo valida la conexión con Meta aunque la pieza sea solo de Facebook', async () => {
  const { deps } = fakeDeps();
  let connected = false;
  const dir = piece(TEXTO.replace('redes: [instagram, facebook]', 'redes: [facebook]'));
  await check(dir, { ...deps, connect: async () => { connected = true; return deps.connect(); } });
  assert.equal(connected, true);
});

test('un reel solo para Instagram no exige el archivo de música de Facebook', async () => {
  const { deps } = fakeDeps();
  const dir = piece(TEXTO.replace('redes: [instagram, facebook]', 'redes: [instagram]')
    .replace('ubicacion:', 'musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "135", facebook: fly.mp3 }\nubicacion:'));
  const result = await check(dir, deps);
  assert.equal(result.ok, true, result.errors.join());
});
