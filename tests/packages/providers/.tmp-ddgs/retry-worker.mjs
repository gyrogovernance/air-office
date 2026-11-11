
import { readFileSync, writeFileSync } from 'node:fs';
const counter = "F:\\Development\\air-office-private\\tests\\packages\\providers\\.tmp-ddgs\\retry-count-1794350718588.txt";
process.stdin.resume();
process.stdin.on('end', () => {
  const hits = Number(readFileSync(counter, 'utf8') || '0') + 1;
  writeFileSync(counter, String(hits));
  if (hits === 1) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Web search could not complete. Try again shortly.' }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    results: [{ title: 'Cake', url: 'https://example.com/cake', snippet: 'A white cake.' }]
  }));
});
