import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { cloudEnabled, cloudStore, localStore, supabase, type Store } from "./lib/store";
import { allTags, filterIdeas, groupByMonth, toMarkdown, type Capture, type Idea } from "./lib/ideas";
import { CaptureBox } from "./components/CaptureBox";
import { IdeaCard } from "./components/IdeaCard";
import { IdeaEditor } from "./components/IdeaEditor";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!cloudEnabled);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const store = useMemo<Store | null>(() => {
    if (!cloudEnabled) return localStore();
    return session && supabase ? cloudStore(supabase, session) : null;
  }, [session]);

  if (!authReady) return <Splash text="Loading…" />;
  if (!store) return <SignIn />;
  return <Book store={store} session={session} />;
}

function Splash({ text }: { text: string }) {
  return <div className="min-h-dvh grid place-items-center text-stone-500">{text}</div>;
}

function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  const urlError = new URLSearchParams(location.search).get("error_description");
  const signIn = async () => {
    setErr(null);
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) setErr(error.message);
  };
  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="text-6xl mb-4">💡</div>
        <h1 className="text-3xl font-bold text-stone-900">Good Ideas</h1>
        <p className="mt-2 text-stone-600">Your book of ideas: typed, or read from a screenshot. Every idea keeps its date.</p>
        <button
          onClick={signIn}
          className="mt-8 w-full rounded-xl bg-stone-900 text-white py-3 font-semibold active:scale-[0.98]"
        >
          Continue with Google
        </button>
        {(err || urlError) && (
          <p className="mt-4 text-sm text-red-600">
            {err || urlError}
            {/signup|not allowed|disabled/i.test(err || urlError || "") && " (this app is invite-only)"}
          </p>
        )}
        <p className="mt-6 text-xs text-stone-400">Ideas are saved to your account, so they're on every device.</p>
      </div>
    </div>
  );
}

