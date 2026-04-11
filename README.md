# C.E.P.U ERP (Catatan Evaluasi Pekerja Utama) 🚀

Sistem Enterprise Resource Planning (ERP) & Human Resource Information System (HRIS) berbasis Google Apps Script (GAS) dan Serverless JavaScript. Dirancang dengan arsitektur skalabel, anti-fraud, dan DOM murni secepat kilat.

## 🏗️ Architecture Design
Sistem ini menggunakan arsitektur **6-File Modular** untuk memisahkan *Logic*, *View*, dan *Data*:
- **Backend (GAS):**
  - `BE_Config.gs`: Menyimpan ID Spreadsheets terdistribusi.
  - `BE_Services.gs`: API Endpoints, kalkulasi bisnis (UPD, Durasi), dan Dynamic Database Routing.
- **Frontend (SPA - Single Page Application):**
  - `UI_Base.html`: Kerangka utama & injeksi Tailwind CSS premium.
  - `JS_Engine.html`: Pure DOM Builder (`DOM_Engine`), Toast Notification, Device Fingerprinting.
  - `JS_Auth.html`: UI & Logika Autentikasi.
  - `JS_Dashboard.html`: UI Utama, Smart Router (Sales vs Ops), Form Keberangkatan, Scanner Hybrid, & Validasi GPS.

## 🛡️ Enterprise Security Features
1. **Device Fingerprinting:** Akun dikunci pada 1 perangkat fisik pertama kali login. (Anti-titip absen).
2. **One-Day-One-Checkin (ODOC):** Pencegahan multi-absen dalam satu hari untuk mencegah *fraud* klaim uang jalan.
3. **Dual-Validation Checkpoint:** Wajib validasi Kordinat GPS dan pemindaian Barcode Statis (`POS-SECURITY-FSET-01`).
4. **Hybrid Scanner:** Mendukung kamera langsung (pencarian kamera pintar) dan unggah foto bagi perangkat tanpa *webcam*.

## 💾 Distributed Database Routing
Memanfaatkan Google Sheets sebagai *database* berskala mikro-layanan:
1. `DB_Master_CEPU`: Pusat data karyawan, *credential*, tabel aturan Uang Perjalanan Dinas (UPD), dan status.
2. `DB_UPD_CEPU`: Log dinamis khusus untuk operasional (RFMC, FMC, Satelite).
3. `DB_SALES_CEPU`: Ruang log terisolasi khusus transaksi tinggi pengguna *Sales*.
4. `DB_REKAP`: Pencatat rekapitulasi matriks *horizontal auto-grid* untuk laporan akhir bulan HR.

## ⚡ Smart Features
- **Offline Resilience:** State perjalanan disimpan di `localStorage`. Aman dari *refresh* paksa.
- **WIB Timezone Lock:** Manipulasi tanggal agar selalu konsisten pada zona waktu Jakarta `+0700` terlepas dari server Google Cloud.
- **Auto-Kalkulasi UPD:** Mesin mendeteksi akhir pekan (Weekend) dan hari kerja untuk membedakan uang makan & kompensasi waktu (< 8 jam atau >= 8 jam).
- **Super Admin Override:** Akses *bypass* validasi *hardware* untuk keperluan *debugging* & keadaan darurat operasional.

## 🛠️ Deployment Guide
1. Buat proyek baru di Google Apps Script.
2. Salin keenam file (`.gs` dan `.html`) ke dalam editor.
3. Masukkan ID Spreadsheet masing-masing ke dalam `BE_Config.gs`.
4. Lakukan *Deploy -> New Deployment -> Web App*.
5. Akses web app dari *browser* PC atau Mobile.

---
*Architected with precision by Stlopanusaorus & Visionary Lead.*
