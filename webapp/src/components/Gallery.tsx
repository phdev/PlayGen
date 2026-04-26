import { useEffect, useState } from 'react';
import { fetchSlices, type SliceEntry } from '../lib/slices';

export function Gallery() {
  const [slices, setSlices] = useState<SliceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSlices().then(
      (s) => setSlices(s),
      (err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  if (error) {
    return (
      <section>
        <h1>Gallery</h1>
        <p className="error">Failed to load slices.json: {error}</p>
      </section>
    );
  }
  if (!slices) {
    return (
      <section>
        <h1>Gallery</h1>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  if (slices.length === 0) {
    return (
      <section>
        <h1>Gallery</h1>
        <p className="muted">
          No slices yet. After <code>npm run new</code> finishes, run{' '}
          <code>npm run publish:slice -- &lt;slug&gt;</code> to add it here.
        </p>
      </section>
    );
  }

  return (
    <section className="gallery">
      <h1>Gallery</h1>
      <ul className="grid">
        {slices.map((s) => (
          <li key={s.slug} className="card">
            <a href={`#/slice/${s.slug}`}>
              {s.thumbnailUrl ? (
                <img src={s.thumbnailUrl} alt="" />
              ) : (
                <div className="placeholder" aria-hidden />
              )}
              <h3>{s.title ?? s.slug}</h3>
              {s.genre && <p className="genre-tag small">{s.genre}</p>}
              <p className="muted small">{s.premise}</p>
              {s.gameplayLoop && (
                <p className="loop-line small">{s.gameplayLoop}</p>
              )}
              <p className="status">
                Status: <code>{s.status}</code>
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
