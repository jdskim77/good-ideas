import { useEffect, useState } from "react";
import type { Capture, Idea } from "../lib/ideas";
import { formatDay, parseTags } from "../lib/ideas";
import type { Store } from "../lib/store";

export function IdeaEditor({
  store, idea, capture, onClose, onChanged,
}: {
  store: Store;
  idea: Idea;
  capture: Capture | null;
  onClose: () => void;
  onChanged: (updated: Idea | null) => void;
}) {
  const [title, setTitle] = useState(idea.title);
  const [body, setBody] = useState(idea.body);
  const [date, setDate] = useState(idea.idea_date ?? "");
  const [tags, setTags] = useState(idea.tags.join(", "));
  const [img, setImg] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (capture?.storage_path) store.imageUrl(capture).then(setImg).catch(() => setImg(null));
  }, [capture, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!title.trim()) return setErr("Give it a title.");
    setBusy(true);
    try {
      const dateChanged = (date || null) !== idea.idea_date;
      const u = await store.update(idea.id, {
        title: title.trim().slice(0, 200),
        body,
        idea_date: date || null,
        idea_date_origin: dateChanged ? (date ? "user" : "unknown") : idea.idea_date_origin,
        tags: parseTags(tags),
      });
      onChanged(u);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirm("Delete this idea? This can't be undone.")) return;
    setBusy(true);
    try {
      await store.remove(idea.id);
      onChanged(null);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit idea"
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-xl font-bold outline-none" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="mt-3 w-full resize-y outline-none text-stone-700" />
        <div className="mt-3 grid gap-2 text-sm">
          <label className="flex items-center gap-2 text-stone-600">
            Had it on
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-stone-300 px-2 py-1" />
            {idea.idea_date_origin === "extracted" && date === idea.idea_date && <span className="text-xs text-amber-700">from source</span>}
          </label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags" className="rounded-lg border border-stone-300 px-2 py-1" />
          <div className="text-xs text-stone-400">Saved {formatDay(idea.captured_at.slice(0, 10))} · {new Date(idea.captured_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
        </div>
        {img && (
          <div className="mt-4">
            <a href={img} target="_blank" rel="noreferrer">
              <img src={img} alt="Original screenshot" className="rounded-xl border border-stone-200 max-h-80 mx-auto" />
            </a>
            {capture?.raw_text && (
              <button onClick={() => setShowText((v) => !v)} className="mt-2 text-sm underline text-stone-600">
                {showText ? "Hide" : "Show"} text read from screenshot
              </button>
            )}
            {showText && <pre className="mt-2 whitespace-pre-wrap text-xs bg-stone-50 rounded-lg p-3 text-stone-600">{capture?.raw_text}</pre>}
          </div>
        )}
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <div className="mt-5 flex gap-2">
          <button onClick={del} disabled={busy} className="rounded-xl px-4 py-2.5 text-red-600 border border-red-200">Delete</button>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 border border-stone-300">Close</button>
          <button onClick={save} disabled={busy} className="rounded-xl px-5 py-2.5 bg-amber-400 font-semibold disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}
