---
name: social-publisher
description: "Use when a finished social media piece (reel, single image, carousel or story) has to go out to Instagram and Facebook through Meta's API, when a published post has to be deleted, or when music for a reel has to be found. Triggers include «publicalo», «subí este reel», «posteá», «subí la historia», «borrá el post», «buscá música para el reel»."
---

# Publicar en Instagram y Facebook

Reels, imágenes, carruseles e historias salen por la API de Meta con `publicar.mjs`, a la cuenta de Instagram y a la página de Facebook vinculada a ella.

**Cada publicación y cada borrado es público: pedile un OK explícito al usuario para cada uno, después de mostrarle el ensayo.**

## Configuración (una vez por computadora)

En `~/.social-publisher/` (o en la carpeta que diga la variable `SOCIAL_PUBLISHER_CONFIG`), fuera de cualquier repo. Nunca imprimas estos archivos ni los pegues en el chat:
- `meta-system-token.txt`: el token de un usuario del sistema de Meta Business con acceso a una sola página (la que tiene vinculada la cuenta de Instagram). Los pasos están en el README.
- `r2.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Es un bucket privado de Cloudflare R2: Meta descarga de ahí, con un link temporal, las imágenes y el video del reel. El script borra cada archivo al terminar.

ffmpeg y ffprobe: en el PATH (en Windows también sirve el paquete `Gyan.FFmpeg` de WinGet).

## texto.md

Cada pieza es una carpeta con sus archivos y un `texto.md`. Arranca con una cabecera que lee el script. Los textos van bajo `## Instagram` y `## Facebook`, y cada uno termina antes de la línea `Ubicación:`, si la hay.

    ---
    formato: reel                 # reel | imagen | carrusel | historia
    redes: [instagram, facebook]
    musica: { titulo: Fly 15s, artista: Tony Dark Eyes, audio_id: "1358069754759574", facebook: fly-15s.mp3 }
    ubicacion: "123456789012345"  # ID de la página de Facebook del lugar
    colaboradores: [otracuenta]
    video: mi-reel.mp4
    portada: portada.png
    imagenes: [1.png, 2.png, 3.png]
    ---
    ## Instagram

    El texto del post.

    #hashtag #otro

    ## Facebook

    El texto del post.

- `video` para un reel o una historia de video. `portada` en todo reel. `imagenes` en el orden en que se publican: 1 para una imagen o una historia de imagen, de 2 a 10 para un carrusel.
- `musica` solo en reels. `ubicacion` y `colaboradores` no van en historias. `colaboradores` es solo para Instagram: hasta 3, con o sin `@`. Las historias no llevan texto.
- `ubicacion`: el ID de la página de Facebook del lugar (ciudad, local), entre comillas. Se ve en la página del lugar, en «Información» → «Transparencia de la página».
- `musica.facebook`: el mismo tema bajado de la [Sound Collection](https://www.facebook.com/sound/collection/) de Meta y guardado en la carpeta de la pieza. El script lo mezcla en la copia del reel para Facebook, porque la API de reels de Facebook no tiene música. Sin ese archivo, el reel sale en Facebook sin sonido. Como Facebook no muestra la ficha del tema, el script agrega al final del texto «Música: «<titulo>» de <artista>.» (por eso necesita `artista`).
- Medidas: 1080×1350 para imágenes y carruseles; 1080×1920 para reels, portadas e historias.
- Límites de Instagram que controla el script: 5 hashtags y 2200 caracteres.
- La cabecera la lee `texto.mjs`: si cambia el formato, cambiá los dos.

## Publicar

Desde la carpeta de esta skill (`P=<carpeta de la skill>/publicar.mjs`):

1. Si el reel no tiene `musica`: `node $P musica "<búsqueda>"`. Proponele al usuario dos o tres temas con su link para escucharlos y anotá el elegido en `texto.md`. Para Facebook, buscá el mismo tema en la Sound Collection; si no está, avisale al usuario que el reel sale en Facebook sin sonido.
2. `node $P check <carpeta>`: el ensayo, que no publica nada. Corregí cada ERROR. Mostrale al usuario la salida, con los AVISOS que haya, y las imágenes.
3. Con el OK explícito del usuario para esa pieza: `node $P publish <carpeta>`. Si lo corrés desde una herramienta con tiempo límite, dale 10 minutos: un reel espera hasta 5 a que Instagram lo procese. Al terminar imprime los links.
4. Abrí cada link y fijate que estén el texto, la ubicación y, en un reel, la música. Un colaborador tiene que aceptar la invitación para que el post aparezca en su perfil.
5. Si una historia va en un destacado, recordale al usuario que la agregue desde la app: la API no puede.

Si `publish` se corta a la mitad, arreglá la causa y correlo de nuevo. `publicado.json`, en la carpeta de la pieza, anota cada red donde ya salió, y esa red se saltea. No publiques a mano lo que ya figura en ese archivo.

**Música en reels:** el script le manda el reel a Instagram por link, con una pista de audio en silencio y volúmenes explícitos. Sin eso, Meta acepta la música pero publica el reel sin ella.

**El reel en Facebook:** sale por la API, con el tema de `musica.facebook` mezclado, o sin sonido si falta.

## Borrar

Borrar no tiene vuelta atrás: solo cuando el usuario lo pide, para esa pieza.

1. `node $P borrar <carpeta> [instagram|facebook]`: muestra qué borraría (los links de `publicado.json`) y no borra nada.
2. Con el OK explícito del usuario: el mismo comando con `--confirmar`. Cada red borrada sale de `publicado.json`.

Un carrusel se borra entero, nunca una sola imagen. Un nombre de red que no sea `instagram` o `facebook` (en minúsculas) da error; nunca se toma como «las dos».

Si Meta dice que un post no existe (porque se borró a mano), sacá esa red de `publicado.json` a mano y corré el comando de nuevo.

## Tests

`node --test "<carpeta de la skill>/*.test.mjs"`: corren sin red.
