# Bookings and senior mobile tasks pass

- Removed the explanatory text under the mobile bookings title.
- Added a mobile task composer for senior roles directly on the Tasks screen.
- Senior bartender can assign tasks to bartenders or a specific bartender.
- Senior cook can assign tasks to cooks or a specific cook.
- Senior waiter can assign tasks to hall staff roles in their department.
- Tightened server-side task assignment rules so senior roles cannot assign tasks outside their department or to other senior/manager roles.
- When a senior role assigns a task to everyone, assignments are created only for allowed staff roles in that department, not for the senior themselves.

Checks:
- npm run build --workspace webapp
- node --check server/index.js
- node --check server/db.js
