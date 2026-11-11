# Good Ideas

A personal idea book. Type an idea or add a screenshot (handwritten notes, an email);
text is read on-device (tesseract.js), split into ideas, and saved with the date you had it.

- Sign-in: Google via the shared Thrivn Supabase project (schema `good_ideas`, RLS per user).
- Originals: private Storage bucket `good-ideas`, folder per user.
- DB install: `supabase/install.sql` (idempotent, additive).
- Demo mode: leave `VITE_SUPABASE_*` empty and ideas stay in the browser.

Dev: `npm install && npm run dev`. Test: `npm test`. Build: `npm run build`.
