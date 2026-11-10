// Llamadas a la Graph API de Meta para publicar en una cuenta de Instagram y en su página de Facebook.
const GRAPH = 'https://graph.facebook.com/v24.0';

export class MetaError extends Error {}

export const redact = (text) => String(text).replace(/EAA[A-Za-z0-9]{10,}/g, '<token>');

const toParam = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

export const createGraph = (token, { fetch = globalThis.fetch } = {}) => {
  const call = async (method, path, params = {}) => {
    const url = new URL(`${GRAPH}/${path}`);
    const body = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, toParam(value)]),
    );
    const init = { method, headers: { authorization: `OAuth ${token}` } };
    if (method === 'GET') url.search = body.toString();
    else init.body = body;
    const data = await (await fetch(url.href, init)).json();
    if (data.error) throw new MetaError(redact(`${path}: ${data.error.error_user_msg ?? data.error.message}`));
    return data;
  };
  return {
    get: (path, params) => call('GET', path, params),
    post: (path, params) => call('POST', path, params),
    remove: (path) => call('DELETE', path),
    upload: async (uploadUrl, bytes) => {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.length) },
        body: bytes,
      });
      const data = await response.json();
      if (!data.success) throw new MetaError(redact(`subida del video: ${data.error?.message ?? JSON.stringify(data)}`));
    },
    withToken: (other) => createGraph(other, { fetch }),
  };
};

export const resolveAccounts = async (graph) => {
  const { data } = await graph.get('me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}' });
  if (data.length !== 1) throw new MetaError(`El token ve ${data.length} páginas; tiene que ver una sola (dale al usuario del sistema acceso solo a tu página).`);
  const [page] = data;
  if (!page.instagram_business_account) throw new MetaError(`La página ${page.name} no tiene una cuenta de Instagram vinculada.`);
  return {
    pageId: page.id,
    pageToken: page.access_token,
    igId: page.instagram_business_account.id,
    igUsername: page.instagram_business_account.username,
  };
};

export const searchMusic = async (graph, igId, query) => {
  const { audio = [] } = await graph.get('ig_audio', { audio_type: 'music', search_query: query, user_id: igId });
  return audio.map(({ audio_id, title, display_artist, duration_in_ms, download_url }) => ({
    audioId: audio_id,
    title,
    artist: display_artist,
    seconds: Math.round(duration_in_ms / 1000),
    previewUrl: download_url,
  }));
};

export const publishingQuota = async (graph, igId) => {
  const { data: [usage] } = await graph.get(`${igId}/content_publishing_limit`, { fields: 'config,quota_usage' });
  return { used: usage.quota_usage, total: usage.config.quota_total };
};

export const waitUntilFinished = async (graph, containerId, { sleep, intervalMs = 10_000, timeoutMs = 300_000 }) => {
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    const { status_code: status, status: detail } = await graph.get(containerId, { fields: 'status_code,status' });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new MetaError(`Instagram no procesó el contenido: ${detail ?? status}`);
    await sleep(intervalMs);
  }
  throw new MetaError(`Instagram sigue procesando después de ${Math.round(timeoutMs / 60_000)} min; reintentá «publish» más tarde.`);
};

const isVideo = (post) => post.formato === 'reel' || (post.formato === 'historia' && post.video);

