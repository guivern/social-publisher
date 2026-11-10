// Lee el texto.md de una pieza: la cabecera para el script y el texto de cada red.
// La cabecera está documentada en SKILL.md («texto.md»): si cambia, cambiar los dos.

const stripComment = (line) => {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === '#' && !quoted && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};

const splitTopLevel = (text) => {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === '[' || char === '{')) depth++;
    if (!quoted && (char === ']' || char === '}')) depth--;
    if (char === ',' && !quoted && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
};

const parseValue = (raw) => {
  const value = raw.trim();
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new Error(`Lista sin cerrar: ${value}`);
    return splitTopLevel(value.slice(1, -1)).map(parseValue);
  }
  if (value.startsWith('{')) {
    if (!value.endsWith('}')) throw new Error(`Mapa sin cerrar: ${value}`);
    return Object.fromEntries(
      splitTopLevel(value.slice(1, -1)).map((pair) => {
        const colon = pair.indexOf(':');
        if (colon < 0) throw new Error(`Falta «:» en «${pair}».`);
        return [pair.slice(0, colon).trim(), parseValue(pair.slice(colon + 1))];
      }),
    );
  }
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) throw new Error(`Comillas sin cerrar: ${value}`);
    return value.slice(1, -1);
  }
  return value;
};

const parseHeader = (block) =>
  Object.fromEntries(
    block
      .split('\n')
      .map(stripComment)
      .filter((line) => line.trim())
      .map((line) => {
        const colon = line.indexOf(':');
        if (colon < 0) throw new Error(`Cabecera: falta «:» en «${line.trim()}».`);
        return [line.slice(0, colon).trim(), parseValue(line.slice(colon + 1))];
      }),
  );

const section = (body, title) => {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${title.toLowerCase()}`);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2} /.test(line) || /^[\s*_>-]*ubicación[*_]*:/i.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
};

export const parsePiece = (markdown) => {
  const text = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC');
  const match = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!match) throw new Error('texto.md no tiene la cabecera entre «---» (ver «texto.md» en SKILL.md).');
  const body = text.slice(match[0].length);
  return {
    meta: parseHeader(match[1]),
    texts: { instagram: section(body, 'Instagram'), facebook: section(body, 'Facebook') },
  };
};
