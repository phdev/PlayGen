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
import { fetchPlan, type PlanManifest } from '../lib/plan';

function makeSlug(premise: string): string {
  const stub = premise
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 6);
  return stub ? `${stub}-${suffix}` : `slice-${suffix}`;
}

const PLAN_POLL_MS = 10_000;
const PLAN_GIVE_UP_MS = 30 * 60_000;

const ALL_MODES = ['keyboard', 'touch', 'gamepad'] as const;
type Mode = (typeof ALL_MODES)[number];

const READY_POLL_MS = 15_000;
const READY_GIVE_UP_MS = 60 * 60_000;

const DEFAULT_PREMISE =
  'screenshots from a AAA video game themed around scaling SpaceX from going to the earth to Mars, use mechanics from Kerbal Space Program, cinematic photorealistic, 3x3 grid';

export function Author() {
  const [premise, setPremise] = useState(DEFAULT_PREMISE);
  const [modes, setModes] = useState<Set<Mode>>(new Set(ALL_MODES));
  const [copied, setCopied] = useState(false);

  const [conceptPrompt, setConceptPrompt] = useState('');
  const [conceptUrl, setConceptUrl] = useState<string | null>(null);
  const [conceptBusy, setConceptBusy] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [genre, setGenre] = useState('');
  const [mechanics, setMechanics] = useState('');
  const [approved, setApproved] = useState(false);

  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [pending, setPending] = useState<{
    since: number;
    baseline: Set<string>;
  } | null>(null);
  const [readySlice, setReadySlice] = useState<SliceEntry | null>(null);
  const [planSlug, setPlanSlug] = useState<string | null>(null);
  const [planManifest, setPlanManifest] = useState<PlanManifest | null>(null);
  const [buildBusy, setBuildBusy] = useState(false);

  const cloudReady = isDispatchConfigured();

  const command = useMemo(() => {
    const safe = premise.replace(/"/g, '\\"');
    const m = Array.from(modes).join(',');
    const flag =
      m.length > 0 && m !== 'keyboard,touch,gamepad' ? ` --modes ${m}` : '';
    return `npm run new -- "${safe || '<your premise>'}"${flag}`;
  }, [premise, modes]);

  const conceptSrc = conceptUrl;

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
    if (!planSlug || planManifest) return;
    const slug = planSlug;
    const since = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const p = await fetchPlan(slug);
        if (p && p.plan && !cancelled) {
          setPlanManifest(p);
          return;
        }
      } catch {
        // ignore transient
      }
      if (Date.now() - since > PLAN_GIVE_UP_MS) return;
      if (!cancelled) timer = setTimeout(poll, PLAN_POLL_MS);
    };

    timer = setTimeout(poll, PLAN_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [planSlug, planManifest]);

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
    const promptToUse = conceptPrompt.trim() || trimmedPremise;
    if (!conceptPrompt.trim()) setConceptPrompt(promptToUse);
    setConceptBusy(true);
    setConceptError(null);
    try {
      const result = await generateConcept(promptToUse, (analysis) => {
        if (analysis.genre && !genre.trim()) setGenre(analysis.genre);
        if (analysis.mechanics && !mechanics.trim())
          setMechanics(analysis.mechanics);
      });
      setConceptUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return result.imageUrl;
      });
      if (result.prompt) setConceptPrompt(result.prompt);
      if (result.analysis) {
        if (result.analysis.genre && !genre.trim())
          setGenre(result.analysis.genre);
        if (result.analysis.mechanics && !mechanics.trim())
          setMechanics(result.analysis.mechanics);
      }
    } catch (err: unknown) {
      setConceptError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setConceptBusy(false);
    }
  }

  function resetConcept(): void {
    setConceptUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setConceptPrompt('');
    setConceptError(null);
    setApproved(false);
  }

  useEffect(() => {
    return () => {
      if (conceptUrl) URL.revokeObjectURL(conceptUrl);
    };
    // intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generatePlan(): Promise<void> {
    if (
      !premise.trim() ||
      !conceptPrompt.trim() ||
      !genre.trim() ||
      !mechanics.trim()
    ) {
      return;
    }
    const slug = makeSlug(premise.trim());
    setCloudBusy(true);
    setCloudStatus('Dispatching plan workflow…');
    setReadySlice(null);
    setPlanManifest(null);
    try {
      await dispatchGenerate({
        phase: 'plan',
        slug,
        premise: premise.trim(),
        modes: Array.from(modes),
        conceptPrompt: conceptPrompt.trim(),
        genre: genre.trim(),
        mechanics: mechanics.trim(),
      });
      setApproved(true);
      setPlanSlug(slug);
      setCloudStatus(
        'Plan generation started (~3–5 min). When the plan lands here, you\'ll review it before any Meshy budget gets spent.',
      );
      setTimeout(refreshRuns, 2000);
    } catch (err: unknown) {
      setCloudStatus(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function approvePlanAndBuild(): Promise<void> {
    if (!planSlug || !planManifest) return;
    setBuildBusy(true);
    setCloudStatus('Dispatching build workflow…');
    try {
      await dispatchGenerate({
        phase: 'build',
        slug: planSlug,
        premise: premise.trim(),
        modes: Array.from(modes),
      });
      setCloudStatus(
        'Build started. A "Play it" link will appear once the slice is ready (~10–20 min).',
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
        `Build failed to dispatch: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBuildBusy(false);
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
          placeholder="screenshots from a AAA video game themed around <your premise>"
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
          <h2>2. Mechanics in a gameplay loop</h2>
          <p className="muted small">
            The concept image is art-direction. Pin down the gameplay loop
            — the 30–60 second cycle the player will actually live in. Each
            arrow is a controllable action with a visible consequence that
            pulls them to the next step.
          </p>
          <label className="field">
            <span>Genre</span>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="e.g. real-time strategy, twin-stick shooter, sim, tower defense"
              disabled={approved}
            />
          </label>
          <label className="field">
            <span>Gameplay loop</span>
            <textarea
              value={mechanics}
              onChange={(e) => setMechanics(e.target.value)}
              placeholder="e.g. assemble rocket stages → launch → manage delta-v during ascent → execute orbital insertion → land on Mars surface → earn contract reward → unlock next component → repeat"
              rows={4}
              disabled={approved}
            />
          </label>
        </div>
      )}

      {cloudReady && conceptSrc && (
        <div className="run-card">
          <h2>3. Generate plan</h2>
          <p className="muted small">
            Runs concept + planner subagents only. You'll review the plan
            (loop steps, controls, asset list) before any Meshy budget is
            spent.
          </p>
          <div className="cloud-actions">
            <button
              className="primary"
              onClick={generatePlan}
              disabled={
                cloudBusy ||
                approved ||
                !premise.trim() ||
                !conceptPrompt.trim() ||
                !genre.trim() ||
                !mechanics.trim()
              }
            >
              {cloudBusy
                ? 'Dispatching…'
                : approved
                  ? 'Plan dispatched'
                  : 'Generate plan'}
            </button>
            <a href={ACTIONS_URL} target="_blank" rel="noreferrer">
              Watch runs ↗
            </a>
          </div>
          {cloudStatus && <p className="cloud-status">{cloudStatus}</p>}
          {planManifest && planManifest.plan && (
            <div className="plan-card">
              <h3>{planManifest.plan.title}</h3>
              <p className="muted small">
                {planManifest.plan.oneLineHook}
              </p>
              <p className="plan-meta small">
                Template: <code>{planManifest.plan.template}</code> · Win:{' '}
                {planManifest.plan.winCondition} · Lose:{' '}
                {planManifest.plan.loseCondition}
              </p>
              <h4>Gameplay loop</h4>
              <ol className="loop-list">
                {planManifest.plan.loopSteps.map((s, i) => (
                  <li key={i}>
                    <code>{s.name}</code>
                    {s.control ? (
                      <span className="muted small"> · {s.control}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <h4>Assets ({planManifest.assets.length})</h4>
              <ul className="asset-list">
                {planManifest.assets.map((a) => (
                  <li key={a.id}>
                    <code>{a.kind}</code> · {a.prompt}
                  </li>
                ))}
              </ul>
              <div className="cloud-actions">
                <button
                  className="primary"
                  onClick={approvePlanAndBuild}
                  disabled={buildBusy || Boolean(pending)}
                >
                  {buildBusy
                    ? 'Dispatching…'
                    : pending
                      ? 'Build dispatched'
                      : 'Approve plan & build slice'}
                </button>
              </div>
            </div>
          )}
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
