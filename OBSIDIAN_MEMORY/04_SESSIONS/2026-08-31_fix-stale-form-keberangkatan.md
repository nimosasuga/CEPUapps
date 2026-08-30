# 2026-08-31 Fix Stale State Form Keberangkatan

## Metadata
- Tanggal: 2026-08-31
- Task: perbaiki state perjalanan lintas hari pada Form Keberangkatan
- Mode: build
- Status: selesai lokal

## Tujuan
- Mencegah `cepu_dinas_state` lama menampilkan perjalanan tanggal sebelumnya.
- Sinkronkan state lokal dengan `activeTrip` dari server saat boot.

## Konteks dibaca
- `JS_Dashboard.html`
- `BE_Services.js`
- `JS_Auth.html`
- `BE_Config.js`
- `OBSIDIAN_MEMORY/01_RULES/PROJECT_GUIDELINES.md`
- `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md`

## File diubah
- `JS_Dashboard.html`

## Keputusan
- Tambah `syncDinasStateFromServer()`.
- Jika server tidak mengembalikan `activeTrip`, cache lokal dihapus dan Form Keberangkatan dirender.
- Jika server gagal, cache dipertahankan agar gangguan jaringan tidak memutus sesi aktif secara keliru.
- Backend `AutoSweeper` dan indeks status diverifikasi konsisten; bukan akar masalah.

## Bug / akar masalah / fix
- Akar: boot client langsung mempercayai `localStorage.cepu_dinas_state` pada `JS_Dashboard.html:471-482`.
- Fix: boot memvalidasi cache ke `api_getInitFormData()` sebelum `renderView_MainLayout()`.

## Validasi
- `git diff --check` sukses.
- Tidak ada `package.json`, jadi lint/test npm tidak tersedia.

## Risiko
- Jika request validasi gagal, state cache tetap dipakai untuk menjaga UX offline; refresh berikutnya akan mencoba sinkronisasi lagi.

## Next step
- Review diff.
- Jika akan deploy: bump `latestVersion` di `BE_Services.js`, commit, push, lalu `clasp push --force` setelah persetujuan eksplisit.
