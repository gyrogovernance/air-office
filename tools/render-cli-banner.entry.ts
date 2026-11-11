/** Renders assets/air-office-banner.txt as a fixed-cell SVG (markdown-safe). */
const lines = (await Bun.file(new URL('../assets/air-office-banner.txt', import.meta.url)).text())
  .replace(/\r/g, '')
  .trimEnd()
  .split('\n');

const cellW = 8;
const cellH = 16;
const cols = Math.max(...lines.map((line) => [...line].length));
const rows = lines.length;
const width = cols * cellW;
const height = rows * cellH;
const bg = '#1a1a1a';
const ink = '#e8e8e8';
const mid = '#aaaaaa';
const dark = '#555555';

const parts: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="AIR OFFICE">`,
  `<rect width="100%" height="100%" fill="${bg}"/>`,
];

for (let y = 0; y < rows; y += 1) {
  const chars = [...lines[y]!];
  for (let x = 0; x < chars.length; x += 1) {
    const ch = chars[x]!;
    const X = x * cellW;
    const Y = y * cellH;
    if (ch === ' ') continue;
    if (ch === '█') parts.push(`<rect x="${X}" y="${Y}" width="${cellW}" height="${cellH}" fill="${ink}"/>`);
    else if (ch === '▄') parts.push(`<rect x="${X}" y="${Y + cellH / 2}" width="${cellW}" height="${cellH / 2}" fill="${ink}"/>`);
    else if (ch === '▀') parts.push(`<rect x="${X}" y="${Y}" width="${cellW}" height="${cellH / 2}" fill="${ink}"/>`);
    else if (ch === '░') parts.push(`<rect x="${X}" y="${Y}" width="${cellW}" height="${cellH}" fill="${mid}" opacity="0.45"/>`);
    else if (ch === '▒') parts.push(`<rect x="${X}" y="${Y}" width="${cellW}" height="${cellH}" fill="${mid}" opacity="0.75"/>`);
    else if (ch === '▓') parts.push(`<rect x="${X}" y="${Y}" width="${cellW}" height="${cellH}" fill="${dark}"/>`);
  }
}

parts.push('</svg>');
const out = new URL('../assets/air-office-banner.svg', import.meta.url);
await Bun.write(out, `${parts.join('')}\n`);
console.log(`wrote ${out.pathname} (${width}x${height})`);
