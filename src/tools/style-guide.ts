import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StyleGuide } from '../types/manifest.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5-20251001';

export async function extractStyleGuide(
  imagePath: string,
): Promise<StyleGuide | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const buf = await fs.readFile(imagePath);
  const b64 = buf.toString('base64');
  const ext = path.extname(imagePath).slice(1).toLowerCase() || 'png';
  const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system:
        'Extract visual style attributes from the image. Respond with ONLY a JSON object on a single line, no commentary, no code fences: {"palette":["#hex","#hex","#hex"],"lighting":"<phrase>","perspective":"<phrase>","scale":"<phrase>","mood":"<phrase>","era":"<optional phrase>"}.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: b64 },
            },
            { type: 'text', text: 'Extract the style guide.' },
          ],
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (json.content ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
  const match = text.match(/\{[^]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<StyleGuide>;
    if (!Array.isArray(parsed.palette)) return null;
    return {
      palette: parsed.palette.map((s) => String(s)),
      lighting: String(parsed.lighting ?? ''),
      perspective: String(parsed.perspective ?? ''),
      scale: String(parsed.scale ?? ''),
      mood: String(parsed.mood ?? ''),
      era: parsed.era ? String(parsed.era) : undefined,
    };
  } catch {
    return null;
  }
}

export function styleGuidePromptSuffix(g: StyleGuide | undefined): string {
  if (!g) return '';
  const parts = [
    g.palette.length > 0 ? `palette ${g.palette.join(', ')}` : '',
    g.lighting ? `${g.lighting} lighting` : '',
    g.perspective,
    g.mood ? `${g.mood} mood` : '',
    g.era,
  ].filter(Boolean);
  if (parts.length === 0) return '';
  return ` Style: ${parts.join(', ')}.`;
}
