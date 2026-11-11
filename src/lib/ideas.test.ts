import { describe, expect, it } from "vitest";
import {
  draftFrom, extractDate, filterIdeas, groupByMonth, parseTags, sortIdeas, splitIntoIdeas, titleFrom, todayLocal, toMarkdown,
  type Idea,
} from "./ideas";

const idea = (p: Partial<Idea>): Idea => ({
  id: Math.random().toString(36).slice(2), capture_id: null, title: "t", body: "", idea_date: null,
  idea_date_origin: "captured", captured_at: "2026-11-01T10:00:00Z", starred: false, tags: [], updated_at: "", ...p,
});

describe("titleFrom", () => {
  it("uses the first non-empty line and strips bullets", () => {
    expect(titleFrom("\n\n- App that tracks surf boards\nmore")).toBe("App that tracks surf boards");
    expect(titleFrom("1) Numbered idea")).toBe("Numbered idea");
  });
  it("cuts long lines at a word boundary", () => {
    const t = titleFrom("word ".repeat(40));
    expect(t.length).toBeLessThanOrEqual(81);
    expect(t.endsWith("…")).toBe(true);
  });
  it("falls back for empty text", () => expect(titleFrom("   ")).toBe("Untitled idea"));
});

describe("splitIntoIdeas", () => {
  it("splits on blank lines", () => {
    const d = splitIntoIdeas("Idea one\nmore about one\n\n\nIdea two");
    expect(d.map((x) => x.title)).toEqual(["Idea one", "Idea two"]);
    expect(d[0].body).toBe("Idea one\nmore about one");
  });
  it("splits bullet lists when there are no blank lines, keeping wrapped lines", () => {
    const d = splitIntoIdeas("- dog walking app\n  for busy people\n- surf diary\n• idea three");
    expect(d.map((x) => x.title)).toEqual(["dog walking app", "surf diary", "idea three"]);
    expect(d[0].body).toBe("dog walking app\nfor busy people");
  });
  it("keeps one idea for plain prose", () => {
    expect(splitIntoIdeas("Just one long thought\nthat wraps")).toHaveLength(1);
  });
  it("returns nothing for empty text", () => expect(splitIntoIdeas(" \n ")).toEqual([]));
});

describe("extractDate", () => {
  it("prefers the email Date header over other dates", () => {
    expect(extractDate("Meeting on 2025-01-01\nDate: Tue, Mar 4, 2025 at 10:12 AM\nhi")).toBe("2025-03-04");
  });
  it("reads Gmail 'On ... wrote:' lines", () => {
    expect(extractDate("On Wed, Oct 8, 2025 at 9:00 PM Joe <j@x.com> wrote:")).toBe("2025-10-08");
  });
  it("handles ISO, day-month-year and US numeric dates", () => {
    expect(extractDate("2024-12-31 notes")).toBe("2024-12-31");
    expect(extractDate("written 4 July 2023")).toBe("2023-07-04");
    expect(extractDate("3/14/24")).toBe("2024-03-14");
    expect(extractDate("25/12/2024")).toBe("2024-12-25");
  });
  it("rejects impossible dates and returns null when none", () => {
    expect(extractDate("2024-02-30")).toBeNull();
    expect(extractDate("no dates here, version 3.2")).toBeNull();
  });
});

describe("parseTags", () => {
  it("lowercases, strips #, dedupes", () => expect(parseTags("#App, app  Surf,#surf")).toEqual(["app", "surf"]));
  it("keeps accented letters", () => expect(parseTags("ideia, café")).toEqual(["ideia", "café"]));
});

describe("sorting and grouping", () => {
  const a = idea({ title: "a", idea_date: "2026-10-05" });
  const b = idea({ title: "b", idea_date: null, captured_at: "2026-11-02T00:00:00Z" });
  const c = idea({ title: "c", idea_date: "2025-03-01" });
  it("sorts by idea date, falling back to capture date", () => {
    expect(sortIdeas([c, a, b]).map((i) => i.title)).toEqual(["b", "a", "c"]);
  });
  it("groups by month", () => {
    expect(groupByMonth([a, b, c]).map((g) => g.label)).toEqual(["November 2026", "October 2026", "March 2025"]);
  });
});

describe("filterIdeas", () => {
  const list = [
    idea({ title: "Surf log", tags: ["surf"], starred: true }),
    idea({ title: "Dog app", body: "walks", capture_id: "cap1" }),
  ];
  it("matches all words across title/body/tags/OCR text", () => {
    expect(filterIdeas(list, { q: "dog walks", starredOnly: false, tag: null })).toHaveLength(1);
    expect(filterIdeas(list, { q: "handwritten", starredOnly: false, tag: null }, (id) => (id === "cap1" ? "Handwritten page" : ""))).toHaveLength(1);
  });
  it("filters starred and tag", () => {
    expect(filterIdeas(list, { q: "", starredOnly: true, tag: null })).toHaveLength(1);
    expect(filterIdeas(list, { q: "", starredOnly: false, tag: "surf" })[0].title).toBe("Surf log");
  });
});

describe("misc", () => {
  it("todayLocal formats the local date", () => expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05"));
  it("draftFrom trims", () => expect(draftFrom("  hi\n")).toEqual({ title: "hi", body: "hi" }));
  it("exports markdown with every idea", () => {
    const md = toMarkdown([idea({ title: "X", starred: true, tags: ["a"], idea_date: "2026-01-01", body: "body" })]);
    expect(md).toContain("### ⭐ X");
    expect(md).toContain("#a");
    expect(md).toContain("body");
  });
});
