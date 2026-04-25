interface NavProps {
  active: 'author' | 'gallery' | 'slice';
}

export function Nav({ active }: NavProps) {
  return (
    <nav>
      <strong className="brand">PlayGen</strong>
      <a href="#/" className={active === 'author' ? 'active' : ''}>
        Author
      </a>
      <a
        href="#/gallery"
        className={
          active === 'gallery' || active === 'slice' ? 'active' : ''
        }
      >
        Gallery
      </a>
      <span className="spacer" />
      <a
        href="https://github.com/phdev/PlayGen"
        target="_blank"
        rel="noreferrer"
        className="muted"
      >
        GitHub
      </a>
    </nav>
  );
}
