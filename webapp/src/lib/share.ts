export async function copyShareLink(slug: string): Promise<void> {
  const url = `${location.origin}${location.pathname}#/slice/${slug}`;
  await navigator.clipboard.writeText(url);
}
