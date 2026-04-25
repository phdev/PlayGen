import { useMemo, useState } from 'react';

const ALL_MODES = ['keyboard', 'touch', 'gamepad'] as const;
type Mode = (typeof ALL_MODES)[number];

export function Author() {
  const [premise, setPremise] = useState('');
  const [modes, setModes] = useState<Set<Mode>>(new Set(ALL_MODES));
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => {
    const safe = premise.replace(/"/g, '\\"');
    const m = Array.from(modes).join(',');
    const modeFlag = m.length > 0 && m !== 'keyboard,touch,gamepad'
      ? ` --modes ${m}`
      : '';
    return `npm run new -- "${safe || '<your premise>'}"${modeFlag}`;
  }, [premise, modes]);

  function toggle(mode: Mode): void {
    setModes((s) => {
      const next = new Set(s);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="author">
      <h1>Generate a vertical slice</h1>
      <p className="muted">
        Describe a game in one sentence. The orchestrator turns it into a
        playable PlayCanvas slice and validates it across keyboard, touch,
        and gamepad.
      </p>

      <label className="field">
        <span>Premise</span>
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="e.g. tiny-island survival, dawn lighting, low-poly"
          rows={3}
        />
      </label>

      <fieldset className="modes">
        <legend>Validate input modes</legend>
        {ALL_MODES.map((m) => (
          <label key={m}>
            <input
              type="checkbox"
              checked={modes.has(m)}
              onChange={() => toggle(m)}
            />
            <span>{m}</span>
          </label>
        ))}
      </fieldset>

      <div className="run-card">
        <h2>Run it locally</h2>
        <p className="muted small">
          The orchestrator runs Node + Playwright + spawns Meshy / OpenAI /
          PlayCanvas calls — it can't execute in the browser. Clone the repo,
          set <code>.env</code>, then run:
        </p>
        <pre className="cmd">
          <code>{command}</code>
          <button
            className="copy"
            onClick={copy}
            disabled={!premise.trim()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </pre>
      </div>

      <details className="env-help">
        <summary>What keys do I need?</summary>
        <ul>
          <li>
            <code>ANTHROPIC_API_KEY</code> — orchestrator (Claude Agent SDK)
          </li>
          <li>
            <code>OPENAI_API_KEY</code> — concept image (gpt-image-2)
          </li>
          <li>
            <code>MESHY_API_KEY</code> — image-to-rigged-glTF
          </li>
          <li>
            <code>PLAYCANVAS_API_KEY</code> +{' '}
            <code>PLAYCANVAS_PROJECT_ID</code> — asset upload + scene
          </li>
        </ul>
        <p className="muted small">
          Optional: <code>PLAYGEN_IMAGE_MODEL</code>,{' '}
          <code>PLAYCANVAS_MCP_SERVER_PATH</code>,{' '}
          <code>PLAYWRIGHT_HEADLESS</code>. See{' '}
          <code>.env.example</code>.
        </p>
      </details>
    </section>
  );
}
