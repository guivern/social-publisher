#!/usr/bin/env node
// Publica una pieza de redes por la API de Meta. Cómo se usa y cuándo: SKILL.md de esta skill.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMusic, addSilentAudio, imageSize, toJpeg, videoSize } from './media.mjs';
import { createGraph, deleteMedia, publishFacebook, publishInstagram, publishingQuota, redact, resolveAccounts, searchMusic } from './meta.mjs';
import { createR2, objectKey, readEnvFile } from './r2.mjs';
import { parsePiece } from './texto.mjs';
import { asList, mediaFiles, validatePiece } from './validar.mjs';

const CONFIG_DIR = process.env.PUBLICAR_EN_REDES_CONFIG ?? join(homedir(), '.publicar-en-redes');
const NETWORK_TITLES = { instagram: 'Instagram', facebook: 'Facebook' };

// Un nombre con tilde bajado de Drive o de una Mac puede quedar en NFD en el disco.
const filePath = (dir, file, deps) => {
  const path = join(dir, String(file));
  const decomposed = join(dir, String(file).normalize('NFD'));
  return !deps.exists(path) && deps.exists(decomposed) ? decomposed : path;
};

const readPublished = (dir, deps) => {
  const path = join(dir, 'publicado.json');
  return deps.exists(path) ? JSON.parse(deps.readFile(path, 'utf8')) : {};
};

// Facebook no muestra la ficha del tema cuando la música va dentro del video: se nombra al final del texto.
const captionFor = (red, meta, texts) => {
  const { musica } = meta;
  if (red !== 'facebook' || meta.formato !== 'reel' || !musica?.facebook || !texts.facebook) return texts[red];
  return `${texts.facebook}\n\nMúsica: «${musica.titulo}» de ${musica.artista}.`;
};

const summary = (piece, sizes, extra) => {
  const { meta, texts } = piece;
  const describe = (size) => (!size ? 'no está' : size.error ? 'no se puede medir' : `${size.width}×${size.height}`);
  const files = mediaFiles(meta).map((file) => `${file} (${describe(sizes[file])})`);
  const lines = [
    `Pieza: ${meta.formato} · ${asList(meta.redes).join(', ')}`,
    `Archivos: ${files.join(', ')}`,
    meta.musica && `Música: ${meta.musica.titulo ?? ''} — ${meta.musica.artista ?? ''} (${meta.musica.audio_id})`,
    meta.musica?.facebook && `Música en Facebook: ${meta.musica.facebook}, mezclada en el video`,
    meta.ubicacion && `Ubicación: ${meta.ubicacion}`,
    asList(meta.colaboradores).length && `Colaboradores: ${asList(meta.colaboradores).join(', ')}`,
    ...extra,
  ];
  if (meta.formato === 'historia') lines.push('Texto: ninguno (las historias no lo llevan).');
  else for (const red of asList(meta.redes)) if (texts[red]) lines.push(`--- ${NETWORK_TITLES[red] ?? red} ---`, captionFor(red, meta, texts));
  return lines.filter(Boolean).join('\n');
};

export const check = async (dir, deps) => {
  const piece = parsePiece(deps.readFile(join(dir, 'texto.md'), 'utf8'));
  const sizes = {};
  for (const file of mediaFiles(piece.meta)) {
    const path = filePath(dir, file, deps);
    if (!deps.exists(path)) continue;
    try {
      sizes[file] = deps.sizeOf(path);
    } catch (error) {
      sizes[file] = { error: error.message };
    }
  }
  const { errors, warnings } = validatePiece(piece, sizes);
  const musicForFacebook = asList(piece.meta.redes).includes('facebook') ? piece.meta.musica?.facebook : undefined;
  if (musicForFacebook && !deps.exists(filePath(dir, musicForFacebook, deps))) errors.push(`${musicForFacebook}: no existe en la carpeta.`);
  if (musicForFacebook && /^música:/im.test(piece.texts.facebook ?? ''))
    warnings.push('Facebook: el texto ya nombra la música y el script suma esa línea; sacala de texto.md o saldrá dos veces.');

  const extra = [];
  const published = readPublished(dir, deps);
  for (const [red, { permalink, id }] of Object.entries(published)) extra.push(`Ya publicado en ${red} (se saltea): ${permalink ?? id}`);
  const instagramPending = asList(piece.meta.redes).includes('instagram') && !published.instagram;
  // Conectar valida el token aunque la pieza sea solo de Facebook.
  const { graph, accounts } = errors.length ? {} : await deps.connect();
  if (!errors.length && instagramPending) {
    const { used, total } = await publishingQuota(graph, accounts.igId);
    extra.push(`Cupo de Instagram: ${used} de ${total} en 24 h`);
    if (used >= total) errors.push('Instagram: no queda cupo de publicaciones en las últimas 24 h.');
    const { musica } = piece.meta;
    if (musica?.audio_id) {
      const found = await searchMusic(graph, accounts.igId, musica.titulo ?? musica.audio_id);
      if (!found.some(({ audioId }) => audioId === musica.audio_id))
        errors.push(`musica: «${musica.titulo}» (${musica.audio_id}) ya no está en la biblioteca de Meta.`);
    }
  }

  deps.log(summary(piece, sizes, extra));
  for (const warning of warnings) deps.log(`AVISO  ${warning}`);
  for (const error of errors) deps.log(`ERROR  ${error}`);
  return { ok: !errors.length, piece, errors, warnings };
};

