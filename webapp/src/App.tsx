import { useEffect, useState } from 'react';
import { Author } from './components/Author';
import { Gallery } from './components/Gallery';
import { SliceView } from './components/SliceView';
import { Nav } from './components/Nav';

type Route =
  | { name: 'author' }
  | { name: 'gallery' }
  | { name: 'slice'; slug: string };

function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '');
  const [page, slug] = cleaned.split('/');
  if (page === 'gallery') return { name: 'gallery' };
  if (page === 'slice' && slug) return { name: 'slice', slug };
  return { name: 'author' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <Nav active={route.name} />
      <main>
        {route.name === 'author' && <Author />}
        {route.name === 'gallery' && <Gallery />}
        {route.name === 'slice' && <SliceView slug={route.slug} />}
      </main>
      <footer>
        <span className="muted small">
          PlayGen — orchestrator runs locally; this is the author + gallery shell.
        </span>
      </footer>
    </div>
  );
}
