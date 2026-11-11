// Pure helpers: no network, no DOM. Unit-tested in ideas.test.ts.

export type DateOrigin = "captured" | "user" | "extracted" | "unknown";

export interface Idea {
  id: string;
  capture_id: string | null;
  title: string;
  body: string;
  idea_date: string | null; // YYYY-MM-DD
  idea_date_origin: DateOrigin;
  captured_at: string; // ISO timestamp
  starred: boolean;
  tags: string[];
  updated_at: string;
}

export interface Capture {
  id: string;
  kind: "text" | "image";
  storage_path: string | null;
  raw_text: string | null;
  ocr_status: "none" | "pending" | "done" | "failed";
  source_date: string | null;
  created_at: string;
}

export interface Draft {
  title: string;
  body: string;
}

export const TITLE_MAX = 200;
export const BODY_MAX = 20000;

/** Local calendar date (not UTC) as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** First meaningful line, trimmed of bullets/markdown, max 80 chars at a word boundary. */
export function titleFrom(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => cleanLine(l))
      .find((l) => l.length > 0) ?? "";
  if (line.length <= 80) return line || "Untitled idea";
  const cut = line.slice(0, 80);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

function cleanLine(l: string): string {
  return l
    .replace(/^\s*(?:[-*•·▪◦‣–—]|\d{1,2}[.)]|#+)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turn typed/OCR text into a draft: title = first line, body = full text. */
export function draftFrom(text: string): Draft {
  const body = text.trim();
  return { title: titleFrom(body).slice(0, TITLE_MAX), body: body.slice(0, BODY_MAX) };
}

/**
 * Split a page of notes into separate ideas.
 * Rule: blank lines separate ideas; if there are none, bullet/numbered lines
 * each start a new idea. Indented / wrapped continuation lines stay with the idea above.
 */
export function splitIntoIdeas(text: string): Draft[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  let chunks = normalized.split(/\n\s*\n+/).map((c) => c.trim()).filter(Boolean);
  if (chunks.length === 1) {
    const lines = normalized.split("\n");
    const bulletRe = /^\s*(?:[-*•·▪◦‣–—]|\d{1,2}[.)])\s+/;
    const bulletCount = lines.filter((l) => bulletRe.test(l)).length;
    if (bulletCount >= 2) {
      const out: string[] = [];
      for (const l of lines) {
        if (bulletRe.test(l) || out.length === 0) out.push(l.replace(bulletRe, ""));
        else out[out.length - 1] += "\n" + l.trim();
      }
      chunks = out.map((c) => c.trim()).filter(Boolean);
    }
  }
  return chunks.map(draftFrom);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Find a date in an email/screenshot. Prefers an email header line
 * ("Date:", "Sent:", "On <date> ... wrote:"), then the first date anywhere.
 * Numeric dates are read as M/D/Y unless the first number is > 12 (then D/M/Y).
 * Returns null when nothing clear is found. This is a SOURCE date, not proof of the idea date.
 */
export function extractDate(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => /^\s*(date|sent|data|enviado)\s*:/i.test(l) || /^\s*on .+ wrote:?\s*$/i.test(l));
  return (header && findDate(header)) || findDate(text);
}

function findDate(s: string): string | null {
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i);
  if (m) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (m) {
    const a = +m[1], b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return a > 12 ? valid(y, b, a) : valid(y, a, b);
  }
  return null;
}

/** "#tag" words in text plus comma-separated input, lowercased, deduped, max 12. */
export function parseTags(input: string): string[] {
  const out = new Set<string>();
  for (const raw of input.split(/[,\s]+/)) {
    const t = raw.replace(/^#/, "").toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "");
    if (t) out.add(t.slice(0, 32));
    if (out.size >= 12) break;
  }
  return [...out];
}

/** Sort newest idea date first; unknown dates fall back to the capture date. */
export function sortKey(i: Pick<Idea, "idea_date" | "captured_at">): string {
  return i.idea_date ?? i.captured_at.slice(0, 10);
}

export function sortIdeas<T extends Pick<Idea, "idea_date" | "captured_at">>(ideas: T[]): T[] {
  return [...ideas].sort((a, b) => {
    const k = sortKey(b).localeCompare(sortKey(a));
    return k !== 0 ? k : b.captured_at.localeCompare(a.captured_at);
  });
}

export function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function groupByMonth<T extends Pick<Idea, "idea_date" | "captured_at">>(ideas: T[]): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const i of sortIdeas(ideas)) {
    const label = monthLabel(sortKey(i));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(i);
    else groups.push({ label, items: [i] });
  }
  return groups;
}

export interface Filter {
  q: string;
  starredOnly: boolean;
  tag: string | null;
}

export function filterIdeas<T extends Idea>(ideas: T[], f: Filter, captureText: (id: string | null) => string = () => ""): T[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return ideas.filter((i) => {
    if (f.starredOnly && !i.starred) return false;
    if (f.tag && !i.tags.includes(f.tag)) return false;
    if (!words.length) return true;
    const hay = `${i.title}\n${i.body}\n${i.tags.join(" ")}\n${captureText(i.capture_id)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function allTags(ideas: Idea[]): string[] {
  const counts = new Map<string, number>();
  for (const i of ideas) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function toMarkdown(ideas: Idea[]): string {
  const lines = ["# Good Ideas", "", `Exported ${new Date().toISOString().slice(0, 10)} · ${ideas.length} ideas`, ""];
  for (const g of groupByMonth(ideas)) {
    lines.push(`## ${g.label}`, "");
    for (const i of g.items) {
      lines.push(`### ${i.starred ? "⭐ " : ""}${i.title}`);
      lines.push(`- Idea date: ${i.idea_date ?? "unknown"} (${i.idea_date_origin})`);
      lines.push(`- Saved: ${i.captured_at}`);
      if (i.tags.length) lines.push(`- Tags: ${i.tags.map((t) => "#" + t).join(" ")}`);
      lines.push("", i.body, "");
    }
  }
  return lines.join("\n");
}
