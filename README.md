# publicar-en-redes

Una skill para Claude Code que publica reels, imágenes, carruseles e historias en Instagram y Facebook por la API de Meta. También borra posts y busca música para los reels.

Claude prepara la pieza y corre el ensayo (`check`). Publica solo cuando le das el OK.

## Instalación

1. Copiá esta carpeta a `~/.claude/skills/publicar-en-redes/` (o a `.claude/skills/` de un proyecto).
2. Instalá [Node.js](https://nodejs.org) 20 o más nuevo y ffmpeg (Windows: `winget install Gyan.FFmpeg`; Mac: `brew install ffmpeg`).
3. Creá la carpeta `~/.publicar-en-redes/` con los dos archivos de abajo. Si querés otra carpeta, poné su ruta en la variable de entorno `PUBLICAR_EN_REDES_CONFIG`.

Esos dos archivos son credenciales: no los subas a ningún repo ni los compartas.

### `meta-system-token.txt`: el token de Meta

Necesitás una cuenta de Instagram profesional (de empresa o de creador) vinculada a una página de Facebook, y las dos en un portfolio de Meta Business.

1. En [developers.facebook.com](https://developers.facebook.com/apps), creá una app de tipo **Empresa** y asociala a tu portfolio.
2. En [Configuración del negocio](https://business.facebook.com/settings) → **Usuarios del sistema**, creá un usuario del sistema (administrador o empleado).
3. Asignale la app y **solo tu página** (con control total) y la cuenta de Instagram. El script exige que el token vea una sola página.
4. Generá un token para la app, sin vencimiento, con estos permisos: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish` e `instagram_manage_contents` (este último sirve para borrar).
5. Guardá el token, solo el texto y sin nada más, en `meta-system-token.txt`.

Si el token se filtra, revocalo en el mismo lugar donde lo generaste.

### `r2.env`: el bucket de Cloudflare R2

Meta descarga las imágenes y los videos desde un link, así que el script los sube un rato a un bucket privado y le pasa a Meta un link firmado que vence en una hora. Al terminar los borra.

1. En Cloudflare → R2, creá un bucket privado. Conviene agregarle una regla de ciclo de vida que borre los objetos después de un día, por si algo queda.
2. Creá un token de API de R2 con permiso de lectura y escritura **solo sobre ese bucket**.
3. Escribí `r2.env` así:

```
R2_ACCOUNT_ID=tu-account-id
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=nombre-del-bucket
```

El plan gratis de R2 alcanza de sobra.

## Uso

Pedile a Claude «publicá la pieza de la carpeta X». También podés correrlo a mano:

```
node publicar.mjs check   <carpeta>                ensayo: valida y muestra qué va a salir
node publicar.mjs publish <carpeta>                publica
node publicar.mjs musica  "<búsqueda>"             busca música en la biblioteca de Meta
node publicar.mjs borrar  <carpeta> [instagram|facebook] [--confirmar]
```

El formato de la carpeta y de `texto.md` está en [SKILL.md](SKILL.md).

## Tests

```
node --test "*.test.mjs"
```

Corren sin red y sin credenciales.

## Licencia

MIT. Ver [LICENSE](LICENSE).
