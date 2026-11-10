import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraph, deleteMedia, publishFacebook, publishInstagram, redact, resolveAccounts, searchMusic, waitUntilFinished } from './meta.mjs';

const TOKEN = 'EAAtokendeprueba1234567890';

// Responde según «MÉTODO ruta» y anota cada llamada con sus parámetros.
const fakeFetch = (routes) => {
  const calls = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    const params = Object.fromEntries(init.method === 'GET' ? parsed.searchParams : init.body instanceof URLSearchParams ? init.body : []);
    const route = `${init.method} ${parsed.hostname === 'graph.facebook.com' ? parsed.pathname.replace('/v24.0/', '') : parsed.href}`;
    calls.push({ route, params, headers: init.headers });
    const handler = routes[route];
    if (!handler) throw new Error(`Ruta sin respuesta en el test: ${route}`);
    const data = typeof handler === 'function' ? handler(params) : handler;
    return { json: async () => data };
  };
  return { fetch, calls };
};

const noSleep = async () => {};

test('manda el token en el encabezado, nunca en la URL', async () => {
  const { fetch, calls } = fakeFetch({ 'GET me': { id: '1' } });
  await createGraph(TOKEN, { fetch }).get('me', { fields: 'id' });
  assert.equal(calls[0].headers.authorization, `OAuth ${TOKEN}`);
  assert.doesNotMatch(JSON.stringify(calls[0].params), /EAA/);
});

test('un error de Meta no muestra el token aunque venga en el mensaje', async () => {
  const { fetch } = fakeFetch({ 'GET me': { error: { message: `Token inválido: ${TOKEN}` } } });
  await assert.rejects(createGraph(TOKEN, { fetch }).get('me'), (error) => !error.message.includes(TOKEN) && /<token>/.test(error.message));
});

test('prefiere el mensaje para el usuario de Meta', async () => {
  const { fetch } = fakeFetch({ 'POST 9/media': { error: { message: 'Invalid parameter', error_user_msg: '«x» no es válido.' } } });
  await assert.rejects(createGraph(TOKEN, { fetch }).post('9/media'), /«x» no es válido/);
});

test('redact tapa cualquier token', () => assert.equal(redact(`a ${TOKEN} b`), 'a <token> b'));

test('resolveAccounts exige una sola página con Instagram', async () => {
  const page = { id: 'P', name: 'Mi página', access_token: 'EAApagina1234567890', instagram_business_account: { id: 'IG', username: 'micuenta' } };
  const one = fakeFetch({ 'GET me/accounts': { data: [page] } });
  assert.deepEqual(await resolveAccounts(createGraph(TOKEN, one)), { pageId: 'P', pageToken: 'EAApagina1234567890', igId: 'IG', igUsername: 'micuenta' });
  const two = fakeFetch({ 'GET me/accounts': { data: [page, page] } });
  await assert.rejects(resolveAccounts(createGraph(TOKEN, two)), /ve 2 páginas/);
});

test('searchMusic devuelve título, artista, segundos y link para escuchar', async () => {
  const { fetch } = fakeFetch({
    'GET ig_audio': { audio: [{ audio_id: '135', title: 'Fly 15s', display_artist: 'Tony Dark Eyes', duration_in_ms: 15000, download_url: 'https://x/fly.mp4' }] },
  });
  assert.deepEqual(await searchMusic(createGraph(TOKEN, { fetch }), 'IG', 'Fly'), [
    { audioId: '135', title: 'Fly 15s', artist: 'Tony Dark Eyes', seconds: 15, previewUrl: 'https://x/fly.mp4' },
  ]);
});

test('waitUntilFinished se rinde con un mensaje claro', async () => {
  const { fetch } = fakeFetch({ 'GET C': { status_code: 'IN_PROGRESS' } });
  await assert.rejects(
    waitUntilFinished(createGraph(TOKEN, { fetch }), 'C', { sleep: noSleep, intervalMs: 10, timeoutMs: 30 }),
    /sigue procesando/,
  );
});

test('waitUntilFinished corta si Instagram da error', async () => {
  const { fetch } = fakeFetch({ 'GET C': { status_code: 'ERROR', status: 'Video demasiado corto' } });
  await assert.rejects(waitUntilFinished(createGraph(TOKEN, { fetch }), 'C', { sleep: noSleep }), /Video demasiado corto/);
});

