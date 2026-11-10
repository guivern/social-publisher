// Reglas de una pieza antes de publicarla: medidas y límites de Meta.

const FORMATS = ['reel', 'imagen', 'carrusel', 'historia'];
const NETWORK_TITLES = { instagram: 'Instagram', facebook: 'Facebook' };
const VERTICAL = { width: 1080, height: 1920 };
const FEED = { width: 1080, height: 1350 };
const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 5;
const MAX_COLLABORATORS = 3;
const NOT_IN_STORIES = ['musica', 'ubicacion', 'colaboradores', 'portada'];

export const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export const countHashtags = (text) => (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

export const mediaFiles = (meta) => [meta.video, meta.portada, ...asList(meta.imagenes)].filter(Boolean);

export const validatePiece = ({ meta, texts }, sizes) => {
  const errors = [];
  const warnings = [];
  const { formato } = meta;
  const redes = asList(meta.redes);
  const imagenes = asList(meta.imagenes);

  const expectSize = (file, expected) => {
    const actual = sizes[file];
    if (!actual) errors.push(`${file}: no existe en la carpeta.`);
    else if (actual.error) errors.push(`${file}: ${actual.error}`);
    else if (actual.width !== expected.width || actual.height !== expected.height)
      errors.push(`${file}: mide ${actual.width}×${actual.height}; tiene que medir ${expected.width}×${expected.height}.`);
  };

  if (!FORMATS.includes(formato)) errors.push(`formato: «${formato ?? ''}» no es reel, imagen, carrusel ni historia.`);
  if (!redes.length || redes.some((red) => !NETWORK_TITLES[red]))
    errors.push('redes: tiene que ser instagram, facebook o las dos.');
  if (new Set(redes).size !== redes.length) errors.push('redes: hay una red repetida; se publicaría dos veces.');

  if (formato === 'reel') {
    if (meta.video) expectSize(meta.video, VERTICAL);
    else errors.push('reel: falta «video».');
    if (meta.portada) expectSize(meta.portada, VERTICAL);
    else errors.push('reel: falta «portada» (cada reel lleva la suya).');
    if (imagenes.length) errors.push('reel: «imagenes» no va; la portada va en «portada».');
  }
  if (formato === 'imagen') {
    if (imagenes.length !== 1) errors.push(`imagen: «imagenes» lleva una, no ${imagenes.length}.`);
    imagenes.forEach((file) => expectSize(file, FEED));
  }
  if (formato === 'carrusel') {
    if (imagenes.length < 2 || imagenes.length > 10) errors.push(`carrusel: lleva de 2 a 10 imágenes, no ${imagenes.length}.`);
    imagenes.forEach((file) => expectSize(file, FEED));
  }
  if (formato === 'historia') {
    if (Boolean(meta.video) === imagenes.length > 0 || imagenes.length > 1)
      errors.push('historia: lleva un «video» o una imagen en «imagenes», no las dos.');
    if (meta.video) expectSize(meta.video, VERTICAL);
    imagenes.forEach((file) => expectSize(file, VERTICAL));
    for (const field of NOT_IN_STORIES)
      if (meta[field] !== undefined) errors.push(`historia: «${field}» no va (la API no lo admite en historias).`);
  }

  if (meta.musica !== undefined && formato !== 'historia') {
    if (formato !== 'reel') errors.push('musica: solo va en reels.');
    else if (!/^\d+$/.test(meta.musica.audio_id ?? '')) errors.push('musica: falta «audio_id» (buscalo con «musica»).');
    else if (!meta.musica.titulo) errors.push('musica: falta «titulo» (check busca el tema por título; copialo de «musica»).');
    else if (meta.musica.facebook && redes.includes('facebook') && !meta.musica.artista)
      errors.push('musica: falta «artista» (la copia de Facebook nombra el tema y el artista en el texto).');
    else if (redes.includes('facebook') && !meta.musica.facebook)
      warnings.push('musica: la copia de Facebook sale sin música (falta «facebook» con el archivo de la Sound Collection).');
    else if (!redes.includes('facebook') && meta.musica.facebook)
      warnings.push('musica: «facebook» no se usa, porque el reel no sale en Facebook.');
  }
  if (meta.ubicacion !== undefined && formato !== 'historia' && !/^\d+$/.test(meta.ubicacion))
    errors.push(`ubicacion: «${meta.ubicacion}» no es un ID; va el ID de la página de Facebook del lugar, entre comillas.`);
  const collaborators = asList(meta.colaboradores);
  if (collaborators.length > MAX_COLLABORATORS)
    errors.push(`colaboradores: hasta ${MAX_COLLABORATORS}, no ${collaborators.length}.`);

  if (formato !== 'historia')
    for (const red of redes.filter((name) => NETWORK_TITLES[name])) {
      const text = texts[red];
      if (!text) {
        errors.push(`texto: falta la sección «## ${NETWORK_TITLES[red]}».`);
        continue;
      }
      if (red === 'instagram') {
        const hashtags = countHashtags(text);
        if (hashtags > MAX_HASHTAGS) errors.push(`Instagram: ${hashtags} hashtags; el máximo es ${MAX_HASHTAGS}.`);
        const length = [...text].length;
        if (length > MAX_CAPTION) errors.push(`Instagram: el texto tiene ${length} caracteres; el máximo es ${MAX_CAPTION}.`);
      }
    }

  return { errors, warnings };
};
