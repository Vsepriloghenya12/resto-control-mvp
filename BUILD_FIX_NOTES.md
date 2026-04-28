# Build fix notes

Fixed TypeScript build error in `webapp/src/App.tsx` where conditional profile actions inferred `icon` as a generic string instead of `IconName`.

Validation:

```bash
npm install --no-audit --no-fund
npm run build
```

Result: build passed.
