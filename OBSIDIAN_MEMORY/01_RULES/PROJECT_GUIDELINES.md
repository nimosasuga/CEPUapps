# PROJECT_GUIDELINES

## Prinsip kerja
- Minimum diff. Jangan refactor area tidak terkait.
- Hapus duplikasi sebelum menambah abstraksi.
- Native Apps Script/JavaScript lebih utama daripada dependency baru.
- Jangan menulis komentar kecuali diminta atau diperlukan untuk batasan teknis.
- Jangan mengubah perilaku produksi tanpa instruksi eksplisit.

## Apps Script
- Runtime V8.
- Server file `.js`; client/UI file `.html`.
- Gunakan operasi batch spreadsheet: `getValues()`, `setValues()`, `getDisplayValues()`.
- Hindari loop `getValue()`/`setValue()` per cell.
- Fungsi yang dipanggil HTML via `google.script.run` harus public, tanpa suffix `_`.
- Setelah modifikasi Spreadsheet, panggil `SpreadsheetApp.flush()` sebelum return.
- Gunakan `UrlFetchApp`, `Utilities`, `PropertiesService`, `CacheService`; jangan asumsi API browser tersedia di server.
- Tangani error eksternal dengan `try/catch` dan `muteHttpExceptions: true` jika perlu membaca response.

## UI
- Baca `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md` sebelum ubah UI.
- Jangan menggabungkan logic DOM desktop dan mobile bila node dipasang ke parent berbeda.
- Aksesibilitas minimal wajib: label/input jelas, tombol bisa diklik, state loading/error terlihat.

## Security
- Jangan baca, tulis, cetak, atau simpan secret/token/credential.
- Jangan ubah `.clasp.json`, deployment ID, akses webapp, trigger produksi tanpa persetujuan eksplisit.
- Jangan log data sensitif.

## Validasi
- Cari command validasi dulu: README, package script, clasp, atau file project.
- Jika tidak ada lint/test/typecheck, laporkan singkat.
- Untuk Apps Script, minimal cek syntax JS/HTML dan diff file terdampak.

## Memori
- Setelah sesi penting, tulis catatan ke `OBSIDIAN_MEMORY/04_SESSIONS/YYYY-MM-DD_short-title.md`.
- Catatan wajib berisi: tujuan, file dibaca, file diubah, keputusan, bug/fix, validasi, next step.
- Jangan simpan rahasia di memori.
