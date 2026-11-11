import type { Idea } from "../lib/ideas";
import { formatDay } from "../lib/ideas";

export function IdeaCard({ idea, hasImage, onOpen, onStar }: { idea: Idea; hasImage: boolean; onOpen: () => void; onStar: () => void }) {
  const preview = idea.body.startsWith(idea.title) ? idea.body.slice(idea.title.length).trim() : idea.body;
  return (
    <div className="rounded-2xl bg-white border border-stone-200 p-4 flex gap-3 hover:border-stone-300">
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className="font-semibold text-stone-900">{idea.title}</div>
        {preview && <div className="mt-1 text-sm text-stone-600 line-clamp-2 whitespace-pre-line">{preview}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          <span>{idea.idea_date ? formatDay(idea.idea_date) : "Date unknown"}</span>
          {idea.idea_date_origin === "extracted" && <span title="Date read from the screenshot/email">📅 from source</span>}
          {hasImage && <span>🖼 screenshot</span>}
          {idea.tags.map((t) => (
            <span key={t} className="text-stone-600">#{t}</span>
          ))}
        </div>
      </button>
      <button onClick={onStar} aria-label={idea.starred ? "Unstar" : "Star"} className="text-xl self-start">
        {idea.starred ? "⭐" : "☆"}
      </button>
    </div>
  );
}
