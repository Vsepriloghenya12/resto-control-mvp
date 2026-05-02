# Mobile Fix Notes

- Raised mobile modal overlays above the bottom navigation so the tech-request submit form is not hidden after using the + create action.
- Added mobile-specific bottom spacing and height limits for sheet-like modals.
- Changed inventory quantity fields from decimal keyboard to telephone-style keyboard and added a pattern allowing digits, plus signs, comma and dot separators.
- Verified webapp production build with `npm run build --workspace webapp`.
- Reworked employee mobile checklists into a native mobile card flow: horizontal template picker, progress summary, 44px touch checkbox controls, numbered item chips, styled required/photo/comment/status tags, cleaner photo/comment blocks, and responsive compact spacing for narrow screens.
