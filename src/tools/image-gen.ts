import OpenAI from 'openai';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface GenerateConceptImageOptions {
  prompt: string;
  outputPath: string;
  model?: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  n?: number;
}

export interface ConceptImageResult {
  imagePath: string;
  variantPaths: string[];
  model: string;
  prompt: string;
}

const DEFAULT_MODEL = process.env.PLAYGEN_IMAGE_MODEL ?? 'gpt-image-2';

export async function generateConceptImage(
  opts: GenerateConceptImageOptions,
): Promise<ConceptImageResult> {
  const client = new OpenAI();
  const model = opts.model ?? DEFAULT_MODEL;
  const n = opts.n ?? 1;

  const response = await client.images.generate({
    model,
    prompt: opts.prompt,
    size: opts.size ?? '1024x1024',
    n,
  });

  const data = (response as { data?: Array<{ b64_json?: string; url?: string }> }).data ?? [];
  if (data.length === 0) {
    throw new Error('image-gen returned no images');
  }

  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });

  const paths: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const target = i === 0
      ? opts.outputPath
      : opts.outputPath.replace(/(\.[^.]+)?$/, `-${i}$1`);
    const buf = await itemToBuffer(data[i]!);
    await fs.writeFile(target, buf);
    paths.push(target);
  }

  return {
    imagePath: paths[0]!,
    variantPaths: paths.slice(1),
    model,
    prompt: opts.prompt,
  };
}

async function itemToBuffer(item: { b64_json?: string; url?: string }): Promise<Buffer> {
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`image url fetch ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('image-gen response had neither b64_json nor url');
}
