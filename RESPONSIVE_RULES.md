# RESPONSIVE_RULES

## Wajib setiap perubahan UI
- Cek desktop, tablet, mobile.
- Jangan fix mobile dengan merusak desktop.
- Jangan fix desktop dengan merusak mobile.
- Jika ada 2 layout berbeda (table desktop, card mobile), masing-masing wajib punya node DOM sendiri.

## Aturan DOM Builder
- Dilarang reuse DOM node ke lebih dari 1 parent.
- Setiap button, icon, badge, input, row action untuk layout berbeda wajib dibuat ulang dengan factory function.
- Contoh aman:
  - `const createBtnEdit = () => DOM_Engine.create(...)`
  - pakai `createBtnEdit()` untuk desktop
  - pakai `createBtnEdit()` lagi untuk mobile
- Contoh salah:
  - `const btnEdit = DOM_Engine.create(...)`
  - dipasang ke table lalu dipasang lagi ke mobile card

## Aturan responsive table
- Jika table terlalu lebar di mobile, jangan paksa sticky/fixed width terus.
- Untuk mobile, pertimbangkan card layout.
- Jika tetap table, pastikan kolom penting tetap terlihat.
- Kolom sekunder boleh hidden di mobile.

## Aturan approval/anomali
- Kolom aksi desktop wajib selalu terlihat di desktop.
- Layout mobile boleh card, tapi action desktop tidak boleh hilang.
- Filter, checkbox, dan bulk action harus tetap jalan di semua layout.

## Aturan verifikasi sebelum push
- Cek diff area yang diubah.
- Review komponen desktop/tablet/mobile yang terdampak.
- Khusus perubahan responsive, verifikasi:
  - sidebar
  - table
  - modal
  - action button
  - sticky column
  - overflow horizontal

## Aturan versioning wajib
- Setiap perubahan yang di-deploy wajib bump `latestVersion` di `BE_Services.js`.
- Tujuan: cache lama user ter-kill dan user dipaksa update ke versi terbaru.
- Jika perubahan besar/security-sensitive, pertimbangkan naikkan `securityTick`.

## Aturan deploy wajib
- Setelah perubahan selesai:
  1. update `latestVersion`
  2. `git add -A`
  3. `git commit`
  4. `git push origin main`
  5. `clasp push --force`

## Aturan komunikasi kerja
- Kalau selesai plan, minta switch ke build mode.
- Kalau ada akar bug, jelaskan akar bug dulu, bukan hanya gejalanya.
- Jangan ulangi bug yang sama dari reuse DOM node.
