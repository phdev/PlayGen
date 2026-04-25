import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS_URL,
  dispatchGenerate,
  isDispatchConfigured,
  listRecentRuns,
  type RunSummary,
} from '../lib/github';
import { fetchSlices, type SliceEntry } from '../lib/slices';

const READY_POLL_MS = 15_000;
const READY_GIVE_UP_MS = 60 * 60_000;

const ALL_MODES = ['keyboard', 'touch', 'gamepad'] as const;
type Mode = (typeof ALL_MODES)[number];

export function Author() {
  const [premise, setPremise] = useState('');
  const [modes, setModes] = useState<Set<Mode>>(new Set(ALL_MODES));
  const [copied, setCopied] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [pending, setPending] = useState<{
    since: number;
    baseline: Set<string>;
  } | null>(null);
  const [readySlice, setReadySlice] = useState<SliceEntry | null>(null);
  const cloudReady = isDispatchConfigured();

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

  async function refreshRuns(): Promise<void> {
    if (!cloudReady) return;
    try {
      setRuns(await listRecentRuns());
    } catch {
      setRuns(null);
    }
  }

  useEffect(() => {
    if (cloudReady) refreshRuns();
  }, [cloudReady]);

  useEffect(() => {
    if (!pending) return;
    const { since, baseline } = pending;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const slices = await fetchSlices();
        const fresh = slices.find(
          (s) => !baseline.has(s.slug) && Boolean(s.publishedUrl),
        );
        if (fresh && !cancelled) {
          setReadySlice(fresh);
          setPending(null);
          return;
        }
      } catch {
        // ignore transient fetch errors
      }
      if (Date.now() - since > READY_GIVE_UP_MS) {
        if (!cancelled) setPending(null);
        return;
      }
      if (!cancelled) timer = setTimeout(poll, READY_POLL_MS);
    };

    timer = setTimeout(poll, READY_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pending]);

  async function runInCloud(): Promise<void> {
    if (!premise.trim()) {
      setCloudStatus('Enter a premise first.');
      return;
    }
    setCloudBusy(true);
    setCloudStatus('Dispatching workflow…');
    setReadySlice(null);
    try {
      await dispatchGenerate({
        premise: premise.trim(),
        modes: Array.from(modes),
      });
      setCloudStatus(
        'Run started. A "Play it" link will appear here once the slice is ready (~5–15 min).',
      );
      try {
        const baselineSlices = await fetchSlices();
        setPending({
          since: Date.now(),
          baseline: new Set(baselineSlices.map((s) => s.slug)),
        });
      } catch {
        setPending({ since: Date.now(), baseline: new Set() });
      }
      setTimeout(refreshRuns, 2000);
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

      {cloudReady ? (
        <div className="run-card">
          <div className="cloud-actions">
            <button
              className="primary"
              onClick={runInCloud}
              disabled={cloudBusy || !premise.trim()}
            >
              {cloudBusy ? 'Dispatching…' : 'Generate'}
            </button>
            <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
              Watch runs ↗
            </a>
          </div>
          {cloudStatus && <p className="cloud-status">{cloudStatus}</p>}
          {readySlice && (
            <div className="ready-card">
              <strong>{readySlice.title ?? readySlice.slug}</strong> is ready.
              <a className="ready-link" href={`#/slice/${readySlice.slug}`}>
                Play it →
              </a>
            </div>
          )}
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
      ) : (
        <div className="run-card">
          <h2>Cloud generation isn't wired up here</h2>
          <p className="muted small">
            The dispatch endpoint isn't configured for this deployment. You
            can still run it locally:
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
      )}
    </section>
  );
}
