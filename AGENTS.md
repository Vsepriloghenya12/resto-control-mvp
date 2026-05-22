\# Resto Control MVP instructions for Codex



\## Project overview



This is Ivan's resto-control-mvp project.



Main stack:

\- Node.js / Express backend

\- React / Vite / TypeScript frontend

\- Local JSON storage in development

\- PostgreSQL snapshot/schema when DATABASE\_URL exists

\- Railway deployment

\- Restaurant operations modules: bookings, requests, tasks, dashboard, staff/admin workflows



\## Main rules



\- Make only the requested changes.

\- Do not add extra features.

\- Do not redesign the UI unless explicitly asked.

\- Preserve the current architecture and app flow.

\- Keep the interface compact, functional, and clear.

\- Lists should be collapsed by default when that is the existing pattern.

\- If a section/header already expands a list on click, do not add a duplicate “Expand” button.

\- Avoid unnecessary cards/wrappers on mobile lists.

\- Do not add unnecessary comments to code.

\- Do not add new dependencies unless clearly necessary.

\- Do not expose or print .env values.



\## Product-specific rules



\- The product/purchase request feature is no longer needed. Do not restore or expand it unless explicitly requested.

\- Preserve booking, task, staff/admin, and restaurant-control logic.

\- Keep API contracts backward compatible unless the task specifically asks to change them.

\- If external API keys are missing, the app must still work with safe local fallback behavior.

\- Do not break Railway deployment.



\## Frontend rules



Relevant skills:

\- vercel-react-best-practices

\- web-design-guidelines

\- vercel-composition-patterns



When editing webapp:

\- preserve existing visual style;

\- keep screens compact and readable;

\- avoid duplicate controls;

\- keep mobile layout clean;

\- prefer small targeted component changes;

\- do not rewrite App.tsx unless explicitly asked;

\- preserve existing state and API flow.



\## Backend rules



When editing server:

\- preserve Express routes and response shapes;

\- keep local JSON/file storage working;

\- keep PostgreSQL/DATABASE\_URL mode safe;

\- preserve Railway build/start behavior;

\- avoid breaking existing data format;

\- add validation only where needed and without disrupting existing clients.



\## Verification



After changes, run relevant checks when available:



\- npm run build

\- npm run typecheck

\- npm test

\- backend smoke checks if server changes are made



If a check cannot be run, explain why.

