import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS_URL,
  dispatchGenerate,
  generateConcept,
  isDispatchConfigured,
  listRecentRuns,
  type RunSummary,
} from '../lib/github';
import { fetchSlices, type SliceEntry } from '../lib/slices';

const ALL_MODES = ['keyboard', 'touch', 'gamepad'] as const;
type Mode = (typeof ALL_MODES)[number];

const READY_POLL_MS = 15_000;
const READY_GIVE_UP_MS = 60 * 60_000;

function defaultConceptPrompt(premise: string): string {
  return [
    'Concept art for a video game vertical slice.',
    'Single hero shot, clean readable composition, bold silhouettes,',
    'low-poly aesthetic suitable for a 3D mesh asset pipeline.',
    `Premise: ${premise}`,
  ].join(' ');
}

export function Author() {
  const [premise, setPremise] = useState('');
  const [modes, setModes] = useState<Set<Mode>>(new Set(ALL_MODES));
  const [copied, setCopied] = useState(false);

  const [conceptPrompt, setConceptPrompt] = useState('');
  const [conceptB64, setConceptB64] = useState<string | null>(null);
  const [conceptUrl, setConceptUrl] = useState<string | null>(null);
  const [conceptBusy, setConceptBusy] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

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

  const conceptSrc = conceptB64
    ? `data:image/png;base64,${conceptB64}`
    : conceptUrl;

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

  async function generateConceptArt(): Promise<void> {
    const trimmedPremise = premise.trim();
    if (!trimmedPremise) {
      setConceptError('Enter a premise first.');
      return;
    }
    const promptToUse =
      conceptPrompt.trim() || defaultConceptPrompt(trimmedPremise);
    if (!conceptPrompt.trim()) setConceptPrompt(promptToUse);
    setConceptBusy(true);
    setConceptError(null);
    try {
      const result = await generateConcept(promptToUse);
      setConceptB64(result.b64Json);
      setConceptUrl(result.url);
      if (result.prompt) setConceptPrompt(result.prompt);
    } catch (err: unknown) {
      setConceptError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setConceptBusy(false);
    }
  }

  function resetConcept(): void {
    setConceptB64(null);
    setConceptUrl(null);
    setConceptPrompt('');
    setConceptError(null);
    setApproved(false);
  }

  async function approveAndDispatch(): Promise<void> {
    if (!premise.trim() || !conceptPrompt.trim()) return;
    setCloudBusy(true);
    setCloudStatus('Dispatching workflow…');
    setReadySlice(null);
    try {
      await dispatchGenerate({
        premise: premise.trim(),
        modes: Array.from(modes),
        conceptPrompt: conceptPrompt.trim(),
      });
      setApproved(true);
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
        Describe a game in one sentence. Approve the concept art, then the
        orchestrator turns it into a playable PlayCanvas slice and validates
        it across keyboard, touch, and gamepad.
      </p>

      <label className="field">
        <span>Premise</span>
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="e.g. tiny-island survival, dawn lighting, low-poly"
          rows={3}
          disabled={approved}
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
              disabled={approved}
            />
            <span>{m}</span>
          </label>
        ))}
      </fieldset>

      {cloudReady ? (
        <div className="run-card">
          <h2>1. Concept art</h2>
          {!conceptSrc ? (
            <>
              <p className="muted small">
                gpt-image-2 generates a hero shot you can refine before
                spending tokens on the full slice.
              </p>
              <div className="cloud-actions">
                <button
                  className="primary"
                  onClick={generateConceptArt}
                  disabled={conceptBusy || !premise.trim()}
                >
                  {conceptBusy ? 'Generating…' : 'Generate concept'}
                </button>
              </div>
            </>
          ) : (
            <>
              <img
                className="concept-preview"
                src={conceptSrc}
                alt="concept art preview"
              />
              <label className="field">
                <span>Concept prompt</span>
                <textarea
                  value={conceptPrompt}
                  onChange={(e) => setConceptPrompt(e.target.value)}
                  rows={4}
                  disabled={conceptBusy || approved}
                />
              </label>
              <div className="cloud-actions">
                <button
                  className="ghost"
                  onClick={generateConceptArt}
                  disabled={conceptBusy || approved || !conceptPrompt.trim()}
                >
                  {conceptBusy ? 'Regenerating…' : 'Regenerate'}
                </button>
                {!approved && (
                  <button
                    className="ghost"
                    onClick={resetConcept}
                    disabled={conceptBusy}
                  >
                    Start over
                  </button>
                )}
              </div>
            </>
          )}
          {conceptError && (
            <p className="cloud-status error">{conceptError}</p>
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

      {cloudReady && conceptSrc && (
        <div className="run-card">
          <h2>2. Approve & generate slice</h2>
          <p className="muted small">
            Concept becomes the input to the planner, asset-gen (Meshy),
            scene-assembly, and playtest subagents.
          </p>
          <div className="cloud-actions">
            <button
              className="primary"
              onClick={approveAndDispatch}
              disabled={
                cloudBusy ||
                approved ||
                !premise.trim() ||
                !conceptPrompt.trim()
              }
            >
              {cloudBusy
                ? 'Dispatching…'
                : approved
                  ? 'Dispatched'
                  : 'Approve & generate'}
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
      )}
    </section>
  );
}
