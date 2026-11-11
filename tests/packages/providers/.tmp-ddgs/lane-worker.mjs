
process.stdin.resume();
process.stdin.on('end', async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  process.stdout.write(JSON.stringify({
    ok: true,
    results: [{ title: 'One', url: 'https://example.com/one', snippet: 'ok' }]
  }));
});
