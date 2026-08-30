# PROJECT_MAP

## Tipe project
- Google Apps Script web app V8.
- Backend Apps Script `.js`.
- Frontend HTML/CSS/JS dalam `.html`.
- Manifest: `appsscript.json`.

## File utama
- `appsscript.json`: timezone, runtime V8, webapp access.
- `BE_Config.js`: konfigurasi backend project.
- `BE_Services.js`: service backend, versioning `latestVersion`, kemungkinan `securityTick`.
- `UI_Base.html`: layout dasar UI.
- `JS_Auth.html`: logic autentikasi client.
- `JS_Dashboard.html`: logic dashboard client.
- `JS_Engine.html`: engine/helper client.
- `RESPONSIVE_RULES.md`: aturan responsive lama, isi sudah dikonsolidasikan ke `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md`.
- `AGENTS.md`: aturan mutlak opencode.
- `opencode.json`: konfigurasi project opencode.

## Area hati-hati
- `.clasp.json`: jangan ubah tanpa instruksi eksplisit.
- `appsscript.json.webapp.access`: jangan ubah tanpa instruksi eksplisit.
- Deployment/versioning: bump hanya untuk perubahan yang akan dideploy.