test('reel de Instagram: video por link, portada, música con volúmenes, ubicación y colaborador', async () => {
  const { fetch, calls } = fakeFetch({
    'POST IG/media': { id: 'C' },
    'GET C': { status_code: 'FINISHED' },
    'POST IG/media_publish': { id: 'M' },
    'GET M': { permalink: 'https://www.instagram.com/reel/X/' },
  });
  const post = { formato: 'reel', caption: 'Texto', locationId: '123456789012345', collaborators: ['otracuenta'], imageUrls: [], coverUrl: 'https://r2/portada', videoUrl: 'https://r2/video', video: Buffer.from('mp4'), audioId: '135' };
  const result = await publishInstagram(createGraph(TOKEN, { fetch }), 'IG', post, { sleep: noSleep });
  assert.deepEqual(result, { id: 'M', permalink: 'https://www.instagram.com/reel/X/' });
  assert.deepEqual(calls[0].params, {
    media_type: 'REELS', video_url: 'https://r2/video', caption: 'Texto', location_id: '123456789012345',
    collaborators: '["otracuenta"]', cover_url: 'https://r2/portada', share_to_feed: 'true',
    audio_configuration: '{"audio_id":"135","audio_volume":100,"video_volume":0}',
  });
  assert.deepEqual(calls.at(-2).params, { creation_id: 'C' });
});

test('carrusel de Instagram: un hijo por imagen y el padre con los hijos en orden', async () => {
  let child = 0;
  const { fetch, calls } = fakeFetch({
    'POST IG/media': (params) => (params.media_type === 'CAROUSEL' ? { id: 'PADRE' } : { id: `H${++child}` }),
    'GET H1': { status_code: 'FINISHED' },
    'GET H2': { status_code: 'FINISHED' },
    'GET PADRE': { status_code: 'FINISHED' },
    'POST IG/media_publish': { id: 'M' },
    'GET M': { permalink: 'https://www.instagram.com/p/X/' },
  });
  const post = { formato: 'carrusel', caption: 'Texto', collaborators: [], imageUrls: ['https://r2/1', 'https://r2/2'] };
  await publishInstagram(createGraph(TOKEN, { fetch }), 'IG', post, { sleep: noSleep });
  const parent = calls.find((call) => call.params.media_type === 'CAROUSEL');
  assert.deepEqual(parent.params, { media_type: 'CAROUSEL', children: 'H1,H2', caption: 'Texto' });
  assert.deepEqual(calls[0].params, { image_url: 'https://r2/1', is_carousel_item: 'true' });
});

test('historia de Instagram en imagen: sin texto ni ubicación', async () => {
  const { fetch, calls } = fakeFetch({
    'POST IG/media': { id: 'C' },
    'GET C': { status_code: 'FINISHED' },
    'POST IG/media_publish': { id: 'M' },
    'GET M': { permalink: 'https://www.instagram.com/stories/micuenta/M/' },
  });
  await publishInstagram(createGraph(TOKEN, { fetch }), 'IG', { formato: 'historia', collaborators: [], imageUrls: ['https://r2/h'] }, { sleep: noSleep });
  assert.deepEqual(calls[0].params, { media_type: 'STORIES', image_url: 'https://r2/h' });
});

