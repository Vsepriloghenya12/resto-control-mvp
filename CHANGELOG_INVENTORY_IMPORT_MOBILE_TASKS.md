# Inventory import + mobile tasks pass

- Added owner/manager inventory nomenclature import from PDF, Excel .xlsx/.xls, and CSV files.
- The import scans uploaded blanks for product names and measurement units, adds missing products to the selected inventory list, and keeps the imported list editable.
- Added server endpoint `POST /api/admin/inventory/import-template` scoped to the current restaurant.
- Added `pdf-parse` and `xlsx` dependencies for PDF/Excel import parsing.
- Raised API JSON body limit to 25 MB for base64 file uploads.
- Fixed mobile bottom sheets so quick actions and profile/logout panels open above the bottom navigation.
- Replaced the tech request composer with a dedicated mobile sheet above navigation.
- Removed tech request lists from the mobile Tasks page; the Tasks page now shows only active and completed tasks.
- Kept tech request creation available through Quick actions.

Checks:
- `npm run build` completed successfully.
- `node --check server/index.js` completed successfully.
- `node --check server/db.js` completed successfully.
