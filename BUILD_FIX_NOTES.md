# Build fix

- Added a safe legacy `webapp/src/modules/requests/Requests.tsx` stub so an old folder left from previous versions no longer breaks TypeScript builds when files are copied over an existing project.
- Restored a compatibility `requestStatuses` export in `dictionaries.ts` for stale files that may still be present in older deploy contexts.
- The product request feature remains removed from active navigation and UI.