function Book({ store, session }: { store: Store; session: Session | null }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<Idea | null>(null);
  const [resume, setResume] = useState<Capture | null>(null);
  // Every local change bumps this; a list() that started before a change is discarded
  // so an older snapshot can never overwrite a newer save.
  const version = useRef(0);

  const reload = useCallback(async () => {
    const started = version.current;
    try {
      const r = await store.list();
      if (started !== version.current) return;
      setIdeas(r.ideas);
      setCaptures(r.captures);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    reload();
  }, [reload]);

  const capById = useMemo(() => new Map(captures.map((c) => [c.id, c])), [captures]);
  // Screenshot text is searchable only when that screenshot became a single idea;
  // otherwise every sibling idea would match a word that belongs to just one of them.
  const perCapture = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of ideas) if (i.capture_id) m.set(i.capture_id, (m.get(i.capture_id) ?? 0) + 1);
    return m;
  }, [ideas]);
  const shown = useMemo(
    () =>
      filterIdeas(ideas, { q, starredOnly, tag }, (id) =>
        id && perCapture.get(id) === 1 ? capById.get(id)?.raw_text ?? "" : "",
      ),
    [ideas, q, starredOnly, tag, capById, perCapture],
  );
  const groups = useMemo(() => groupByMonth(shown), [shown]);
  const tags = useMemo(() => allTags(ideas), [ideas]);
  // Screenshots that were saved but never turned into an idea (cancelled, failed, closed tab).
  const unfinished = useMemo(
    () => captures.filter((c) => c.kind === "image" && !perCapture.has(c.id)),
    [captures, perCapture],
  );

  const onSaved = (made: Idea[], cap?: Capture) => {
    version.current++;
    setIdeas((xs) => [...made, ...xs]);
    if (cap) setCaptures((cs) => [cap, ...cs.filter((c) => c.id !== cap.id)]);
  };

  const toggleStar = async (i: Idea) => {
    version.current++;
    setIdeas((xs) => xs.map((x) => (x.id === i.id ? { ...x, starred: !x.starred } : x)));
    try {
      await store.update(i.id, { starred: !i.starred });
    } catch (e) {
      setError((e as Error).message);
      reload();
    }
  };

  const exportMd = () => {
    const blob = new Blob([toMarkdown(ideas)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `good-ideas-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-10 bg-stone-50/90 backdrop-blur border-b border-stone-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">💡</span>
          <h1 className="font-bold text-lg text-stone-900 flex-1">Good Ideas</h1>
          <span className="text-sm text-stone-500">{ideas.length} ideas</span>
          <details className="relative">
            <summary className="list-none cursor-pointer rounded-full w-9 h-9 grid place-items-center hover:bg-stone-200" aria-label="Menu">⋯</summary>
            <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white shadow-lg border border-stone-200 p-1 text-sm">
              {session && <div className="px-3 py-2 text-stone-500 truncate">{session.user.email}</div>}
              {!cloudEnabled && <div className="px-3 py-2 text-amber-700">Demo mode: saved in this browser only</div>}
              <button onClick={exportMd} className="w-full text-left px-3 py-2 rounded-lg hover:bg-stone-100">Export all (Markdown)</button>
              {session && (
                <button onClick={() => supabase!.auth.signOut()} className="w-full text-left px-3 py-2 rounded-lg hover:bg-stone-100">Sign out</button>
              )}
            </div>
          </details>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4">
        <CaptureBox store={store} onSaved={onSaved} resume={resume} onResumeHandled={() => setResume(null)} />

        {unfinished.length > 0 && (
          <details className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2 text-sm">
            <summary className="cursor-pointer text-amber-900">
              {unfinished.length} saved screenshot{unfinished.length > 1 ? "s" : ""} not turned into ideas yet
            </summary>
            <ul className="mt-2 space-y-1">
              {unfinished.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-stone-700">
                    {new Date(c.created_at).toLocaleDateString()} · {c.raw_text?.split("\n").find((l) => l.trim()) || "no text read"}
                  </span>
                  <button onClick={() => { scrollTo({ top: 0, behavior: "smooth" }); setResume(c); }} className="underline text-amber-900">
                    Review
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

        {error && (
          <div className="mt-4 rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm flex justify-between gap-3">
            <span>{error}</span>
            <button onClick={reload} className="underline shrink-0">Retry</button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ideas, tags, screenshot text…"
            className="flex-1 min-w-48 rounded-xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-300"
          />
          <button
            onClick={() => setStarredOnly((v) => !v)}
            className={`rounded-xl px-3 py-2.5 border ${starredOnly ? "bg-amber-100 border-amber-300" : "bg-white border-stone-300"}`}
            aria-pressed={starredOnly}
          >
            ⭐ Best
          </button>
        </div>
        {tags.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setTag(tag === t ? null : t)}
                className={`shrink-0 rounded-full px-3 py-1 text-sm border ${tag === t ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300 text-stone-700"}`}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-center text-stone-500">Loading your ideas…</p>
        ) : groups.length === 0 ? (
          <p className="mt-10 text-center text-stone-500">
            {ideas.length ? "No ideas match." : "No ideas yet. Type one above or add a screenshot."}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">{g.label}</h2>
              <div className="space-y-2">
                {g.items.map((i) => (
                  <IdeaCard key={i.id} idea={i} hasImage={!!(i.capture_id && capById.get(i.capture_id)?.storage_path)} onOpen={() => setEditing(i)} onStar={() => toggleStar(i)} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {editing && (
        <IdeaEditor
          store={store}
          idea={editing}
          capture={editing.capture_id ? capById.get(editing.capture_id) ?? null : null}
          onClose={() => setEditing(null)}
          onChanged={(u) => {
            version.current++;
            setIdeas((xs) => (u ? xs.map((x) => (x.id === u.id ? u : x)) : xs.filter((x) => x.id !== editing.id)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
