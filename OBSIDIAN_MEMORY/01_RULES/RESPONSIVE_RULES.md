# RESPONSIVE_RULES

## Wajib setiap perubahan UI
- Cek desktop, tablet, mobile.
- Jangan fix mobile dengan merusak desktop.
- Jangan fix desktop dengan merusak mobile.
- Jika ada 2 layout berbeda, masing-masing wajib punya node DOM sendiri.

## DOM builder
- Dilarang reuse DOM node ke lebih dari 1 parent.
- Setiap button, icon, badge, input, row action untuk layout berbeda wajib dibuat ulang dengan factory function.
- Aman: `const createBtnEdit = () => DOM_Engine.create(...)`, lalu panggil ulang untuk desktop/mobile.
- Salah: `const btnEdit = DOM_Engine.create(...)`, lalu dipasang ke table dan mobile card.

## Responsive table
- Jika table terlalu lebar di mobile, jangan paksa sticky/fixed width terus.
- Untuk mobile, pertimbangkan card layout.
- Jika tetap table, pastikan kolom penting terlihat.
- Kolom sekunder boleh hidden di mobile.

## Approval/anomali
- Kolom aksi desktop wajib selalu terlihat di desktop.
- Layout mobile boleh card, tapi action desktop tidak boleh hilang.
- Filter, checkbox, bulk action harus tetap jalan di semua layout.

## Verifikasi UI
- Review diff area yang diubah.
- Verifikasi desktop/tablet/mobile untuk:
  - sidebar
  - table
  - modal
  - action button
  - sticky column
  - overflow horizontal

## Versioning deploy
- Setiap perubahan yang dideploy wajib bump `latestVersion` di `BE_Services.js`.
- Jika perubahan besar/security-sensitive, pertimbangkan naikkan `securityTick`.
- Commit, push, dan `clasp push --force` hanya setelah persetujuan eksplisit user.

## Komunikasi kerja
- Kalau selesai plan, minta switch ke build mode.
- Kalau ada akar bug, jelaskan akar bug dulu, bukan hanya gejala.
- Jangan ulangi bug yang sama dari reuse DOM node.
