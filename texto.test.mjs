import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePiece } from './texto.mjs';

const REEL = `---
formato: reel                 # reel | imagen | carrusel | historia
redes: [instagram, facebook]
musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "1358069754759574" }
ubicacion: "123456789012345"
colaboradores: [otracuenta]
video: mi-reel.mp4
portada: portada.png
---
# Mi primer reel · reel

## Formato

- Reel vertical.

## Instagram

Un texto de prueba.

Escribinos desde el link de la bio

#prueba #reels

Ubicación: Centro

## Facebook

Un texto de prueba.

Escribinos: ejemplo.com/contacto

Ubicación: Centro
`;

test('lee la cabecera: escalares, listas, mapas y comentarios', () => {
  const { meta } = parsePiece(REEL);
  assert.deepEqual(meta, {
    formato: 'reel',
    redes: ['instagram', 'facebook'],
    musica: { titulo: 'Fly 15s', artista: 'Tony Dark Eyes', audio_id: '1358069754759574' },
    ubicacion: '123456789012345',
    colaboradores: ['otracuenta'],
    video: 'mi-reel.mp4',
    portada: 'portada.png',
  });
});

test('el texto de cada red termina antes de «Ubicación:» y no confunde hashtags con títulos', () => {
  const { texts } = parsePiece(REEL);
  assert.equal(texts.instagram, 'Un texto de prueba.\n\nEscribinos desde el link de la bio\n\n#prueba #reels');
  assert.equal(texts.facebook, 'Un texto de prueba.\n\nEscribinos: ejemplo.com/contacto');
});

test('un texto.md de Windows (BOM y CRLF) se lee igual', () => {
  assert.deepEqual(parsePiece('\uFEFF' + REEL.replace(/\n/g, '\r\n')), parsePiece(REEL));
});

test('una red sin sección queda sin texto', () => {
  const { texts } = parsePiece('---\nformato: historia\nredes: [instagram]\nimagenes: [1.png]\n---\n');
  assert.deepEqual(texts, { instagram: undefined, facebook: undefined });
});

test('sin cabecera, o con una lista sin cerrar, avisa', () => {
  assert.throws(() => parsePiece('# Sin cabecera\n'), /cabecera/);
  assert.throws(() => parsePiece('---\nredes: [instagram\n---\n'), /sin cerrar/);
});

test('«Ubicación:» con negrita, viñeta o cita también corta el texto', () => {
  for (const line of ['**Ubicación:** Centro', '- Ubicación: Centro', '> Ubicación: Centro', '_Ubicación:_ Centro']) {
    const { texts } = parsePiece(`---\nformato: imagen\n---\n## Instagram\n\nTexto.\n\n${line}\n`);
    assert.equal(texts.instagram, 'Texto.', line);
  }
});

test('un texto.md en NFD (Mac, Drive) se normaliza', () => {
  const { meta } = parsePiece('---\nvideo: canción.mp4\n---\n'.normalize('NFD'));
  assert.equal(meta.video, 'canción.mp4');
});
