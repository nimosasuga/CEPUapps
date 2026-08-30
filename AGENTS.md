# CEPUapps Project Rules

## Mutlak
- Bahasa komunikasi utama: Indonesia.
- Project ini Google Apps Script web app V8.
- Jangan commit, push, deploy, `clasp push`, atau ubah akses produksi tanpa persetujuan eksplisit user.
- Jangan ubah secret, credential, token, `.clasp.json`, deployment ID, atau akses webapp tanpa instruksi eksplisit.
- Jangan menambah dependency kecuali tidak ada solusi native Apps Script/JavaScript.
- Plugin otomatis hanya menulis memori ke `OBSIDIAN_MEMORY/`. Tidak boleh memicu deploy atau push.
- Baca aturan relevan sebelum edit:
  - `OBSIDIAN_MEMORY/01_RULES/PROJECT_GUIDELINES.md`
  - `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md` untuk UI/responsive
  - `OBSIDIAN_MEMORY/02_ARCHITECTURE/PROJECT_MAP.md`

## Alur kerja wajib
- Pahami struktur file dulu, lalu edit minimum.
- Ikuti style file sekitar.
- Untuk Apps Script: batch read/write (`getValues`/`setValues`), fungsi client-callable tidak boleh suffix `_`, gunakan `SpreadsheetApp.flush()` setelah modifikasi spreadsheet.
- Untuk UI: desktop, tablet, mobile tidak boleh saling rusak.
- Setelah perubahan kode, jalankan validasi yang tersedia. Jika command test/lint tidak ada, laporkan singkat.
- Setelah sesi penting, simpan memori ringkas tapi lengkap ke `OBSIDIAN_MEMORY/04_SESSIONS/` memakai template.

## Versioning dan deploy
- Perubahan yang akan dideploy wajib bump `latestVersion` di `BE_Services.js`.
- Perubahan besar/security-sensitive: pertimbangkan `securityTick`.
- Deploy hanya setelah user menyetujui urutan: review diff, bump version, commit, push, `clasp push --force`.

## Memori Obsidian
- `OBSIDIAN_MEMORY/00_INDEX.md` adalah pintu masuk memori.
- Simpan keputusan arsitektur ke `OBSIDIAN_MEMORY/03_DECISIONS/`.
- Simpan bug, akar masalah, fix, file terdampak ke `OBSIDIAN_MEMORY/05_BUGS/`.
- Simpan deploy log ke `OBSIDIAN_MEMORY/06_DEPLOYMENTS/`.
- Jangan simpan secret di memori.
