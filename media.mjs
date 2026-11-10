// Medidas y conversión de los archivos de una pieza, con ffmpeg y ffprobe.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PNG_SIGNATURE = 0x89504e47;
const isStartOfFrame = (marker) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

export const imageSize = (buffer) => {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === PNG_SIGNATURE)
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= buffer.length) {
      if (buffer[offset] !== 0xff || buffer[offset + 1] === 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (isStartOfFrame(marker))
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  throw new Error('No es un PNG ni un JPEG.');
};

export const findTool = (name) => {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
    return name;
  } catch {
    // No está en el PATH: se busca en la carpeta de WinGet.
  }
  const packages = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(packages))
    for (const pkg of readdirSync(packages).filter((dir) => dir.startsWith('Gyan.FFmpeg')))
      for (const build of readdirSync(join(packages, pkg))) {
        const exe = join(packages, pkg, build, 'bin', `${name}.exe`);
        if (existsSync(exe)) return exe;
      }
  throw new Error(`No encuentro ${name}: instalá ffmpeg (Windows: «winget install Gyan.FFmpeg»; Mac: «brew install ffmpeg»; Linux: el gestor de paquetes).`);
};

export const videoSize = (path) => {
  const output = execFileSync(
    findTool('ffprobe'),
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', path],
    { encoding: 'utf8' },
  );
  const [width, height] = output.trim().split('x').map(Number);
  return { width, height };
};

export const addSilentAudio = (mp4Path, outPath) =>
  execFileSync(findTool('ffmpeg'), [
    '-loglevel', 'error', '-y', '-i', mp4Path, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-shortest', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath,
  ]);

// La música queda del largo del video: se corta si dura más y se completa con silencio si dura menos.
export const addMusic = (mp4Path, musicPath, outPath) =>
  execFileSync(findTool('ffmpeg'), [
    '-loglevel', 'error', '-y', '-i', mp4Path, '-i', musicPath, '-map', '0:v', '-map', '1:a', '-af', 'apad',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outPath,
  ]);

// Una zona transparente del PNG sale blanca, no negra: JPEG no tiene transparencia.
export const toJpeg = (pngPath, jpgPath) =>
  execFileSync(findTool('ffmpeg'), [
    '-loglevel', 'error', '-y', '-i', pngPath,
    '-filter_complex', '[0]split[a][b];[a]drawbox=c=white:t=fill[bg];[bg][b]overlay=format=auto,format=yuvj420p',
    '-q:v', '1', jpgPath,
  ]);
