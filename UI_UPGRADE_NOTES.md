# SEL Center UI Upgrade

## Updated active screens
- `frontend/login.html`
- `frontend/pos.html`
- `frontend/manager.html`
- `frontend/admin.html`
- `frontend/ticket-admin.html`

## New shared UI layer
- `frontend/css/ui-enhancements.css`
- `frontend/js/ui-enhancements.js`

## Main improvements
- Unified SEL visual identity with deep red accents and modern neutral surfaces.
- Professional card, panel, table, form, header and navigation styling.
- Refined spacing, radii, shadows, typography hierarchy and responsive behavior.
- Restrained entrance animations and hover micro-interactions.
- Dynamic motion for product cards, cart items, ticket packages and alerts created at runtime.
- Live online/offline status indicator on operational screens.
- Password visibility toggle on login.
- Keyboard focus states and reduced-motion accessibility support.
- Existing application logic and Supabase integration left intact.

## Build
From `frontend/`:

```bash
npm run build
```

The generated `frontend/dist/` directory is included in this package.
