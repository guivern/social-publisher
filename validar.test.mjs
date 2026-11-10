import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countHashtags, mediaFiles, validatePiece } from './validar.mjs';

const VERTICAL = { width: 1080, height: 1920 };
const FEED = { width: 1080, height: 1350 };
const TEXTS = { instagram: 'Texto.\n\n#odontologia', facebook: 'Texto.' };

const reel = (meta = {}) => ({
  meta: { formato: 'reel', redes: ['instagram', 'facebook'], video: 'v.mp4', portada: 'p.png', ubicacion: '123456789012345', ...meta },
  texts: TEXTS,
});
const reelSizes = { 'v.mp4': VERTICAL, 'p.png': VERTICAL };
const carrusel = (imagenes) => ({ meta: { formato: 'carrusel', redes: ['instagram'], imagenes }, texts: TEXTS });
const feedSizes = (files) => Object.fromEntries(files.map((file) => [file, FEED]));

test('un reel completo pasa', () => assert.deepEqual(validatePiece(reel(), reelSizes), { errors: [], warnings: [] }));

test('un reel sin portada no pasa', () => {
  const { errors } = validatePiece(reel({ portada: undefined }), reelSizes);
  assert.match(errors.join(), /falta «portada»/);
});

test('las medidas equivocadas no pasan y dicen cuánto miden', () => {
  const { errors } = validatePiece(reel(), { 'v.mp4': VERTICAL, 'p.png': FEED });
  assert.match(errors.join(), /p\.png: mide 1080×1350; tiene que medir 1080×1920/);
});

test('un archivo que no está en la carpeta no pasa', () => {
  const { errors } = validatePiece(reel(), { 'v.mp4': VERTICAL });
  assert.match(errors.join(), /p\.png: no existe/);
});

test('el carrusel lleva de 2 a 10 imágenes', () => {
  const one = ['1.png'];
  const eleven = Array.from({ length: 11 }, (_, i) => `${i}.png`);
  assert.match(validatePiece(carrusel(one), feedSizes(one)).errors.join(), /de 2 a 10/);
  assert.match(validatePiece(carrusel(eleven), feedSizes(eleven)).errors.join(), /de 2 a 10/);
  assert.deepEqual(validatePiece(carrusel(['1.png', '2.png']), feedSizes(['1.png', '2.png'])).errors, []);
});

test('Instagram admite hasta 5 hashtags', () => {
  const six = { instagram: '#a #b #c #d #e #f', facebook: 'Texto.' };
  assert.match(validatePiece({ ...reel(), texts: six }, reelSizes).errors.join(), /6 hashtags/);
});

test('el texto de Instagram tiene un máximo de 2.200 caracteres', () => {
  const long = { instagram: 'a'.repeat(2201), facebook: 'Texto.' };
  assert.match(validatePiece({ ...reel(), texts: long }, reelSizes).errors.join(), /2201 caracteres/);
});

test('falta la sección de una red elegida', () => {
  const { errors } = validatePiece({ ...reel(), texts: { instagram: 'Texto.' } }, reelSizes);
  assert.match(errors.join(), /falta la sección «## Facebook»/);
});

test('una ubicación que no es un ID no pasa', () => {
  const { errors } = validatePiece(reel({ ubicacion: 'Luque' }), reelSizes);
  assert.match(errors.join(), /«Luque» no es un ID/);
});

test('la música con Facebook avisa que esa copia va sin música', () => {
  const piece = reel({ musica: { titulo: 'Fly 15s', audio_id: '1358069754759574' } });
  const { errors, warnings } = validatePiece(piece, reelSizes);
  assert.deepEqual(errors, []);
  assert.match(warnings.join(), /Facebook sale sin música \(falta «facebook»/);
});

test('la historia no lleva música, ubicación ni texto', () => {
  const historia = { meta: { formato: 'historia', redes: ['instagram', 'facebook'], imagenes: ['h.png'] }, texts: {} };
  assert.deepEqual(validatePiece(historia, { 'h.png': VERTICAL }).errors, []);
  const conMusica = { ...historia, meta: { ...historia.meta, musica: { audio_id: '1' }, ubicacion: '123456789012345' } };
  const { errors } = validatePiece(conMusica, { 'h.png': VERTICAL });
  assert.match(errors.join(), /«musica» no va/);
  assert.match(errors.join(), /«ubicacion» no va/);
});

test('formato y redes desconocidos no pasan', () => {
  const { errors } = validatePiece({ meta: { formato: 'video', redes: ['tiktok'] }, texts: {} }, {});
  assert.match(errors.join(), /«video» no es/);
  assert.match(errors.join(), /redes:/);
});

test('cuenta hashtags sin contar los «#» sueltos', () => {
  assert.equal(countHashtags('#uno texto #dos\n#tres y un # suelto'), 3);
});

test('lista los archivos de la pieza en orden', () => {
  assert.deepEqual(mediaFiles({ video: 'v.mp4', portada: 'p.png', imagenes: ['1.png'] }), ['v.mp4', 'p.png', '1.png']);
});

test('una red repetida no pasa', () => {
  const { errors } = validatePiece(reel({ redes: ['instagram', 'instagram'] }), reelSizes);
  assert.match(errors.join(), /redes: .*repetida/);
});

test('la música sin título no pasa: check la busca por título', () => {
  const { errors } = validatePiece(reel({ musica: { audio_id: '1358069754759574' } }), reelSizes);
  assert.match(errors.join(), /musica: falta «titulo»/);
});

test('la música con archivo para Facebook no avisa que esa copia sale muda', () => {
  const piece = reel({ musica: { titulo: 'Fly 15s', artista: 'Tony Dark Eyes', audio_id: '1358069754759574', facebook: 'fly-15s.mp3' } });
  assert.deepEqual(validatePiece(piece, reelSizes).warnings, []);
});

test('la música para Facebook solo va si el reel sale en Facebook', () => {
  const piece = reel({ redes: ['instagram'], musica: { titulo: 'Fly 15s', artista: 'Tony Dark Eyes', audio_id: '1358069754759574', facebook: 'fly-15s.mp3' } });
  assert.match(validatePiece(piece, reelSizes).warnings.join(), /no sale en Facebook/);
});

test('un colaborador con «@» se acepta sin la arroba', () => {
  assert.deepEqual(validatePiece(reel({ colaboradores: ['@otracuenta'] }), reelSizes).errors, []);
});

test('la música para Facebook necesita el artista: va nombrado en el texto', () => {
  const piece = reel({ musica: { titulo: 'Fly 15s', audio_id: '1358069754759574', facebook: 'fly.mp3' } });
  assert.match(validatePiece(piece, reelSizes).errors.join(), /falta «artista»/);
});

test('sin Facebook en redes, la falta de artista no frena', () => {
  const piece = reel({ redes: ['instagram'], musica: { titulo: 'Fly 15s', audio_id: '1358069754759574', facebook: 'fly.mp3' } });
  assert.deepEqual(validatePiece(piece, reelSizes).errors, []);
});
