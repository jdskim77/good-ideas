import { createClient, type Session } from "@supabase/supabase-js";
import type { Capture, DateOrigin, Idea } from "./ideas";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const BUCKET = "good-ideas";

export const cloudEnabled = Boolean(URL && KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = ReturnType<typeof createClient<any, "good_ideas">>;

export const supabase: SB | null = cloudEnabled
  ? createClient(URL!, KEY!, {
      db: { schema: "good_ideas" },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    })
  : null;

export interface NewIdea {
  title: string;
  body: string;
  idea_date: string | null;
  idea_date_origin: DateOrigin;
  tags: string[];
  starred?: boolean;
  capture_id?: string | null;
}

export interface NewCapture {
  kind: "text" | "image";
  raw_text: string | null;
  source_date: string | null;
  file?: Blob | null;
  ext?: string;
}

export interface Store {
  list(): Promise<{ ideas: Idea[]; captures: Capture[] }>;
  addCapture(c: NewCapture): Promise<Capture>;
  setCaptureText(id: string, raw_text: string, ocr_status: Capture["ocr_status"]): Promise<void>;
  addIdeas(items: NewIdea[]): Promise<Idea[]>;
  update(id: string, patch: Partial<NewIdea>): Promise<Idea>;
  remove(id: string): Promise<void>;
  imageUrl(c: Capture): Promise<string | null>;
}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function cloudStore(sb: SB, session: Session): Store {
  const uid = session.user.id;
  return {
    async list() {
      // Page through everything (the API caps a single response at ~1,000 rows).
      const all = async <T,>(table: string, orderCol: string): Promise<T[]> => {
        const out: T[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const r = await sb.from(table).select("*").order(orderCol, { ascending: false }).order("id").range(from, from + PAGE - 1);
          const rows = must(r) as T[];
          out.push(...rows);
          if (rows.length < PAGE) return out;
        }
      };
      const [ideas, captures] = await Promise.all([all<Idea>("ideas", "captured_at"), all<Capture>("captures", "created_at")]);
      return { ideas, captures };
    },
    async addCapture(c) {
      const id = crypto.randomUUID();
      let storage_path: string | null = null;
      if (c.file) {
        storage_path = `${uid}/${id}.${c.ext ?? "png"}`;
        const up = await sb.storage.from(BUCKET).upload(storage_path, c.file, {
          contentType: c.file.type || "image/png",
          upsert: false,
        });
        if (up.error) throw new Error("Upload failed: " + up.error.message);
      }
      const row = {
        id, kind: c.kind, storage_path, raw_text: c.raw_text, source_date: c.source_date,
        ocr_status: c.kind === "image" ? "pending" : "none",
      };
      return must(await sb.from("captures").insert(row).select().single()) as Capture;
    },
    async setCaptureText(id, raw_text, ocr_status) {
      must(await sb.from("captures").update({ raw_text, ocr_status }).eq("id", id).select("id"));
    },
    async addIdeas(items) {
      if (!items.length) return [];
      return must(await sb.from("ideas").insert(items).select()) as Idea[];
    },
    async update(id, patch) {
      return must(await sb.from("ideas").update(patch).eq("id", id).select().single()) as Idea;
    },
    async remove(id) {
      must(await sb.from("ideas").delete().eq("id", id).select("id"));
    },
    async imageUrl(c) {
      if (!c.storage_path) return null;
      const r = await sb.storage.from(BUCKET).createSignedUrl(c.storage_path, 60 * 60);
      return r.data?.signedUrl ?? null;
    },
  };
}

/** Demo mode: everything in this browser's localStorage (images as data URLs). */
export function localStore(): Store {
  const KEY_I = "good-ideas:ideas";
  const KEY_C = "good-ideas:captures";
  const read = <T,>(k: string): T[] => JSON.parse(localStorage.getItem(k) || "[]");
  const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  const toDataUrl = (b: Blob) =>
    new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(b);
    });
  return {
    async list() {
      return { ideas: read<Idea>(KEY_I), captures: read<Capture>(KEY_C) };
    },
    async addCapture(c) {
      const cap: Capture = {
        id: crypto.randomUUID(), kind: c.kind, raw_text: c.raw_text, source_date: c.source_date,
        storage_path: c.file ? await toDataUrl(c.file) : null,
        ocr_status: c.kind === "image" ? "pending" : "none", created_at: new Date().toISOString(),
      };
      write(KEY_C, [cap, ...read<Capture>(KEY_C)]);
      return cap;
    },
    async setCaptureText(id, raw_text, ocr_status) {
      write(KEY_C, read<Capture>(KEY_C).map((c) => (c.id === id ? { ...c, raw_text, ocr_status } : c)));
    },
    async addIdeas(items) {
      const now = new Date().toISOString();
      const made: Idea[] = items.map((i) => ({
        id: crypto.randomUUID(), capture_id: i.capture_id ?? null, title: i.title, body: i.body,
        idea_date: i.idea_date, idea_date_origin: i.idea_date_origin, tags: i.tags, starred: i.starred ?? false,
        captured_at: now, updated_at: now,
      }));
      write(KEY_I, [...made, ...read<Idea>(KEY_I)]);
      return made;
    },
    async update(id, patch) {
      let out: Idea | undefined;
      write(KEY_I, read<Idea>(KEY_I).map((i) => (i.id === id ? (out = { ...i, ...patch, updated_at: new Date().toISOString() }) : i)));
      if (!out) throw new Error("Idea not found");
      return out;
    },
    async remove(id) {
      write(KEY_I, read<Idea>(KEY_I).filter((i) => i.id !== id));
    },
    async imageUrl(c) {
      return c.storage_path;
    },
  };
}
