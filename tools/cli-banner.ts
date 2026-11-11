/** AIR OFFICE wordmark for CLI launch. */
const BANNER = [
  
  '▄▀▀▄ ▀█▀ █▀▀▄     ▄▀▀▄  ▄▀▀  ▄▀▀ ▀  ▄▄▄  ▄▄  ',
  '█▀▀█  █  █▀█      █  █ ▀█▀  ▀█▀  █ █    █▀▀▀ ',
  '▀  ▀ ▀▀▀ ▀  ▀      ▀▀   ▀    ▀   ▀  ▀▀▀  ▀▀▀ ',
].join('\n');

/** Prints the launch wordmark when stdout is a color-capable terminal. */
export function printCliBanner(): void {
  if (process.env.NO_COLOR !== undefined) return;
  if (process.env.TERM === 'dumb') return;
  if (!process.stdout.isTTY && process.env.FORCE_COLOR === undefined) return;
  console.log();
  console.log(BANNER);
  console.log();
}