export const publish = async (dir, deps) => {
  const { ok, piece } = await check(dir, deps);
  if (!ok) return false;
  const { meta, texts } = piece;
  const done = readPublished(dir, deps);
  const pending = asList(meta.redes).filter((red) => !done[red]);
  if (!pending.length) {
    deps.log('Ya estaba todo publicado.');
    return true;
  }

  const { graph, page, accounts } = await deps.connect();
  const uploaded = [];
  const jpgDir = deps.tempDir();
  const stage = async (file, name) => {
    let path = filePath(dir, file, deps);
    if (extname(file).toLowerCase() === '.png') {
      const jpg = join(jpgDir, `${name}.jpg`);
      deps.toJpeg(path, jpg);
      path = jpg;
    }
    const key = objectKey(basename(resolve(dir)), deps.now(), `${name}.jpg`);
    await deps.r2.put(key, deps.readFile(path), 'image/jpeg');
    uploaded.push(key);
    return deps.r2.presign(key);
  };

  try {
    const imageUrls = [];
    for (const [index, file] of asList(meta.imagenes).entries()) imageUrls.push(await stage(file, String(index + 1)));
    const coverUrl = meta.portada && pending.includes('instagram') ? await stage(meta.portada, 'portada') : undefined;
    const video = meta.video ? deps.readFile(filePath(dir, meta.video, deps)) : undefined;
    let videoUrl;
    if (meta.formato === 'reel' && pending.includes('instagram')) {
      // El render sale sin pista de audio; con música, se le suma una en silencio para que Meta tenga dónde mezclarla.
      let path = filePath(dir, meta.video, deps);
      if (meta.musica) {
        path = join(jpgDir, 'video.mp4');
        deps.addSilentAudio(filePath(dir, meta.video, deps), path);
      }
      const key = objectKey(basename(resolve(dir)), deps.now(), 'video.mp4');
      await deps.r2.put(key, deps.readFile(path), 'video/mp4');
      uploaded.push(key);
      videoUrl = deps.r2.presign(key);
    }
    // La API de reels de Facebook no tiene música: va mezclada en el archivo (licencia de la Sound Collection de Meta).
    let facebookVideo = video;
    if (meta.formato === 'reel' && meta.musica?.facebook && pending.includes('facebook')) {
      const mixed = join(jpgDir, 'facebook.mp4');
      deps.addMusic(filePath(dir, meta.video, deps), filePath(dir, meta.musica.facebook, deps), mixed);
      facebookVideo = deps.readFile(mixed);
    }
    for (const red of pending) {
      const post = {
        formato: meta.formato,
        caption: captionFor(red, meta, texts),
        locationId: meta.ubicacion,
        collaborators: asList(meta.colaboradores),
        imageUrls,
        coverUrl,
        video: red === 'facebook' ? facebookVideo : video,
        videoUrl,
        audioId: meta.musica?.audio_id,
      };
      const result = red === 'instagram'
        ? await deps.publishInstagram(graph, accounts.igId, post, deps)
        : await deps.publishFacebook(page, accounts.pageId, post);
      done[red] = { ...result, fecha: deps.now().toISOString() };
      deps.log(`PUBLICADO en ${NETWORK_TITLES[red]}: ${result.permalink ?? result.id}`);
      try {
        deps.writeFile(join(dir, 'publicado.json'), `${JSON.stringify(done, null, 2)}\n`);
      } catch (error) {
        throw new Error(`No pude anotar publicado.json (${error.message}): no reintentes «publish» sin anotarlo a mano, o ${NETWORK_TITLES[red]} sale dos veces.`);
      }
    }
  } finally {
    for (const key of uploaded)
      await deps.r2.remove(key).catch(() => deps.log(`AVISO  no pude borrar ${key} de R2; la regla del bucket lo borra en un día.`));
    rmSync(jpgDir, { recursive: true, force: true });
  }
  return true;
};

