import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS_URL,
  dispatchGenerate,
  getPat,
  listRecentRuns,
  savePat,
  type RunSummary,
} from '../lib/github';

const ALL_MODES = ['keyboard', 'touch', 'gamepad'] as const;
type Mode = (typeof ALL_MODES)[number];

export function Author() {
  const [premise, setPremise] = useState('');
  const [modes, setModes] = useState<Set<Mode>>(new Set(ALL_MODES));
  const [copied, setCopied] = useState(false);
  const [pat, setPat] = useState(() => getPat());
  const [showPat, setShowPat] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  const command = useMemo(() => {
    const safe = premise.replace(/"/g, '\\"');
    const m = Array.from(modes).join(',');
    const flag =
      m.length > 0 && m !== 'keyboard,touch,gamepad' ? ` --modes ${m}` : '';
    return `npm run new -- "${safe || '<your premise>'}"${flag}`;
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

  async function refreshRuns(token: string): Promise<void> {
    if (!token) {
      setRuns(null);
      return;
    }
    try {
      setRuns(await listRecentRuns(token));
    } catch (err: unknown) {
      setRuns(null);
      setCloudStatus(
        `Couldn't fetch runs: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  useEffect(() => {
    if (pat) refreshRuns(pat);
  }, [pat]);

  async function runInCloud(): Promise<void> {
    if (!premise.trim()) {
      setCloudStatus('Enter a premise first.');
      return;
    }
    if (!pat) {
      setCloudStatus('Paste a GitHub PAT first.');
      return;
    }
    savePat(pat);
    setCloudBusy(true);
    setCloudStatus('Dispatching workflow…');
    try {
      await dispatchGenerate({
        pat,
        premise: premise.trim(),
        modes: Array.from(modes),
      });
      setCloudStatus(
        'Run started. The gallery will update once the workflow finishes (~5–15 min). Use the link below to watch progress.',
      );
      setTimeout(() => refreshRuns(pat), 2000);
    } catch (err: unknown) {
      setCloudStatus(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCloudBusy(false);
    }
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
        <h2>Run in the cloud</h2>
        <p className="muted small">
          Dispatches the <code>generate.yml</code> workflow on GitHub Actions.
          Secrets (Anthropic, OpenAI, Meshy, PlayCanvas) live in repo
          settings; the workflow commits the slice into{' '}
          <code>webapp/public/slices/&lt;slug&gt;/</code> and Pages
          auto-redeploys.
        </p>
        <div className="pat-row">
          <input
            type={showPat ? 'text' : 'password'}
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="GitHub PAT (scope: repo or public_repo)"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => setShowPat((s) => !s)}
            aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
          >
            {showPat ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="cloud-actions">
          <button
            className="primary"
            onClick={runInCloud}
            disabled={cloudBusy || !premise.trim() || !pat}
          >
            {cloudBusy ? 'Dispatching…' : 'Generate in cloud'}
          </button>
          <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
            Watch runs ↗
          </a>
        </div>
        {cloudStatus && <p className="cloud-status">{cloudStatus}</p>}
        {runs && runs.length > 0 && (
          <ul className="runs">
            {runs.map((r) => (
              <li key={r.id}>
                <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                  {r.displayTitle || `Run #${r.id}`}
                </a>
                <span className="muted small">
                  {' · '}
                  {r.status}
                  {r.conclusion ? ` · ${r.conclusion}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="run-card">
        <h2>Or run it locally</h2>
        <p className="muted small">
          Clone the repo, fill <code>.env</code>, then:
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
        <p className="muted small">
          For cloud runs, set these as <strong>repository secrets</strong>{' '}
          (Settings → Secrets and variables → Actions). For local runs, put
          them in <code>.env</code>.
        </p>
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
            <code>PLAYCANVAS_PROJECT_ID</code> — asset upload (optional;
            engine-only path doesn't strictly need it)
          </li>
        </ul>
      </details>
    </section>
  );
}
