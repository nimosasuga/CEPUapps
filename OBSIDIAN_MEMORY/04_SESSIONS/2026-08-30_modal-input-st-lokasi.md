# 2026-08-30 Modal Input No ST Tampilkan Lokasi

## Metadata
- Tanggal: 2026-08-30
- Task: tambah lokasi di header pilihan kunjungan modal Input No ST Epicor
- Mode: build
- Status: selesai

## Tujuan
- Pada alur Log Perjalanan (UPD) > Input No ST Epicor, label pilihan kunjungan menampilkan customer dan lokasi.

## Konteks dibaca
- `JS_Dashboard.html`
- `BE_Services.js`
- `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md`
- `OBSIDIAN_MEMORY/02_ARCHITECTURE/PROJECT_MAP.md`

## File diubah
- `JS_Dashboard.html`

## Keputusan
- Pakai data `l.lokasi` karena item list modal memakai variabel `l`, bukan `k`.
- Edit minimum pada `action_openInputSTModal()`.

## Bug / akar masalah / fix
- Sebelumnya header pilihan kunjungan hanya menampilkan `l.customer`.
- Fix: ubah children menjadi template literal `${l.customer} ${l.lokasi || '-'}`.

## Validasi
- `git diff --check` sukses.
- Tidak ada `package.json`, jadi tidak ada lint/test npm tersedia.

## Risiko
- Tampilan bisa terlalu panjang bila customer + lokasi sangat panjang; class belum ditambah `truncate` karena user hanya minta tambahan teks.

## Next step
- Review UI desktop/mobile pada modal Input No ST Epicor.
- Deploy hanya bila user menyetujui bump version, commit, push, dan `clasp push --force`.