const instagramContainer = async (graph, igId, post, { sleep }) => {
  const details = {
    caption: post.caption,
    location_id: post.locationId,
    collaborators: post.collaborators.length ? post.collaborators.map((handle) => handle.replace(/^@/, '')) : undefined,
  };
  if (post.formato === 'reel') {
    // Por link y con volúmenes, como el ejemplo de la Audio API: con subida reanudable y sin volúmenes, Meta aceptó la música y no la aplicó.
    const container = await graph.post(`${igId}/media`, {
      media_type: 'REELS',
      video_url: post.videoUrl,
      ...details,
      cover_url: post.coverUrl,
      share_to_feed: true,
      audio_configuration: post.audioId ? { audio_id: post.audioId, audio_volume: 100, video_volume: 0 } : undefined,
    });
    return container.id;
  }
  if (post.formato === 'historia') {
    if (!post.video) return (await graph.post(`${igId}/media`, { media_type: 'STORIES', image_url: post.imageUrls[0] })).id;
    const container = await graph.post(`${igId}/media`, { media_type: 'STORIES', upload_type: 'resumable' });
    await graph.upload(container.uri, post.video);
    return container.id;
  }
  if (post.formato === 'imagen') return (await graph.post(`${igId}/media`, { image_url: post.imageUrls[0], ...details })).id;
  const children = [];
  for (const url of post.imageUrls) children.push((await graph.post(`${igId}/media`, { image_url: url, is_carousel_item: true })).id);
  for (const child of children) await waitUntilFinished(graph, child, { sleep });
  return (await graph.post(`${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), ...details })).id;
};

export const publishInstagram = async (graph, igId, post, { sleep }) => {
  const containerId = await instagramContainer(graph, igId, post, { sleep });
  await waitUntilFinished(graph, containerId, { sleep });
  const { id } = await graph.post(`${igId}/media_publish`, { creation_id: containerId });
  // Ya es público: si falla leer el link, devolver el id igual para que publicado.json lo anote.
  const { permalink } = await graph.get(id, { fields: 'permalink' }).catch(() => ({}));
  return { id, permalink };
};

const facebookResult = async (page, id) => {
  const { permalink_url: link } = await page.get(id, { fields: 'permalink_url' }).catch(() => ({}));
  return { id, permalink: link?.startsWith('/') ? `https://www.facebook.com${link}` : link };
};

// Las historias no tienen permalink_url: el link sale de la lista de historias de la página.
const MAX_STORY_PAGES = 10;

const storyResult = async (page, pageId, id) => {
  let after;
  for (let pageNumber = 0; pageNumber < MAX_STORY_PAGES; pageNumber++) {
    const { data = [], paging } = await page.get(`${pageId}/stories`, { fields: 'post_id,url', after }).catch(() => ({}));
    const story = data.find((candidate) => candidate.post_id === id);
    if (story) return { id, permalink: story.url };
    if (!paging?.next || !paging.cursors?.after) break;
    after = paging.cursors.after;
  }
  return { id, permalink: undefined };
};

const unpublishedPhoto = async (page, pageId, url) => (await page.post(`${pageId}/photos`, { url, published: false })).id;

export const publishFacebook = async (page, pageId, post) => {
  const place = post.locationId;
  if (isVideo(post)) {
    const reel = post.formato === 'reel';
    const endpoint = `${pageId}/${reel ? 'video_reels' : 'video_stories'}`;
    const { video_id: videoId, upload_url: uploadUrl } = await page.post(endpoint, { upload_phase: 'start' });
    await page.upload(uploadUrl, post.video);
    const details = reel ? { video_state: 'PUBLISHED', description: post.caption, place } : {};
    const finished = await page.post(endpoint, { upload_phase: 'finish', video_id: videoId, ...details });
    if (finished.success === false) throw new MetaError(`Facebook no confirmó la publicación del video ${videoId}.`);
    // El reel se identifica por el video (su post_id no sirve para leerlo ni borrarlo); la historia, por su post_id.
    return reel ? facebookResult(page, videoId) : storyResult(page, pageId, finished.post_id ?? videoId);
  }
  if (post.formato === 'historia') {
    const photoId = await unpublishedPhoto(page, pageId, post.imageUrls[0]);
    const { post_id: storyId } = await page.post(`${pageId}/photo_stories`, { photo_id: photoId });
    return storyResult(page, pageId, storyId);
  }
  if (post.formato === 'imagen') {
    const { id, post_id: postId } = await page.post(`${pageId}/photos`, { url: post.imageUrls[0], message: post.caption, place });
    return facebookResult(page, postId ?? id);
  }
  const photos = [];
  for (const url of post.imageUrls) photos.push(await unpublishedPhoto(page, pageId, url));
  const { id } = await page.post(`${pageId}/feed`, {
    message: post.caption,
    place,
    attached_media: photos.map((photoId) => ({ media_fbid: photoId })),
  });
  return facebookResult(page, id);
};

export const deleteMedia = async (graph, id) => {
  const { success } = await graph.remove(id);
  if (!success) throw new MetaError(`Meta no confirmó el borrado de ${id}.`);
};
