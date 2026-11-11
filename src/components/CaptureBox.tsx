import { useEffect, useRef, useState } from "react";
import type { Capture, DateOrigin, Draft, Idea } from "../lib/ideas";
import { draftFrom, extractDate, parseTags, splitIntoIdeas, todayLocal } from "../lib/ideas";
import { prepareImage, readText } from "../lib/ocr";
import type { Store } from "../lib/store";

interface Review {
  capture: Capture;
  preview: string;
  drafts: (Draft & { keep: boolean })[];
  date: string;
  dateOrigin: DateOrigin;
  rawText: string;
}

export function CaptureBox({ store, onSaved }: { store: Store; onSaved: (ideas: Idea[], cap?: Capture) => void }) {
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveText = async () => {
    if (!text.trim() || busy) return;
    setBusy("Saving…");
    setErr(null);
    try {
      const d = draftFrom(text);
      const cap = await store.addCapture({ kind: "text", raw_text: text, source_date: null });
      const made = await store.addIdeas([
        { ...d, capture_id: cap.id, idea_date: date || null, idea_date_origin: date === todayLocal() ? "captured" : date ? "user" : "unknown", tags: parseTags(tags) },
      ]);
      onSaved(made, cap);
      setText("");
      setTags("");
      setDate(todayLocal());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleImage = async (file: File) => {
    setErr(null);
    setBusy("Saving screenshot…");
    let capture: Capture | null = null;
    let preview = "";
    try {
      const { blob, ext } = await prepareImage(file);
      preview = URL.createObjectURL(blob);
      // Save the original first so nothing is lost even if reading fails.
      capture = await store.addCapture({ kind: "image", raw_text: null, source_date: null, file: blob, ext });
      onSaved([], capture);
      let raw = "";
      try {
        raw = await readText(blob, (p, label) => setBusy(`${label}… ${p}%`));
        await store.setCaptureText(capture.id, raw, "done");
      } catch {
        await store.setCaptureText(capture.id, "", "failed").catch(() => {});
        setErr("Couldn't read text from that image. The screenshot is saved. Type the idea below.");
      }
      const found = extractDate(raw);
      const drafts = splitIntoIdeas(raw);
      setReview({
        capture: { ...capture, raw_text: raw, ocr_status: raw ? "done" : "failed", source_date: found },
        preview,
        drafts: (drafts.length ? drafts : [{ title: "", body: "" }]).map((d) => ({ ...d, keep: true })),
        date: found ?? todayLocal(),
        dateOrigin: found ? "extracted" : "captured",
        rawText: raw,
      });
    } catch (e) {
      setErr((e as Error).message);
      if (preview) URL.revokeObjectURL(preview);
    } finally {
      setBusy(null);
    }
  };

  // Paste a screenshot straight into the page (desktop).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        handleImage(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const closeReview = () => {
    if (review) URL.revokeObjectURL(review.preview);
    setReview(null);
  };

  const saveReview = async () => {
    if (!review) return;
    const keep = review.drafts.filter((d) => d.keep && (d.title.trim() || d.body.trim()));
    if (!keep.length) return closeReview();
    setBusy("Saving ideas…");
    try {
      const made = await store.addIdeas(
        keep.map((d) => ({
          title: (d.title.trim() || draftFrom(d.body).title).slice(0, 200),
          body: d.body.trim() || d.title.trim(),
          capture_id: review.capture.id,
          idea_date: review.date || null,
          idea_date_origin: review.date ? review.dateOrigin : "unknown",
          tags: parseTags(tags),
        })),
      );
      onSaved(made);
      setTags("");
      closeReview();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setDraft = (i: number, patch: Partial<Review["drafts"][number]>) =>
    setReview((r) => r && { ...r, drafts: r.drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <div className="mt-4 rounded-2xl bg-white border border-stone-200 p-4 shadow-sm">
      {!review ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveText();
            }}
            rows={3}
            placeholder="What's the idea?"
            className="w-full resize-none outline-none text-lg placeholder:text-stone-400"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-sm text-stone-600 flex items-center gap-1">
              Had it on
              <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-stone-300 px-2 py-1" />
            </label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" className="flex-1 min-w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm" />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="rounded-xl border border-stone-300 px-4 py-2.5 font-medium text-stone-800 disabled:opacity-50"
            >
              📷 Screenshot
            </button>
            <button
              onClick={saveText}
              disabled={!text.trim() || !!busy}
              className="flex-1 rounded-xl bg-amber-400 px-4 py-2.5 font-semibold text-stone-900 disabled:opacity-40"
            >
              {busy ?? "Save idea"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleImage(f);
              }}
            />
          </div>
        </>
      ) : (
        <div>
          <div className="flex items-start gap-3">
            <img src={review.preview} alt="Screenshot" className="w-20 h-20 object-cover rounded-lg border border-stone-200" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-stone-900">
                {review.rawText ? `Found ${review.drafts.length} idea${review.drafts.length > 1 ? "s" : ""}. Check before saving.` : "Type what the screenshot says"}
              </div>
              <label className="mt-2 flex items-center gap-2 text-stone-600">
                Idea date
                <input
                  type="date"
                  value={review.date}
                  onChange={(e) => setReview({ ...review, date: e.target.value, dateOrigin: "user" })}
                  className="rounded-lg border border-stone-300 px-2 py-1"
                />
              </label>
              {review.capture.source_date && review.dateOrigin === "extracted" && (
                <div className="mt-1 text-xs text-amber-700">Date read from the image. Change it if that's not when you had the idea.</div>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {review.drafts.map((d, i) => (
              <div key={i} className={`rounded-xl border p-3 ${d.keep ? "border-stone-300" : "border-stone-200 opacity-50"}`}>
                <div className="flex gap-2">
                  <input
                    value={d.title}
                    onChange={(e) => setDraft(i, { title: e.target.value })}
                    placeholder="Title"
                    className="flex-1 font-semibold outline-none"
                  />
                  {review.drafts.length > 1 && (
                    <label className="text-xs text-stone-500 flex items-center gap-1">
                      <input type="checkbox" checked={d.keep} onChange={(e) => setDraft(i, { keep: e.target.checked })} /> keep
                    </label>
                  )}
                </div>
                <textarea
                  value={d.body}
                  onChange={(e) => setDraft(i, { body: e.target.value })}
                  rows={Math.min(8, Math.max(2, d.body.split("\n").length))}
                  placeholder="Details"
                  className="mt-1 w-full resize-y text-sm text-stone-700 outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {review.drafts.length > 1 && (
              <button
                onClick={() =>
                  setReview({ ...review, drafts: [{ ...draftFrom(review.drafts.map((d) => d.body).join("\n\n")), keep: true }] })
                }
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              >
                Merge into one
              </button>
            )}
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags" className="flex-1 min-w-24 rounded-lg border border-stone-300 px-2 py-1 text-sm" />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={closeReview} className="rounded-xl border border-stone-300 px-4 py-2.5">Cancel</button>
            <button onClick={saveReview} disabled={!!busy} className="flex-1 rounded-xl bg-amber-400 px-4 py-2.5 font-semibold disabled:opacity-40">
              {busy ?? `Save ${review.drafts.filter((d) => d.keep).length > 1 ? "ideas" : "idea"}`}
            </button>
          </div>
          <p className="mt-2 text-xs text-stone-400">Cancel keeps the screenshot saved in your account; it just won't become an idea.</p>
        </div>
      )}
      {busy && !review && busy.includes("%") && <div className="mt-2 text-xs text-stone-500">Reading on your device. The image isn't sent to any AI.</div>}
      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
    </div>
  );
}