test('reel de Facebook: start, subida y finish publicado con texto y lugar', async () => {
  const { fetch, calls } = fakeFetch({
    'POST P/video_reels': (params) => (params.upload_phase === 'start' ? { video_id: 'V', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/V' } : { success: true, post_id: 'POST' }),
    'POST https://rupload.facebook.com/video-upload/v26.0/V': { success: true },
    'GET V': { permalink_url: '/reel/V/' },
  });
  const post = { formato: 'reel', caption: 'Texto', locationId: '123456789012345', collaborators: ['otracuenta'], imageUrls: [], video: Buffer.from('mp4') };
  const result = await publishFacebook(createGraph(TOKEN, { fetch }), 'P', post);
  // El id es el del video (el que se borra); Meta devuelve el link relativo.
  assert.deepEqual(result, { id: 'V', permalink: 'https://www.facebook.com/reel/V/' });
  assert.deepEqual(calls[2].params, { upload_phase: 'finish', video_id: 'V', video_state: 'PUBLISHED', description: 'Texto', place: '123456789012345' });
});

test('carrusel de Facebook: fotos sin publicar y un post con todas, en orden', async () => {
  let photo = 0;
  const { fetch, calls } = fakeFetch({
    'POST P/photos': () => ({ id: `F${++photo}` }),
    'POST P/feed': { id: 'P_1' },
    'GET P_1': { permalink_url: 'https://www.facebook.com/micuenta/posts/1' },
  });
  const post = { formato: 'carrusel', caption: 'Texto', locationId: '123456789012345', collaborators: [], imageUrls: ['https://r2/1', 'https://r2/2'] };
  await publishFacebook(createGraph(TOKEN, { fetch }), 'P', post);
  assert.deepEqual(calls[0].params, { url: 'https://r2/1', published: 'false' });
  assert.deepEqual(calls[2].params, {
    message: 'Texto', place: '123456789012345', attached_media: '[{"media_fbid":"F1"},{"media_fbid":"F2"}]',
  });
});

test('historia de Facebook en imagen: foto sin publicar y photo_stories', async () => {
  const { fetch, calls } = fakeFetch({
    'POST P/photos': { id: 'F' },
    'POST P/photo_stories': { success: true, post_id: 'S' },
    'GET S': { permalink_url: 'https://www.facebook.com/stories/S' },
  });
  await publishFacebook(createGraph(TOKEN, { fetch }), 'P', { formato: 'historia', collaborators: [], imageUrls: ['https://r2/h'] });
  assert.deepEqual(calls[1].params, { photo_id: 'F' });
});

test('si leer el link de Instagram falla, devuelve el id igual (el post ya es público)', async () => {
  const { fetch } = fakeFetch({
    'POST IG/media': { id: 'C' },
    'GET C': { status_code: 'FINISHED' },
    'POST IG/media_publish': { id: 'M' },
    'GET M': { error: { message: 'Service temporarily unavailable' } },
  });
  const result = await publishInstagram(createGraph(TOKEN, { fetch }), 'IG', { formato: 'imagen', collaborators: [], imageUrls: ['https://r2/1'] }, { sleep: noSleep });
  assert.deepEqual(result, { id: 'M', permalink: undefined });
});

test('el colaborador va sin «@» aunque texto.md la tenga', async () => {
  const { fetch, calls } = fakeFetch({
    'POST IG/media': { id: 'C' }, 'GET C': { status_code: 'FINISHED' },
    'POST IG/media_publish': { id: 'M' }, 'GET M': { permalink: 'p' },
  });
  await publishInstagram(createGraph(TOKEN, { fetch }), 'IG', { formato: 'imagen', collaborators: ['@otracuenta'], imageUrls: ['u'] }, { sleep: noSleep });
  assert.equal(calls[0].params.collaborators, '["otracuenta"]');
});

test('el finish de un video de Facebook sin éxito es un error, no una publicación', async () => {
  const { fetch } = fakeFetch({
    'POST P/video_reels': (params) => (params.upload_phase === 'start' ? { video_id: 'V', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/V' } : { success: false }),
    'POST https://rupload.facebook.com/video-upload/v26.0/V': { success: true },
  });
  const post = { formato: 'reel', caption: 'T', collaborators: [], imageUrls: [], video: Buffer.from('mp4') };
  await assert.rejects(publishFacebook(createGraph(TOKEN, { fetch }), 'P', post), /Facebook no confirmó/);
});

test('la historia de Facebook recupera su link desde la lista de historias de la página', async () => {
  const { fetch } = fakeFetch({
    'POST P/photos': { id: 'F' },
    'POST P/photo_stories': { success: true, post_id: 'S' },
    'GET P/stories': { data: [{ post_id: 'OTRA', url: 'https://x/otra' }, { post_id: 'S', url: 'https://facebook.com/stories/S' }] },
  });
  const result = await publishFacebook(createGraph(TOKEN, { fetch }), 'P', { formato: 'historia', collaborators: [], imageUrls: ['u'] });
  assert.deepEqual(result, { id: 'S', permalink: 'https://facebook.com/stories/S' });
});

test('deleteMedia borra y exige la confirmación de Meta', async () => {
  const ok = fakeFetch({ 'DELETE M': { success: true } });
  await deleteMedia(createGraph(TOKEN, ok), 'M');
  assert.equal(ok.calls[0].route, 'DELETE M');
  const no = fakeFetch({ 'DELETE M': { success: false } });
  await assert.rejects(deleteMedia(createGraph(TOKEN, no), 'M'), /no confirmó el borrado/);
});

test('el link de la historia de Facebook se busca también en las páginas siguientes de la lista', async () => {
  const { fetch, calls } = fakeFetch({
    'POST P/photos': { id: 'F' },
    'POST P/photo_stories': { success: true, post_id: 'S' },
    'GET P/stories': (params) => (params.after === 'C2'
      ? { data: [{ post_id: 'S', url: 'https://facebook.com/stories/S' }] }
      : { data: [{ post_id: 'OTRA', url: 'https://x/otra' }], paging: { cursors: { after: 'C2' }, next: 'https://graph.facebook.com/…' } }),
  });
  const result = await publishFacebook(createGraph(TOKEN, { fetch }), 'P', { formato: 'historia', collaborators: [], imageUrls: ['u'] });
  assert.deepEqual(result, { id: 'S', permalink: 'https://facebook.com/stories/S' });
  assert.equal(calls.filter((call) => call.route === 'GET P/stories').length, 2);
});

test('si la historia no aparece en ninguna página, devuelve el id sin link y no recorre para siempre', async () => {
  const { fetch, calls } = fakeFetch({
    'POST P/photos': { id: 'F' },
    'POST P/photo_stories': { success: true, post_id: 'S' },
    'GET P/stories': { data: [{ post_id: 'OTRA' }], paging: { cursors: { after: 'C' }, next: 'https://graph.facebook.com/…' } },
  });
  const result = await publishFacebook(createGraph(TOKEN, { fetch }), 'P', { formato: 'historia', collaborators: [], imageUrls: ['u'] });
  assert.deepEqual(result, { id: 'S', permalink: undefined });
  assert.ok(calls.filter((call) => call.route === 'GET P/stories').length <= 10);
});
