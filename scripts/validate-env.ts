const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MESHY_API_KEY',
  'PLAYCANVAS_API_KEY',
  'PLAYCANVAS_PROJECT_ID',
] as const;

const OPTIONAL = [
  'PLAYGEN_IMAGE_MODEL',
  'PLAYCANVAS_MCP_PORT',
  'PLAYWRIGHT_HEADLESS',
] as const;

const missing = REQUIRED.filter((k) => !process.env[k]);

for (const k of REQUIRED) {
  process.stdout.write(`${k}: ${process.env[k] ? 'set' : 'MISSING'}\n`);
}
for (const k of OPTIONAL) {
  process.stdout.write(`${k}: ${process.env[k] ?? '(default)'}\n`);
}

if (missing.length > 0) {
  process.stderr.write(`\nMissing required env vars: ${missing.join(', ')}\n`);
  process.exit(1);
}
