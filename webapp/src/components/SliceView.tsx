import { useEffect, useState } from 'react';
import { fetchSlices, type SliceEntry } from '../lib/slices';
import { copyShareLink } from '../lib/share';

interface Props {
  slug: string;
}

type Verdict = 'good' | 'bad' | null;

export function SliceView({ slug }: Props) {
  const [slice, setSlice] = useState<SliceEntry | null | undefined>(
    undefined,
  );
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    fetchSlices().then(
      (all) => setSlice(all.find((s) => s.slug === slug) ?? null),
      () => setSlice(null),
    );
  }, [slug]);

  async function share(): Promise<void> {
    await copyShareLink(slug);
    setShared(true);
    setTimeout(() => setShared(false), 1500);
  }

  if (slice === undefined) return <p className="muted">Loading…</p>;
  if (slice === null) {
    return (
      <p className="error">
        Slice not found: <code>{slug}</code>
      </p>
    );
  }

  return (
    <section className="slice-view">
      <header>
        <h1>{slice.title ?? slice.slug}</h1>
        <p className="muted">{slice.premise}</p>
      </header>

      {slice.publishedUrl ? (
        <iframe
          src={slice.publishedUrl}
          title={slice.title ?? slice.slug}
          allow="gamepad *; fullscreen; accelerometer; gyroscope"
        />
      ) : (
        <p className="muted">
          No published URL on this slice yet. Run{' '}
          <code>npm run preview</code> in <code>games/{slug}/build/</code>{' '}
          and update <code>manifest.playcanvas.publishedUrl</code>.
        </p>
      )}

      <div className="verdict">
        <h2>How does it play?</h2>
        <button
          className={verdict === 'good' ? 'on' : ''}
          onClick={() => setVerdict('good')}
        >
          Plays well
        </button>
        <button
          className={verdict === 'bad' ? 'on' : ''}
          onClick={() => setVerdict('bad')}
        >
          Needs work
        </button>
        <button onClick={share}>{shared ? 'Link copied' : 'Share'}</button>
      </div>

      {verdict === 'bad' && (
        <p className="muted small">
          Open <code>games/{slug}/manifest.json</code>, append a note to
          <code>manifest.playtests</code>, and re-run the orchestrator —
          it'll loop back into <code>scene-assembly</code>.
        </p>
      )}
    </section>
  );
}