export const borrar = async (dir, args, deps) => {
  const unknown = args.filter((arg) => arg !== '--confirmar' && !NETWORK_TITLES[arg]);
  if (unknown.length) throw new Error(`«${unknown.join(' ')}» no es una red: usá instagram o facebook (en minúsculas), o nada para las dos.`);
  const confirmed = args.includes('--confirmar');
  const done = readPublished(dir, deps);
  const asked = args.filter((arg) => NETWORK_TITLES[arg]);
  const targets = Object.keys(done).filter((red) => !asked.length || asked.includes(red));
  if (!targets.length) {
    deps.log('No hay nada publicado para borrar en publicado.json.');
    return true;
  }
  for (const red of targets) deps.log(`${confirmed ? 'Borrando' : 'Se borraría'} en ${NETWORK_TITLES[red]}: ${done[red].permalink ?? done[red].id}`);
  if (!confirmed) {
    deps.log('Nada se borró. Con el OK del usuario, repetí el comando con --confirmar.');
    return true;
  }
  const { graph, page } = await deps.connect();
  for (const red of targets) {
    await deps.deleteMedia(red === 'instagram' ? graph : page, done[red].id);
    delete done[red];
    try {
      deps.writeFile(join(dir, 'publicado.json'), `${JSON.stringify(done, null, 2)}\n`);
    } catch (error) {
      throw new Error(`BORRADO en ${NETWORK_TITLES[red]}, pero no pude anotarlo en publicado.json (${error.message}): sacá «${red}» a mano antes de reintentar.`);
    }
    deps.log(`BORRADO en ${NETWORK_TITLES[red]}.`);
  }
  return true;
};

export const musica = async (query, deps) => {
  const { graph, accounts } = await deps.connect();
  return searchMusic(graph, accounts.igId, query);
};

const readToken = () => readFileSync(join(CONFIG_DIR, 'meta-system-token.txt'), 'utf8').replace(/^\uFEFF/, '').trim();

const defaultDeps = () => {
  let connection;
  let r2;
  return {
    readFile: readFileSync,
    writeFile: writeFileSync,
    exists: existsSync,
    sizeOf: (path) => (extname(path).toLowerCase() === '.mp4' ? videoSize(path) : imageSize(readFileSync(path))),
    toJpeg,
    addSilentAudio,
    addMusic,
    tempDir: () => mkdtempSync(join(tmpdir(), 'publicar-en-redes-')),
    now: () => new Date(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: (text) => console.log(redact(text)),
    get r2() {
      const envPath = join(CONFIG_DIR, 'r2.env');
      r2 ??= createR2(readEnvFile(envPath), { source: envPath });
      return r2;
    },
    connect: () => {
      connection ??= (async () => {
        const graph = createGraph(readToken());
        const accounts = await resolveAccounts(graph);
        return { graph, page: graph.withToken(accounts.pageToken), accounts };
      })();
      return connection;
    },
    publishInstagram,
    publishFacebook,
    deleteMedia,
  };
};

const USAGE = `Uso:
  node publicar.mjs check   <carpeta>    ensayo: valida y muestra qué va a salir, sin publicar
  node publicar.mjs publish <carpeta>    publica (solo con el OK del usuario)
  node publicar.mjs musica  "<búsqueda>" busca música en la biblioteca de Meta
  node publicar.mjs borrar  <carpeta> [instagram|facebook] [--confirmar]
                                         muestra qué borraría; borra solo con --confirmar`;

const main = async ([command, argument, ...rest]) => {
  const deps = defaultDeps();
  if (command === 'check' && argument) return (await check(argument, deps)).ok ? 0 : 1;
  if (command === 'publish' && argument) return (await publish(argument, deps)) ? 0 : 1;
  if (command === 'borrar' && argument) return (await borrar(argument, rest, deps)) ? 0 : 1;
  if (command === 'musica' && argument) {
    for (const { title, artist, seconds, audioId, previewUrl } of await musica(argument, deps))
      deps.log(`${title} — ${artist} · ${seconds} s · audio_id ${audioId}\n  escuchar: ${previewUrl}`);
    return 0;
  }
  console.log(USAGE);
  return 2;
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`ERROR  ${redact(error.message)}`);
      process.exit(1);
    },
  );
