// ==============================================================================
// FILE: BE_Services.gs
// TIPE: SERVER-SIDE SCRIPT
// DESKRIPSI: API Endpoints (Routing, Login, Berangkat, dan Absen Pulang)
// UPDATE: Dynamic Status Absensi & Lookup Master_Status_Absensi
// ==============================================================================

function doGet(e) {
  e = e || { parameter: {} };
  // 1. Logika Verifikasi Publik (Tanpa Login)
if (e.parameter.verify_st && e.parameter.nrpp) {
    return renderPublicVerification(
      e.parameter.verify_st,
      e.parameter.nrpp
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 2. Logika Dashboard Internal (Tetap Aman)
  let template = HtmlService.createTemplateFromFile('UI_Base');

  // [ZERO LATENCY FIX]: Injeksi Config dari Server langsung ke HTML Frontend
  template.serverConfig = JSON.stringify(api_getSystemConfig());

  return template
    .evaluate()
    .setTitle('C.E.P.U - Enterprise Portal')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    )
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --- MODUL LOOKUP DATA MASTER ---

function api_getInitFormData(user) {
  try {
    user = _syncFreshUser(user);
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetStatus = dbMaster.getSheetByName('Master_Status_Absensi');
    const dataStatus = sheetStatus.getDataRange().getValues();

    let options = [];
    let userLokasi = user.lokasi
      ? String(user.lokasi).toUpperCase().trim()
      : '';
    let userJabatan = user.jabatan
      ? String(user.jabatan).toUpperCase().trim()
      : '';

    // [STRICT FILTER]: Menarik Status Kehadiran murni dari kolom Lokasi Master_Status_Absensi
    for (let i = 1; i < dataStatus.length; i++) {
      let filterArea = dataStatus[i][2]
        ? String(dataStatus[i][2]).toUpperCase()
        : '';
      // Memecah teks koma (Contoh: "SATELITE, RFMC, SALES") menjadi array
      let areaArray = filterArea.split(',').map((a) => a.trim());

      if (areaArray.includes(userLokasi)) {
        options.push({ code: dataStatus[i][0], desc: dataStatus[i][1] });
      }
    }

    // [UPDATE FIX]: Smart Routing DB Sales vs UPD untuk History & Active Trip
    const isSales = userLokasi === 'SALES' || userJabatan === 'SALES';
    const dbApp = isSales
      ? SpreadsheetApp.openById(DB_SALES_ID)
      : SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = isSales ? 'Log_Sales' : 'Log_' + user.lokasi.trim();
    let sheetLog = dbApp.getSheetByName(targetSheetName);

    let history = [];
    let activeTrip = null; // [NEW]: Penampung Trip Aktif

    if (sheetLog) {
      const dataLog = sheetLog.getDataRange().getValues();
      let stSet = new Set();

      for (let i = dataLog.length - 1; i >= 1; i--) {
        if (dataLog[i][1].toString() === user.nrpp.toString()) {
          // [NEW PULL ACTIVE STATE]: Cek apakah ada trip gantung (Sedang Jalan)
          let statusPerjalanan = isSales ? dataLog[i][15] : dataLog[i][17];
          if (!activeTrip && statusPerjalanan === 'SEDANG JALAN') {
            let rawTime = dataLog[i][isSales ? 10 : 11];
            let waktuFormat =
              rawTime instanceof Date
                ? Utilities.formatDate(
                    rawTime,
                    'Asia/Jakarta',
                    'dd/MM/yyyy HH:mm:ss'
                  )
                : rawTime.toString();

            // [NEW PULL ACTIVE STATE]: Cek apakah ada trip gantung (Sedang Jalan)
            let statusPerjalanan = isSales ? dataLog[i][15] : dataLog[i][17];
            if (!activeTrip && statusPerjalanan === 'SEDANG JALAN') {
              let rawTime = dataLog[i][isSales ? 10 : 11];
              let waktuFormat =
                rawTime instanceof Date
                  ? Utilities.formatDate(
                      rawTime,
                      'Asia/Jakarta',
                      'dd/MM/yyyy HH:mm:ss'
                    )
                  : rawTime.toString();

              // ==========================================================
              // [PATCH]: TARIK SOURCE OF TRUTH DARI KOLOM W (OPS)
              // ==========================================================
              let realStatus = 'H (Non Project)'; // Safe fallback

              // Jika ini divisi OPS dan Kolom W (Index 22) ada isinya, gunakan itu!
              if (!isSales && dataLog[i][22]) {
                realStatus = dataLog[i][22].toString().trim();
              }
              // ==========================================================

              activeTrip = {
                idTransaksi: dataLog[i][0].toString(),
                waktuKeluar: waktuFormat,
                lokasi: dataLog[i][isSales ? 9 : 10].toString(),
                customer: dataLog[i][isSales ? 8 : 9].toString(),
                statusAbsensi: realStatus, // <-- Menyuntikkan status aktual BKS/dll
              };
            }
          }

          let noSTRaw = isSales ? '' : dataLog[i][8];
          let noST = noSTRaw ? String(noSTRaw).replace(/^'/, '').trim() : '';

          if (noST !== '' && !stSet.has(noST)) {
            stSet.add(noST);
            history.push({
              noST: noST,
              customer: dataLog[i][isSales ? 8 : 9]
                ? dataLog[i][isSales ? 8 : 9].toString()
                : '',
              lokasi: dataLog[i][isSales ? 9 : 10]
                ? dataLog[i][isSales ? 9 : 10].toString()
                : '',
            });
          }
        }
      }
    }

    return {
      status: 'success',
      data: {
        statusOptions: options,
        historyST: history,
        activeTrip: activeTrip,
      },
    };
  } catch (error) {
    return { status: 'error', message: error.toString() };
  }
}

// ==========================================================
// MODUL LOGIN & SECURITY: STRICT DEVICE BINDING (ANTI-TITIP ABSEN)
// ==========================================================
/**
 * [CRITICAL ENGINE]: Memverifikasi kredensial login dan binding perangkat keras (Anti-Titip Absen).
 * @param {string|number} nrpp - Nomor Register Pokok Pegawai
 * @param {string} password - Kata sandi teks murni
 * @param {string} deviceId - Adaptive Device Binding ID (format: FP-xxx atau DEV-xxx)
 * @returns {AuthResponse}
 */
function api_verifyLogin(nrpp, password, deviceId) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetLogin = dbMaster.getSheetByName('Master_Login');
    const dataLogin = sheetLogin.getDataRange().getValues();
    const headers = dataLogin[0].map((h) => h.toString().toUpperCase().trim());

    const idx = {
      nrpp: headers.indexOf('NRPP'),
      pass: headers.indexOf('PASSWORD'),
      devId: headers.indexOf('DEVICE_ID'),
      name: headers.indexOf('NAMA'),
      lastLogin: headers.indexOf('LAST_LOGIN'),
    };

    if (idx.nrpp === -1 || idx.pass === -1)
      throw new Error('Struktur kolom Master_Login rusak!');

    let userFound = false;
    let userData = null;

    for (let i = 1; i < dataLogin.length; i++) {
      let row = dataLogin[i];

      // Pengecekan NRPP dan Password
      if (
        row[idx.nrpp].toString() === nrpp.toString() &&
        row[idx.pass].toString() === password.toString()
      ) {
        let registeredDeviceId = row[idx.devId]
          ? row[idx.devId].toString().trim()
          : '';
        let rowIndex = i + 1;

        // ==========================================================
        // [SECURITY LOCK]: ADAPTIVE BINDING (ANTI-WEBKIT EVICTION)
        // ==========================================================
        let incomingId = deviceId.toString().trim();
        let registeredId = row[idx.devId]
          ? row[idx.devId].toString().trim()
          : '';
        let isAuthorized = false;

        if (registeredId === '') {
          // Skenario HP Baru / Reset Admin
          isAuthorized = true;
          sheetLogin.getRange(rowIndex, idx.devId + 1).setValue(incomingId);
        } else if (registeredId === incomingId) {
          // Skenario Normal (Exact Match)
          isAuthorized = true;
        } else {
          // FALLBACK: Periksa Protokol Fingerprint (FP-)
          let regParts = registeredId.split('-');
          let incParts = incomingId.split('-');

          // Cek apakah kedua ID adalah tipe Fingerprint dan memiliki STABLE_HASH yang sama
          if (
            regParts[0] === 'FP' &&
            incParts[0] === 'FP' &&
            regParts[1] === incParts[1]
          ) {
            isAuthorized = true;
            // AUTO-HEAL: Update Database dengan Entropy baru agar sinkron kembali
            sheetLogin.getRange(rowIndex, idx.devId + 1).setValue(incomingId);
            console.log(`Auto-Heal executed for NRPP: ${nrpp}`);
          }
        }

        if (!isAuthorized) {
          return {
            status: 'error',
            message:
              '⛔ SECURITY LOCK: Akun sudah terikat di perangkat lain. Gunakan browser yang sama atau hubungi Admin.',
          };
        }
        // ==========================================================

        userFound = true;
        sheetLogin.getRange(rowIndex, idx.lastLogin + 1).setValue(new Date());

        // [RESTORED]: Catat histori aktivitas di Kolom F
        _stampActivityLog(sheetLogin, rowIndex, 5);

        // ==========================================================
        // [PATCH]: Pengambilan detil menggunakan mapper terpusat
        // ==========================================================
        const sheetKaryawan = dbMaster.getSheetByName('Master_Karyawan');
        const dataKar = sheetKaryawan.getDataRange().getValues();
        const detailsRow = dataKar.find(
          (r) => r[MAP_KARYAWAN.NRPP].toString() === nrpp.toString()
        );

        userData = detailsRow
          ? _mapKaryawanRow(detailsRow)
          : { nrpp: nrpp, nama: row[idx.name] }; // Fallback jika di Master_Karyawan belum ada

        // Finalisasi Normalisasi
        userData = _normalizeUserSession(userData);

        // ==========================================================
        // [UPD ELIGIBILITY]: Pengecekan Hak Akses UPD
        // ==========================================================
        const sheetUPD = dbMaster.getSheetByName('Master_UPD');
        if (sheetUPD) {
          const dataUPD = sheetUPD.getDataRange().getValues();
          let headUPD = dataUPD[0].map((h) =>
            h.toString().toUpperCase().trim()
          );
          let idxJabUPD = headUPD.indexOf('JABATAN');

          if (idxJabUPD !== -1) {
            userData.isUpdEligible = dataUPD.some(
              (r) =>
                r[idxJabUPD].toString().trim().toUpperCase() ===
                userData.jabatan.toString().trim().toUpperCase()
            );
          } else {
            userData.isUpdEligible = false;
          }
        }
        break;
      }
    }

    if (!userFound)
      return { status: 'error', message: 'NRPP atau Password salah!' };
    return { status: 'success', data: userData };
  } catch (error) {
    return { status: 'error', message: 'System Error: ' + error.toString() };
  }
}

// [PATCH]: Mengubah log akumulatif menjadi Log Terakhir Saja (Single Entry)
function _stampActivityLog(sheet, rowIndex, colIndex, type = 'MANUAL') {
  const cell = sheet.getRange(rowIndex, colIndex + 1);
  const timestamp = Utilities.formatDate(
    new Date(),
    'Asia/Jakarta',
    'dd/MM/yy HH:mm'
  );

  // Format entry tetap sama, tapi langsung setValue tanpa mengambil data lama
  const newEntry = `[${timestamp} - ${type}]`;

  cell.setValue(newEntry);
}

// ==========================================================
// [SECURITY FIX]: ZERO TRUST ARCHITECTURE ENGINE
// Memaksa Backend mengambil data profil paling baru langsung dari Master DB,
// mengabaikan cache lama yang mungkin nyangkut di HP Karyawan.
// ==========================================================
function _syncFreshUser(cachedUser) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetKaryawan = dbMaster.getSheetByName('Master_Karyawan');
    const dataKar = sheetKaryawan.getDataRange().getValues();

    // [PATCH]: Eliminasi loop manual dan indexOf, gunakan MAP_KARYAWAN
    const detailsRow = dataKar.find(
      (r) => r[MAP_KARYAWAN.NRPP].toString() === cachedUser.nrpp.toString()
    );

    if (detailsRow) {
      const freshData = _mapKaryawanRow(detailsRow);
      // Update session dengan data terbaru secara atomik
      Object.assign(cachedUser, freshData);
    }
    return _normalizeUserSession(cachedUser);
  } catch (e) {
    return _normalizeUserSession(cachedUser);
  }
}

/**
 * [CRITICAL ENGINE]: Mencatat perjalanan dinas keberangkatan ke arsitektur Active Log.
 * Memisahkan rute penyimpanan antara divisi Sales dan divisi Operasional.
 * @param {KeberangkatanPayload} payload - Data mentah dari UI Dashboard
 * @param {UserSession} user - Objek sesi user tervalidasi
 * @returns {KeberangkatanResponse}
 */
function api_submitPerjalananDinas(payload, user) {
  try {
    user = _syncFreshUser(user);
    if (!user.lokasi)
      throw new Error('Data Lokasi Karyawan kosong di Master Database!');
    const userLokasiUpper = user.lokasi.toString().trim().toUpperCase();
    const isSales =
      userLokasiUpper === 'SALES' ||
      user.jabatan.toString().trim().toUpperCase() === 'SALES';

    const dbApp = isSales
      ? SpreadsheetApp.openById(DB_SALES_ID)
      : SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = isSales ? 'Log_Sales' : 'Log_' + user.lokasi.trim();

    let sheet = dbApp.getSheetByName(targetSheetName);
    if (!sheet)
      throw new Error(
        "Sheet database tujuan ('" +
          targetSheetName +
          "') tidak ditemukan di database!"
      );

    const timestamp = new Date();
    const timeToSave = Utilities.formatDate(
      timestamp,
      'Asia/Jakarta',
      'yyyy/MM/dd HH:mm:ss'
    );

    const d_wib = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'dd');
    const m_wib = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'MM');
    const y_wib = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'yyyy');

    // ==========================================================
    // PROTOKOL ODOC (One-Day-One-Checkin) - DYNAMIC COLUMN VALIDATOR
    // ==========================================================
    if (!_hasPrivilegedAccess(user)) {
      const dataLog = sheet.getDataRange().getValues();

      let nrppIndex = 1;
      let waktuKeluarIndex = isSales ? 10 : 11; // Default Index

      if (dataLog.length > 0) {
        let header = dataLog[0];
        for (let c = 0; c < header.length; c++) {
          let colName = header[c].toString().toUpperCase().trim();
          if (colName === 'NRPP') nrppIndex = c;
          // [UPDATE]: Mencari Index Kolom Waktu Keluar secara dinamis
          if (colName === 'WAKTU_KELUAR' || colName === 'WAKTU KELUAR')
            waktuKeluarIndex = c;
        }
      }

      // [PATCH]: ODOC Validator menggunakan MAP_LOG_OPS & DTO (FIXED)
      for (let i = 1; i < dataLog.length; i++) {
        let logDTO = _mapLogOpsRow(dataLog[i], MAP_LOG_OPS); // <- [FIX] Inject map explisit
        let normalized = _normalizeLogOpsDTO(logDTO);        // <- [FIX] Typo nama fungsi

        if (normalized && normalized.nrpp === String(user.nrpp).trim().toUpperCase()) {
          // [FIX] Ekstraksi tanggal mutlak dari wKeluarObj
          let logDateStr = "";
          if (normalized.wKeluarObj && normalized.wKeluarObj.getTime() > 0) {
            logDateStr = Utilities.formatDate(normalized.wKeluarObj, 'Asia/Jakarta', 'yyyy/MM/dd');
          }
          let todayTarget = y_wib + '/' + m_wib + '/' + d_wib;
          
          if (logDateStr === todayTarget) {
            return {
              status: 'error',
              message: '⛔ FRAUD ALERT: Anda sudah melakukan absensi keberangkatan hari ini. (Limit 1x/Hari)',
            };
          }
        }
      }

    }
    // ==========================================================

    const idTransaksi = 'TRX-' + timestamp.getTime();
    const statusAbsensi = payload.statusAbsensi || 'H';

    // ==========================================================
    // [UNIVERSAL SECURITY]: PROTOKOL HAVERSINE BERANGKAT
    // ==========================================================
    if (!_isSuperAdmin(user)) {
      // [SECURITY FIX]: Radius validasi GPS HANYA aktif jika statusnya persis "H (Non Project)".
      // Status H (Project), H (Satelite), ST, VC dll akan otomatis lolos (Bypass).
      if (statusAbsensi.toUpperCase().trim() === 'H (NON PROJECT)') {
        const gpsCheck = _checkRadiusValidation(
          userLokasiUpper,
          payload.kordinat
        );
        if (!gpsCheck.valid) {
          return { status: 'error', message: gpsCheck.message };
        }
      }
    }
    // ==========================================================

    let rowData = [];
    if (isSales) {
      rowData = [
        idTransaksi,
        user.nrpp,
        user.nama,
        user.jabatan,
        user.golongan,
        user.statusKaryawan,
        user.departemen,
        user.lokasi,
        payload.customer,
        payload.lokasi,
        timeToSave,
        payload.kordinat,
        '',
        '',
        '',
        'SEDANG JALAN',
      ];
    } else {
      // [PATCH]: Konstruksi rowData menggunakan MAP_LOG_OPS (Anti Column-Shift)
      rowData = new Array(Math.max(...Object.values(MAP_LOG_OPS)) + 1).fill('');
      rowData[MAP_LOG_OPS.ID_TRANSAKSI] = idTransaksi;
      rowData[MAP_LOG_OPS.NRPP] = user.nrpp;
      rowData[MAP_LOG_OPS.NO_ST] = "'" + payload.noST;
      rowData[MAP_LOG_OPS.CUSTOMER] = payload.customer;
      rowData[MAP_LOG_OPS.LOKASI_DEST] = payload.lokasi;
      rowData[MAP_LOG_OPS.WAKTU_KELUAR] = timeToSave;
      rowData[MAP_LOG_OPS.KORDINAT_KELUAR] = payload.kordinat;
      rowData[MAP_LOG_OPS.STATUS_JALAN] = 'SEDANG JALAN';
      rowData[MAP_LOG_OPS.STATUS_KLAIM] = 'BELUM KLAIM';
      rowData[MAP_LOG_OPS.SOURCE_OF_TRUTH] = statusAbsensi;

      // Map data profil user ke kolom awal (A-H)
      rowData[0] = idTransaksi; // Re-confirm A
      rowData[2] = user.nama;
      rowData[3] = user.jabatan;
      rowData[4] = user.golongan;
      rowData[5] = user.statusKaryawan;
      rowData[6] = user.departemen;
      rowData[7] = user.lokasi;
    }

    // ==========================================================
    // [KOREKSI MUTLAK ARRAYFORMULA]: REVERSE LOOP ALGORITHM
    // Mencegah data tertimpa jika ada baris kosong di tengah tabel
    // ==========================================================
    const maxRows = sheet.getLastRow();
    let targetRow = 2; // Default jika tabel benar-benar kosong (mulai setelah Header)

    if (maxRows > 0) {
      // Hanya menarik 1 kolom (Kolom A) agar eksekusi sangat ringan dan secepat kilat
      const colA = sheet.getRange(1, 1, maxRows, 1).getValues();
      for (let i = colA.length - 1; i >= 0; i--) {
        if (colA[i][0] !== '') {
          targetRow = i + 2; // i + 1 untuk index aktual, +1 lagi untuk turun ke baris kosong
          break;
        }
      }
    }

    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    // ==========================================================

// [AUTO-GRID DB_REKAP]
    const lockRekapIN = LockService.getScriptLock(); // [PATCH]: Inisiasi Kunci Transaksi
    try {
      // [PATCH]: Antre maksimal 15 detik. Jika tabrakan, sistem akan menunggu.
      if (!lockRekapIN.tryLock(15000)) throw new Error("Sistem sibuk, gagal mengunci DB_REKAP (Timeout).");
      
      const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);
      let rekapSheetName = '';
      if (isSales) rekapSheetName = 'Rekap_Absensi_Sales';
      else if (userLokasiUpper === 'FMC') rekapSheetName = 'Rekap_Absesnsi_FMC';
      else if (userLokasiUpper === 'SATELITE')
        rekapSheetName = 'Rekap_Absesnsi_Satelite';
      else rekapSheetName = 'Rekap_Absensi_' + user.lokasi.trim();

      const rekapSheet = dbRekap.getSheetByName(rekapSheetName);
      if (rekapSheet) {
        const todayStr = Utilities.formatDate(
          timestamp,
          'Asia/Jakarta',
          'dd/MM/yyyy'
        );
        const timeStr = Utilities.formatDate(
          timestamp,
          'Asia/Jakarta',
          'HH:mm'
        );
        const dataRekap = rekapSheet.getDataRange().getValues();
        let tRow = -1;
        let tCol = -1;

        for (let r = 1; r < dataRekap.length; r++) {
          if (dataRekap[r][0].toString() === user.nrpp.toString()) {
            tRow = r + 1;
            break;
          }
        }

        if (tRow === -1) {
          tRow = rekapSheet.getLastRow() + 1;
          if (tRow < 3) tRow = 3;
          rekapSheet.getRange(tRow, 1).setValue(user.nrpp);
          rekapSheet.getRange(tRow, 2).setValue(user.nama);
          if (rekapSheet.getRange('A1').getValue() === '') {
            rekapSheet
              .getRange('A1:A2')
              .merge()
              .setValue('NRPP')
              .setBackground('#000000')
              .setFontColor('#FFFFFF')
              .setHorizontalAlignment('center')
              .setVerticalAlignment('middle')
              .setFontWeight('bold');
            rekapSheet
              .getRange('B1:B2')
              .merge()
              .setValue('Nama')
              .setBackground('#000000')
              .setFontColor('#FFFFFF')
              .setHorizontalAlignment('center')
              .setVerticalAlignment('middle')
              .setFontWeight('bold');
          }
        }

        let headerRow = dataRekap.length > 0 ? dataRekap[0] : [];
        for (let c = 2; c < headerRow.length; c += 4) {
          let cellDateStr =
            headerRow[c] instanceof Date
              ? Utilities.formatDate(headerRow[c], 'Asia/Jakarta', 'dd/MM/yyyy')
              : headerRow[c].toString();
          if (cellDateStr.includes(todayStr)) {
            tCol = c + 1;
            break;
          }
        }

        if (tCol === -1) {
          tCol = rekapSheet.getLastColumn() + 1;
          if (tCol < 3) tCol = 3;
          rekapSheet.getRange(1, tCol).setValue(todayStr);
          rekapSheet
            .getRange(1, tCol, 1, 4)
            .mergeAcross()
            .setBackground('#000000')
            .setFontColor('#FFFFFF')
            .setHorizontalAlignment('center')
            .setFontWeight('bold');
          rekapSheet.getRange(2, tCol).setValue('IN');
          rekapSheet.getRange(2, tCol + 1).setValue('OUT');
          rekapSheet.getRange(2, tCol + 2).setValue('STATUS');
          rekapSheet.getRange(2, tCol + 3).setValue('DURASI');
          rekapSheet
            .getRange(2, tCol, 1, 4)
            .setBackground('#000000')
            .setFontColor('#FFFFFF')
            .setHorizontalAlignment('center')
            .setFontWeight('bold');
        }

        rekapSheet.getRange(tRow, tCol).setValue(timeStr);
        rekapSheet.getRange(tRow, tCol + 2).setValue(statusAbsensi);
        
        // [PATCH]: Paksa I/O ke database seketika sebelum lock dilepas
        SpreadsheetApp.flush(); 
      }
    } catch (e) {
      console.error('Error DB_REKAP IN: ' + e.message);
    } finally {
      // [PATCH]: Mutlak lepaskan gembok
      lockRekapIN.releaseLock(); 
    }

    return {
      status: 'success',
      message: 'Keberangkatan Berhasil. Status: ' + statusAbsensi,
      data: {
        idTransaksi: idTransaksi,
        waktuKeluar: timestamp.toLocaleString('id-ID'),
        lokasi: payload.lokasi,
        customer: payload.customer,
        statusAbsensi: statusAbsensi,
      },
    };
  } catch (error) {
    return { status: 'error', message: error.toString() };
  }
}

/**
 * [CRITICAL ENGINE]: Mencatat kepulangan dan menghitung nominal UPD.
 * @param {PulangPayload} payload - Data kepulangan dari UI
 * @param {UserSession} user - Sesi user aktif
 * @returns {PulangResponse}
 */

function api_submitPulangDinas(payload, user) {
  try {
    user = _syncFreshUser(user);
    if (!user.lokasi) throw new Error('Data Lokasi Karyawan kosong!');
    const userLokasiUpper = user.lokasi.toString().trim().toUpperCase();
    const isSales =
      userLokasiUpper === 'SALES' ||
      user.jabatan.toString().trim().toUpperCase() === 'SALES';

    // ==========================================================
    // [UNIVERSAL SECURITY]: PROTOKOL HAVERSINE KEPULANGAN
    // ==========================================================

    // [PATCH]: Normalisasi DTO Kepulangan
    const safePayload = _normalizePulangPayload(payload);
    const statusAbsensi = safePayload.statusAbsensi;

    if (!_isSuperAdmin(user)) {
      if (statusAbsensi.toUpperCase().trim() === 'H (NON PROJECT)') {
        const gpsCheck = _checkRadiusValidation(
          userLokasiUpper,
          safePayload.kordinatMasuk
        );
        if (!gpsCheck.valid) {
          return { status: 'error', message: gpsCheck.message };
        }
      }
    }
    // ==========================================================

    const dbApp = isSales
      ? SpreadsheetApp.openById(DB_SALES_ID)
      : SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = isSales ? 'Log_Sales' : 'Log_' + user.lokasi.trim();

    const sheet = dbApp.getSheetByName(targetSheetName);
    if (!sheet) throw new Error('Sheet tujuan tidak ditemukan.');

    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    let waktuKeluar = null;

    // [PATCH]: Anti Magic-Index
    for (let i = 1; i < data.length; i++) {
      if (
        data[i][MAP_LOG_OPS.ID_TRANSAKSI].toString() === safePayload.idTransaksi
      ) {
        targetRow = i + 1;
        let rawKeluar = data[i][isSales ? 10 : MAP_LOG_OPS.WAKTU_KELUAR];

        waktuKeluar =
          rawKeluar instanceof Date
            ? rawKeluar
            : new Date(rawKeluar.toString() + ' +0700');

        // [KILLER BUG FIX]: Koreksi jika Admin edit jam manual di G-Sheets (Tahun menjadi 1899)
        if (waktuKeluar.getFullYear() < 2000) {
          const today = new Date();
          waktuKeluar.setFullYear(
            today.getFullYear(),
            today.getMonth(),
            today.getDate()
          );
        }

        break;
      }
    }

    if (targetRow === -1) throw new Error('ID Transaksi tidak ditemukan.');

    const waktuMasuk = new Date();
    // ==============================================================================
    // [PATCH]: ANTI-GHOST SESSION & CROSS-DAY VALIDATOR (ANOMALI)
    // ==============================================================================
    
    // 1. Validasi State Mutlak: Apakah sudah disapu oleh Auto-Sweeper?
    let currentStatus = data[targetRow - 1][isSales ? 15 : MAP_LOG_OPS.STATUS_JALAN];
    if (currentStatus && currentStatus.toString().toUpperCase().trim() !== 'SEDANG JALAN') {
      throw new Error("⛔ GAGAL: Sesi perjalanan ini sudah ditutup otomatis oleh Sistem (Sweeper). Silakan refresh aplikasi Anda.");
    }

    // 2. Validasi Lintas Hari (Ganti Hari = Wajib Anomali)
    const dateStrKeluar = Utilities.formatDate(waktuKeluar, 'Asia/Jakarta', 'yyyy/MM/dd');
    const dateStrMasuk = Utilities.formatDate(waktuMasuk, 'Asia/Jakarta', 'yyyy/MM/dd');

    if (dateStrKeluar !== dateStrMasuk) {
      // Tolak kalkulasi dan biarkan Robot Sweeper yang mengambil alih status anomali
      throw new Error("⛔ KADALUARSA: Anda mencoba absen pulang untuk perjalanan hari kemarin. Transaksi dibekukan (Anomali Sistem).");
    }
    // ==============================================================================
    const timeMasukToSave = Utilities.formatDate(
      waktuMasuk,
      'Asia/Jakarta',
      'yyyy/MM/dd HH:mm:ss'
    );

    const diffMs = waktuMasuk - waktuKeluar;
    const tHours = Math.floor(diffMs / (1000 * 60 * 60));
    const tMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const durasiJam = tHours + tMins / 100;

    let nominalUPD = 0;

    // ==========================================================
    // 1. BLOK KALKULASI MATEMATIKA UPD (MURNI LOGIC, TANPA DATABASE SAVE)
    // ==========================================================
    if (!isSales) {
      const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
      const masterUPD = dbMaster
        .getSheetByName('Master_UPD')
        .getDataRange()
        .getValues();

      let baseUPD = 0,
        uangMakan = 0,
        mknSiangLibur = 0,
        lainKerja = 0,
        lainLibur = 0;
      let keyJabatan = user.jabatan
        ? user.jabatan.toString().trim().toUpperCase()
        : '';
      let keyGolongan = user.golongan
        ? user.golongan.toString().trim().toUpperCase()
        : '';
      let keyStatusKaryawan = user.statusKaryawan
        ? user.statusKaryawan.toString().trim().toUpperCase()
        : '';

      for (let i = 1; i < masterUPD.length; i++) {
        let dbJabatan = masterUPD[i][0]
          ? masterUPD[i][0].toString().trim().toUpperCase()
          : '';
        let dbGolongan = masterUPD[i][1]
          ? masterUPD[i][1].toString().trim().toUpperCase()
          : '';
        let dbStatusJabatan = masterUPD[i][2]
          ? masterUPD[i][2].toString().trim().toUpperCase()
          : '';

        // [STRICT MATCHER LOGIC]: Anti Overlap "NON" vs "PROJECT"
        let isStatusMatch = false;
        if (dbStatusJabatan === '') {
          isStatusMatch = true;
        } else if (dbStatusJabatan === 'PROJECT') {
          if (
            keyStatusKaryawan.includes('PROJECT') &&
            !keyStatusKaryawan.includes('NON')
          )
            isStatusMatch = true;
        } else if (dbStatusJabatan === 'NON PROJECT') {
          if (
            keyStatusKaryawan.includes('NON') ||
            !keyStatusKaryawan.includes('PROJECT')
          )
            isStatusMatch = true;
        } else if (keyStatusKaryawan.includes(dbStatusJabatan)) {
          isStatusMatch = true;
        }

        if (
          dbJabatan === keyJabatan &&
          dbGolongan === keyGolongan &&
          isStatusMatch
        ) {
          baseUPD =
            durasiJam >= 8
              ? parseFloat(masterUPD[i][3] || 0)
              : parseFloat(masterUPD[i][4] || 0);
          uangMakan = parseFloat(masterUPD[i][5] || 0);
          mknSiangLibur = parseFloat(masterUPD[i][6] || 0);
          lainKerja = parseFloat(masterUPD[i][7] || 0);
          lainLibur = parseFloat(masterUPD[i][8] || 0);
          break;
        }
      }

      const isWeekend = waktuMasuk.getDay() === 0 || waktuMasuk.getDay() === 6;
      if (isWeekend)
        nominalUPD = baseUPD + mknSiangLibur + uangMakan + lainLibur;
      else nominalUPD = baseUPD + uangMakan + lainKerja;
    }

    // ==========================================================
    // 2. [PATCH]: ATOMIC ROW MUTATION (MENULIS KE SPREADSHEET 1X TEMBAK)
    // ==========================================================
    // Catatan: Pastikan `safePayload` (dari normalisasi DTO) digunakan.
    // Jika Anda belum pasang safePayload, ganti safePayload.kordinatMasuk jadi payload.kordinatMasuk

    const updateData = {
      timeMasukSave: timeMasukToSave,
      kordinatMasuk: safePayload.kordinatMasuk, // <- Menggunakan DTO yang sudah disanitasi
      durasi: durasiJam.toFixed(2),
      nominalUPD: nominalUPD,
    };

    // Fungsi ini akan otomatis memisahkan rute tulis untuk OPS dan SALES
    // tanpa perlu if-else getRange.setValue yang berulang-ulang.
    _applyPulangMutation(sheet, targetRow, isSales, updateData);

// [AUTO-GRID DB_REKAP]
    const lockRekapOUT = LockService.getScriptLock(); // [PATCH]: Inisiasi Kunci Transaksi
    try {
      if (!lockRekapOUT.tryLock(15000)) throw new Error("Sistem sibuk, gagal mengunci DB_REKAP (Timeout).");
      
      const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);
      let rekapSheetName = '';
      if (isSales) rekapSheetName = 'Rekap_Absensi_Sales';
      else if (userLokasiUpper === 'FMC') rekapSheetName = 'Rekap_Absesnsi_FMC';
      else if (userLokasiUpper === 'SATELITE')
        rekapSheetName = 'Rekap_Absesnsi_Satelite';
      else rekapSheetName = 'Rekap_Absensi_' + user.lokasi.trim();

      const rekapSheet = dbRekap.getSheetByName(rekapSheetName);
      if (rekapSheet) {
        const todayStr = Utilities.formatDate(
          waktuMasuk,
          'Asia/Jakarta',
          'dd/MM/yyyy'
        );
        const timeStr = Utilities.formatDate(
          waktuMasuk,
          'Asia/Jakarta',
          'HH:mm'
        );
        const dataRekap = rekapSheet.getDataRange().getValues();
        let tRow = -1;
        let tCol = -1;

        for (let r = 1; r < dataRekap.length; r++) {
          if (dataRekap[r][0].toString() === user.nrpp.toString()) {
            tRow = r + 1;
            break;
          }
        }

        let headerRow = dataRekap.length > 0 ? dataRekap[0] : [];
        for (let c = 2; c < headerRow.length; c += 4) {
          let cellDateStr =
            headerRow[c] instanceof Date
              ? Utilities.formatDate(headerRow[c], 'Asia/Jakarta', 'dd/MM/yyyy')
              : headerRow[c].toString();
          if (cellDateStr.includes(todayStr)) {
            tCol = c + 1;
            break;
          }
        }

        if (tRow !== -1 && tCol !== -1) {
          rekapSheet.getRange(tRow, tCol + 1).setValue(timeStr);
          
          // [PATCH]: Strict Type Coercion untuk Durasi, mencegah tulis NaN
          let safeDurasi = isNaN(durasiJam) ? 0 : durasiJam; 
          rekapSheet.getRange(tRow, tCol + 3).setValue(safeDurasi.toFixed(2));
        }
        
        // [PATCH]: Paksa I/O ke database seketika sebelum lock dilepas
        SpreadsheetApp.flush();
      }
    } catch (e) {
      console.error('Error DB_REKAP OUT: ' + e.message);
    } finally {
      // [PATCH]: Mutlak lepaskan gembok
      lockRekapOUT.releaseLock();
    }

    return {
      status: 'success',
      message: 'Selesai!',
      data: { durasi: durasiJam.toFixed(2), nominal: nominalUPD },
    };
  } catch (error) {
    return { status: 'error', message: error.toString() };
  }
}

// ==========================================================
// [MASTER ABSTRACTION LAYER]: HELPER & NORMALIZER TERPADU
// ==========================================================
function _isSuperAdmin(user) {
  if (!user || !user.jabatan) return false;
  const j = _S(user.jabatan);
  return j === 'SUPER ADMIN' || j === 'ADMINISTRATOR';
}

function _isHRD(user) {
  if (!user || !user.jabatan) return false;
  return _S(user.jabatan) === 'HRD';
}

function _hasPrivilegedAccess(user) {
  return _isSuperAdmin(user) || _isHRD(user);
}

function _S(val, fallback = "") {
  if (val === null || val === undefined) return String(fallback).trim().toUpperCase();
  return String(val).trim().toUpperCase();
}

function _safeCell(row, index, fallback = '') {
  if (!row || index === undefined || index < 0 || index >= row.length) return fallback;
  const val = row[index];
  return val === null || val === undefined || val === '' ? fallback : String(val).trim();
}

// ==========================================================
// [ENGINE]: ENTERPRISE STATISTICS & ANALYTICS ENGINE
// ==========================================================

function _buildStatisticsEngine(logs) {
  if (!logs || !Array.isArray(logs)) return null;

  const stats = {
    attendance: { total: 0, hadir: 0, bks: 0, st: 0, mangkir: 0 },
    trip: { total: 0, customer: 0, project: 0, locations: new Set(), durations: [] },
    upd: { total: 0, values: [] },
    productivity: { dayMap: {}, locationMap: {}, hourTotal: 0 }
  };

  logs.forEach(log => {
    // 1. Attendance & Status Aggregation
    stats.attendance.total++;
    const st = _S(log.statusAbsensi);
    if (st === 'HADIR') stats.attendance.hadir++;
    else if (st === 'BKS') stats.attendance.bks++;
    else if (st === 'ST') stats.attendance.st++;
    else stats.attendance.mangkir++;

    // 2. Trip & Customer Analytics
    stats.trip.total++;
    if (log.customer) stats.trip.customer++;
    if (log.lokasiDest) stats.trip.locations.add(_S(log.lokasiDest));
    
    // 3. UPD & Nominal
    const nominal = parseFloat(log.nominal) || 0;
    stats.upd.total += nominal;
    stats.upd.values.push(nominal);

    // 4. Productivity & Trends
    const tgl = log.waktuKeluar ? log.waktuKeluar.split(' ')[0] : 'N/A';
    stats.productivity.dayMap[tgl] = (stats.productivity.dayMap[tgl] || 0) + 1;
    
    const loc = _S(log.lokasiDest);
    if(loc) stats.productivity.locationMap[loc] = (stats.productivity.locationMap[loc] || 0) + 1;
    
    const durasi = parseFloat(log.durasi) || 0;
    stats.trip.durations.push(durasi);
    stats.productivity.hourTotal += durasi;
  });

  // Final Normalization
  return {
    attendance: {
      ...stats.attendance,
      percentage: ((stats.attendance.hadir / stats.attendance.total) * 100).toFixed(1) + '%',
    },
    trip: {
      total: stats.trip.total,
      customer: stats.trip.customer,
      locationCount: stats.trip.locations.size,
      avgDuration: stats.trip.durations.length ? (stats.trip.durations.reduce((a,b) => a+b, 0) / stats.trip.durations.length).toFixed(1) : 0
    },
    upd: {
      total: stats.upd.total,
      avg: stats.upd.values.length ? (stats.upd.total / stats.upd.values.length).toFixed(0) : 0,
      max: Math.max(...(stats.upd.values.length ? stats.upd.values : [0]))
    },
    productivity: {
      totalHours: stats.productivity.hourTotal.toFixed(1),
      busiestDay: Object.keys(stats.productivity.dayMap).sort((a,b) => stats.productivity.dayMap[b] - stats.productivity.dayMap[a])[0] || '-'
    }
  };
}

/** API Wrapper untuk Frontend */
function api_getEmployeeAnalytics(nrpp) {
  try {
    const rawLogs = api_getHybridLogOps(nrpp); // Gunakan Hybrid Engine Existing
    return { status: 'success', data: _buildStatisticsEngine(rawLogs) };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * [HELPER]: Defensive Date Parser (Supercharged)
 * Kebal terhadap anomali string G-Sheets (DD/MM/YYYY vs MM/DD/YYYY)
 */
function _safeDate(rawDate) {
  if (!rawDate) return new Date(0);
  if (rawDate instanceof Date) return rawDate;
  let dStr = String(rawDate).trim();
  if (dStr.length < 5) return new Date(0);
  let match = dStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    let parsed = new Date(`${match[3]}/${match[2]}/${match[1]}${dStr.replace(match[0], '')} +0700`);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  let parsedFallback = new Date(dStr);
  if (!isNaN(parsedFallback.getTime())) return parsedFallback;
  return new Date(0);
}

/**
 * [HELPER]: Defensive Uppercase String (Titanium Edition).
 * Dijamin 100% anti-crash terhadap undefined/null.
 */
function _safeUpper(val, fallback) {
  // Paksa menjadi string terlebih dahulu, apapun bentuk datanya
  const finalVal = val || fallback || '';
  return String(finalVal).trim().toUpperCase();
}

/**
 * [HELPER]: Dynamic Map Builder (Titanium Edition).
 * Membaca header sheet saat ini dan membuat indeks dinamis.
 * Aman dari sel header yang blank (kosong/undefined).
 */
function _buildDynamicMap(headers) {
  const h = headers.map(val => String(val || "").toUpperCase().trim());
  return {
    ID_TRANSAKSI: h.indexOf('ID_TRANSAKSI') !== -1 ? h.indexOf('ID_TRANSAKSI') : 0,
    NRPP: h.indexOf('NRPP') !== -1 ? h.indexOf('NRPP') : 1,
    NO_ST: h.indexOf('NO_ST') !== -1 ? h.indexOf('NO_ST') : 8,
    CUSTOMER: h.indexOf('CUSTOMER') !== -1 ? h.indexOf('CUSTOMER') : 9,
    LOKASI_DEST: h.lastIndexOf('LOKASI') !== -1 ? h.lastIndexOf('LOKASI') : 10,
    WAKTU_KELUAR: h.indexOf('WAKTU_KELUAR') !== -1 ? h.indexOf('WAKTU_KELUAR') : (h.indexOf('WAKTU KELUAR') !== -1 ? h.indexOf('WAKTU KELUAR') : 11),
    WAKTU_MASUK: h.indexOf('WAKTU_MASUK') !== -1 ? h.indexOf('WAKTU_MASUK') : (h.indexOf('WAKTU MASUK') !== -1 ? h.indexOf('WAKTU MASUK') : 13),
    DURASI: h.indexOf('DURASI_JAM') !== -1 ? h.indexOf('DURASI_JAM') : (h.indexOf('DURASI JAM') !== -1 ? h.indexOf('DURASI JAM') : 15),
    NOMINAL: h.indexOf('NOMINAL_UPD') !== -1 ? h.indexOf('NOMINAL_UPD') : (h.indexOf('NOMINAL UPD') !== -1 ? h.indexOf('NOMINAL UPD') : 16),
    STATUS_JALAN: h.indexOf('STATUS_PERJALANAN') !== -1 ? h.indexOf('STATUS_PERJALANAN') : (h.indexOf('STATUS PERJALANAN') !== -1 ? h.indexOf('STATUS PERJALANAN') : 17),
    STATUS_KLAIM: h.indexOf('STATUS_KLAIM') !== -1 ? h.indexOf('STATUS_KLAIM') : (h.indexOf('STATUS KLAIM') !== -1 ? h.indexOf('STATUS KLAIM') : 18),
    STATUS_APPROVE: h.indexOf('STATUS_APPROVE') !== -1 ? h.indexOf('STATUS_APPROVE') : 20
  };
}

/**
 * [HELPER]: Map raw Log_Ops row to LogOpsDTO object.
 */
function _mapLogOpsRow(row, map) {
  if (!row || row.length === 0) return null;
  
  // [PATCH FIX]: Fallback pengaman mutlak ke MAP_LOG_OPS (Anti-Undefined)
  const activeMap = map || MAP_LOG_OPS;
  
  return {
    idTransaksi: _safeCell(row, activeMap.ID_TRANSAKSI),
    nrpp: _safeCell(row, activeMap.NRPP),
    noST: _safeCell(row, activeMap.NO_ST, 'TANPA ST').replace(/^'/, ''),
    customer: _safeCell(row, activeMap.CUSTOMER, '-'),
    lokasiDest: _safeCell(row, activeMap.LOKASI_DEST, '-'),
    waktuKeluar: row[activeMap.WAKTU_KELUAR], 
    waktuMasuk: row[activeMap.WAKTU_MASUK],
    durasi: parseFloat(_safeCell(row, activeMap.DURASI, '0')),
    nominal: parseFloat(_safeCell(row, activeMap.NOMINAL, '0')),
    statusJalan: _S(_safeCell(row, activeMap.STATUS_JALAN, 'SEDANG JALAN')),
    statusKlaim: _S(_safeCell(row, activeMap.STATUS_KLAIM, 'BELUM KLAIM')),
    statusApprove: _S(_safeCell(row, activeMap.STATUS_APPROVE, 'PENDING'))
  };
}


function _normalizeLogOpsDTO(dto) {
  if (!dto) return null;
  const wKeluarObj = _safeDate(dto.waktuKeluar);
  const wMasukObj = _safeDate(dto.waktuMasuk);
  return {
    ...dto,
    nrpp: _S(dto.nrpp),
    st: dto.noST === '' ? 'TANPA ST' : dto.noST,
    wKeluarObj: wKeluarObj,
    wMasukObj: wMasukObj,
    wKeluarStr: wKeluarObj.getTime() > 0 ? Utilities.formatDate(wKeluarObj, 'Asia/Jakarta', 'dd/MM/yyyy HH:mm') : '',
    wMasukStr: wMasukObj.getTime() > 0 ? Utilities.formatDate(wMasukObj, 'Asia/Jakarta', 'dd/MM/yyyy HH:mm') : ''
  };
}

/**
 * [HELPER]: Serialisasi Data Akhir (Multi-Alias UI Bridge)
 * Menjamin Frontend tidak pernah menerima 'undefined' saat merender tabel.
 */
function _serializeLogResponse(normDto, breakdown) {
  return {
    idTransaksi: String(normDto.idTransaksi || ""),
    st: String(normDto.st || ""),
    noST: String(normDto.st || ""),
    customer: String(normDto.customer || "-"),
    lokasi: String(normDto.lokasiDest || "-"),
    waktuKeluar: String(normDto.wKeluarStr || ""),
    waktuMasuk: String(normDto.wMasukStr || ""),
    tanggal: String(normDto.wKeluarStr || normDto.wMasukStr || ""),
    durasi: isNaN(normDto.durasi) ? "0.00" : Number(normDto.durasi).toFixed(2),
    nominal: isNaN(normDto.nominal) ? 0 : Number(normDto.nominal),
    status: String(normDto.statusJalan || "SELESAI"),
    statusPerjalanan: String(normDto.statusJalan || "SELESAI"),
    klaim: String(normDto.statusKlaim || "BELUM KLAIM"),
    statusKlaim: String(normDto.statusKlaim || "BELUM KLAIM"),
    persetujuan: String(normDto.statusApprove || "PENDING"),
    statusApprove: String(normDto.statusApprove || "PENDING"),
    breakdown: breakdown || {}
  };
}

// ==========================================================
// MODUL SUPER ADMIN: UNIVERSAL CRUD MASTER DATA
// ==========================================================

function api_adminGetMaster(sheetName) {
  try {
    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheet = db.getSheetByName(sheetName);
    if (!sheet)
      throw new Error("Tabel Master '" + sheetName + "' tidak ditemukan!");

    const data = sheet.getDataRange().getValues();
    if (data.length === 0)
      return { status: 'success', data: { headers: [], rows: [] } };

    // [KILLER BUG FIX]: Memaksa seluruh elemen sel menjadi teks untuk mencegah JSON Serialization Crash dari google.script.run
    const headers = data[0].map((h) => String(h).trim());
    const rows = data.slice(1).map((row) => {
      return row.map((cell) => {
        if (cell instanceof Date)
          return Utilities.formatDate(
            cell,
            'Asia/Jakarta',
            'yyyy/MM/dd HH:mm:ss'
          );
        if (cell === null || cell === undefined) return '';
        return String(cell);
      });
    });

    return {
      status: 'success',
      data: { headers: headers, rows: rows },
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function api_adminMutateMaster(action, sheetName, payload, rowIndex) {
  try {
    // [DEBUG LOGGING]
    console.log('=== API MUTATE EXECUTED ===');
    console.log('Action:', action);
    console.log('Sheet:', sheetName);
    console.log('Payload:', payload);
    console.log('RowIndex:', rowIndex);

    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheet = db.getSheetByName(sheetName);
    if (!sheet)
      throw new Error("Tabel Master '" + sheetName + "' tidak ditemukan!");

    if (action === 'CREATE') {
      sheet.appendRow(payload);

      // Protokol Auto-Login
      if (sheetName === 'Master_Karyawan') {
        const loginSheet = db.getSheetByName('Master_Login');
        if (loginSheet) {
          loginSheet.appendRow([payload[0], payload[1], payload[0], '', '']);
          console.log('Auto-Login Created for NRPP:', payload[0]);
        } else {
          console.warn('Sheet Master_Login tidak ditemukan untuk Auto-Login!');
        }
      }

      return {
        status: 'success',
        message: 'Entitas baru berhasil direkam ke ' + sheetName,
      };
    } else if (action === 'UPDATE') {
      const targetRow = parseInt(rowIndex) + 2;
      if (isNaN(targetRow)) throw new Error('Target baris tidak valid!');

      sheet.getRange(targetRow, 1, 1, payload.length).setValues([payload]);
      return {
        status: 'success',
        message: 'Entitas pada baris ' + targetRow + ' berhasil diperbarui!',
      };
    } else if (action === 'DELETE') {
      const targetRow = parseInt(rowIndex) + 2;
      if (isNaN(targetRow)) throw new Error('Target baris tidak valid!');

      sheet.deleteRow(targetRow);
      return { status: 'success', message: 'Entitas berhasil dimusnahkan.' };
    } else {
      throw new Error('Protokol Mutasi (CRUD) tidak dikenali: ' + action);
    }
  } catch (e) {
    console.error('Backend Error:', e.toString());
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL SUPER ADMIN: SMART HRIS & LIVE TRACKING
// ==========================================================

function api_adminGetKaryawanDetails() {
  try {
    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const karSheet = db.getSheetByName('Master_Karyawan');
    const logSheet = db.getSheetByName('Master_Login');

    const karData = karSheet.getDataRange().getValues();
    const logData = logSheet.getDataRange().getValues();

    // Pemetaan data Login untuk digabungkan dengan Master_Karyawan (Relational Mapping)
    let logMap = {};
    for (let i = 1; i < logData.length; i++) {
      logMap[logData[i][0].toString()] = {
        deviceId: logData[i][3] ? logData[i][3].toString() : '',
        lastLogin:
          logData[i][4] instanceof Date
            ? Utilities.formatDate(
                logData[i][4],
                'Asia/Jakarta',
                'dd/MM/yyyy HH:mm'
              )
            : logData[i][4].toString(),
      };
    }

    let results = [];
    for (let i = 1; i < karData.length; i++) {
      let nrpp = karData[i][0].toString();
      if (!nrpp) continue;
      results.push({
        nrpp: nrpp,
        nama: karData[i][1],
        jabatan: karData[i][2],
        golongan: karData[i][3],
        departemen: karData[i][5],
        lokasi: karData[i][6],
        deviceId: logMap[nrpp] ? logMap[nrpp].deviceId : '',
        lastLogin: logMap[nrpp] ? logMap[nrpp].lastLogin : 'Belum Pernah Login',
      });
    }
    return { status: 'success', data: results };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function api_adminResetDevice(nrpp) {
  try {
    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheet = db.getSheetByName('Master_Login');
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === nrpp.toString()) {
        sheet.getRange(i + 1, 4).setValue(''); // Kolom ke-4 adalah Device_ID
        return {
          status: 'success',
          message:
            'Security Lock untuk NRPP ' + nrpp + ' berhasil dihancurkan!',
        };
      }
    }
    throw new Error('Data Kredensial tidak ditemukan!');
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL SUPER ADMIN: GLOBAL LIVE TRACKING (RADAR AKTIF)
// ==========================================================
function api_adminGetLiveLogs() {
  try {
    const timestamp = new Date();
    const todayWIB = Utilities.formatDate(
      timestamp,
      'Asia/Jakarta',
      'yyyy/MM/dd'
    );
    let liveData = [];

    // Fungsi Scraper Internal untuk mengekstrak multi-sheet
    function extractLogs(dbId, isSales) {
      const db = SpreadsheetApp.openById(dbId);
      const sheets = db.getSheets();

      sheets.forEach((sheet) => {
        const sheetName = sheet.getName();
        if (!sheetName.startsWith('Log_')) return;

        const data = sheet.getDataRange().getValues();
        if (data.length > 1) {
          let timeIndex = isSales ? 10 : 11;
          for (let i = data.length - 1; i >= 1; i--) {
            // [KILLER FIX]: Cegat dari awal! Hanya proses yang statusnya "SEDANG JALAN"
            let currentStatus = isSales
              ? data[i][15] || 'SEDANG JALAN'
              : data[i][17] || 'SEDANG JALAN';
            if (currentStatus.toString().toUpperCase() !== 'SEDANG JALAN')
              continue; // Abaikan yang sudah SELESAI

            let wKeluar = data[i][timeIndex];
            if (!wKeluar) continue;

            let wKeluarDate =
              wKeluar instanceof Date
                ? wKeluar
                : new Date(wKeluar.toString() + ' +0700');
            if (isNaN(wKeluarDate.getTime())) continue;

            let wKeluarStr = Utilities.formatDate(
              wKeluarDate,
              'Asia/Jakarta',
              'yyyy/MM/dd'
            );

            if (wKeluarStr === todayWIB) {
              liveData.push({
                nrpp: data[i][1],
                nama: data[i][2],
                divisi: isSales ? 'SALES' : 'OPS (' + data[i][7] + ')',
                customer: isSales ? data[i][8] : data[i][9],
                waktuKeluar: Utilities.formatDate(
                  wKeluarDate,
                  'Asia/Jakarta',
                  'HH:mm'
                ),
                status: currentStatus.toString().toUpperCase(),
              });
            }
          }
        }
      });
    }

    extractLogs(DB_UPD_ID, false);
    extractLogs(DB_SALES_ID, true);

    return { status: 'success', data: liveData };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL SUPER ADMIN: REKAPITULASI & EKSPOR DATA
// ==========================================================

function api_adminGetRekapSheets() {
  try {
    const db = SpreadsheetApp.openById(DB_REKAP_ID);
    const sheets = db.getSheets();
    // Tarik semua nama Sheet yang ada di dalam DB_REKAP
    const sheetNames = sheets.map((s) => s.getName());
    return { status: 'success', data: sheetNames };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function api_adminGetRekapData(sheetName) {
  try {
    const db = SpreadsheetApp.openById(DB_REKAP_ID);
    const sheet = db.getSheetByName(sheetName);
    if (!sheet)
      throw new Error("Sheet Rekap '" + sheetName + "' tidak ditemukan!");

    // [KILLER FEATURE]: Menggunakan getDisplayValues() alih-alih getValues().
    // Ini memaksa Google Sheets mengirim data persis seperti yang Anda lihat di layar (Teks),
    // mencegah kerusakan format jam (-13.99) atau Date Object Object saat diekspor.
    const data = sheet.getDataRange().getDisplayValues();

    return { status: 'success', data: data, sheetName: sheetName };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL USER: RIWAYAT PERJALANAN DINAS & UPD (HYBRID ENGINE)
// ==========================================================
/**
 * [HYBRID QUERY ENGINE]: Memindai database aktif dan arsip.
 * @param {UserSession} user - Sesi user aktif
 * @param {number|string} filterBulan - Range 1-12
 * @param {number|string} filterTahun - Contoh: 2026
 * @returns {HybridQueryResponse}
 */

// ==========================================================
// MODUL USER: RIWAYAT PERJALANAN DINAS & UPD (HYBRID ENGINE)
// ==========================================================
function api_getLogPribadi(user, filterBulan, filterTahun) {
  try {
    if (typeof _syncFreshUser === 'function') user = _syncFreshUser(user) || user;
    if (!user) throw new Error("Sesi pengguna tidak terdeteksi.");

    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const masterUPD = dbMaster.getSheetByName('Master_UPD').getDataRange().getValues();

    let keyJabatan = _S(user.jabatan);
    let keyGolongan = _S(user.golongan);
    let keyStatusKaryawan = _S(user.statusKaryawan);
    let upd_ge8 = 0, upd_lt8 = 0, uangMakan = 0, mknSiangLibur = 0, lainKerja = 0, lainLibur = 0;

    for (let i = 1; i < masterUPD.length; i++) {
      let dbJabatan = _S(masterUPD[i][0]);
      let dbGolongan = _S(masterUPD[i][1]);
      let dbStatusJabatan = _S(masterUPD[i][2]);
      let isStatusMatch = false;
      
      if (dbStatusJabatan === '') isStatusMatch = true;
      else if (dbStatusJabatan === 'PROJECT') { if (keyStatusKaryawan.includes('PROJECT') && !keyStatusKaryawan.includes('NON')) isStatusMatch = true; } 
      else if (dbStatusJabatan === 'NON PROJECT') { if (keyStatusKaryawan.includes('NON') || !keyStatusKaryawan.includes('PROJECT')) isStatusMatch = true; } 
      else if (keyStatusKaryawan.includes(dbStatusJabatan)) isStatusMatch = true;

      if (dbJabatan === keyJabatan && dbGolongan === keyGolongan && isStatusMatch) {
        upd_ge8 = parseFloat(masterUPD[i][3] || 0);
        upd_lt8 = parseFloat(masterUPD[i][4] || 0);
        uangMakan = parseFloat(masterUPD[i][5] || 0);
        mknSiangLibur = parseFloat(masterUPD[i][6] || 0);
        lainKerja = parseFloat(masterUPD[i][7] || 0);
        lainLibur = parseFloat(masterUPD[i][8] || 0);
        break;
      }
    }

    let groupedData = {};
    const now = new Date();
    let pBulan = parseInt(filterBulan, 10);
    let pTahun = parseInt(filterTahun, 10);
    let fixBulan = isNaN(pBulan) || pBulan === 0 ? now.getMonth() + 1 : pBulan;
    let fixTahun = isNaN(pTahun) || pTahun === 0 ? now.getFullYear() : pTahun;

    const dbs = [DB_UPD_ID, DB_ARCHIVE_ID];

    dbs.forEach((dbId) => {
      try {
        const dbApp = SpreadsheetApp.openById(dbId);
        let targetSheetName = 'Log_' + String(user.lokasi || "OFFICE").trim();
        let sheet = dbApp.getSheetByName(targetSheetName);

        if (!sheet) return;
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return;

        const dynamicMap = _buildDynamicMap(data[0]);

        for (let i = data.length - 1; i >= 1; i--) {
          const dto = _mapLogOpsRow(data[i], dynamicMap);
          if (!dto) continue;

          const normDto = _normalizeLogOpsDTO(dto);

          if (_S(normDto.nrpp) === _S(user.nrpp)) {
            let logDateObj = normDto.wKeluarObj.getTime() > 0 ? normDto.wKeluarObj : normDto.wMasukObj;
            let isMatch = false;

            if (logDateObj.getTime() > 0) {
              if ((logDateObj.getMonth() + 1) === fixBulan && logDateObj.getFullYear() === fixTahun) isMatch = true;
            } 
            
            if (!isMatch) continue;

            let st = normDto.st;
            if (!groupedData[st]) groupedData[st] = [];

            if (groupedData[st].some((log) => log.idTransaksi === normDto.idTransaksi && normDto.idTransaksi !== '')) continue;

            let isWeekend = logDateObj.getDay() === 0 || logDateObj.getDay() === 6;
            let calc_upd = normDto.durasi >= 8 ? upd_ge8 : upd_lt8;
            let calc_total = calc_upd + uangMakan + (isWeekend ? mknSiangLibur : 0) + (isWeekend ? lainLibur : lainKerja);

            if (normDto.durasi === 0) calc_total = calc_upd = 0;

            groupedData[st].push(_serializeLogResponse(normDto, {
              upd: calc_upd,
              makanTotal: (normDto.durasi === 0) ? 0 : uangMakan,
              makanSiang: (normDto.durasi === 0) ? 0 : (isWeekend ? mknSiangLibur : 0),
              lain: (normDto.durasi === 0) ? 0 : (isWeekend ? lainLibur : lainKerja),
              total: calc_total,
            }));
          }
        }
      } catch (e) {
        console.warn('Skip DB Reading: ' + dbId, e.message);
      }
    });

    return { status: 'success', data: groupedData };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL USER: PRINT LOCK & ID KLAIM GENERATOR (AUTO-TARGETING)
// ==========================================================
function api_updatePrintStatus(stNumber, user) {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = 'Log_' + user.lokasi.trim();
    let sheet = dbUpd.getSheetByName(targetSheetName);
    if (!sheet) throw new Error('Sheet log tidak ditemukan.');

    const data = sheet.getDataRange().getValues();
    const idKlaim = 'PRN-' + new Date().getTime() + '-' + user.nrpp;

    // [KILLER FIX]: Dynamic Header Targeting (Rudal Pencari Kolom Otomatis)
    const headers = data[0].map((h) => String(h).toUpperCase().trim());

    let idxST = headers.indexOf('NO_ST');
    let idxNRPP = headers.indexOf('NRPP');

    // Cari persis di mana Kolom Status Klaim berada
    let idxStatusKlaim = headers.indexOf('STATUS_KLAIM');
    if (idxStatusKlaim === -1) idxStatusKlaim = headers.indexOf('STATUS KLAIM');
    if (idxStatusKlaim === -1) idxStatusKlaim = 18; // Fallback jika nama beda (Kolom S)

    // Cari persis di mana Kolom ID Klaim berada
    let idxIdKlaim = headers.indexOf('ID_KLAIM');
    if (idxIdKlaim === -1) idxIdKlaim = headers.indexOf('ID KLAIM');
    if (idxIdKlaim === -1) idxIdKlaim = 19; // Fallback jika nama beda (Kolom T)

    if (idxST === -1 || idxNRPP === -1)
      throw new Error('Kolom NO_ST atau NRPP tidak ditemukan di database!');

    // [KILLER FIX 2]: Normalisasi String Mutlak untuk menghancurkan Ilusi Tanda Kutip (')
    const targetST = String(stNumber).replace(/^'/, '').trim();
    const targetNRPP = String(user.nrpp).trim();
    let updatedCount = 0;

    for (let i = 1; i < data.length; i++) {
      let dbST = data[i][idxST]
        ? String(data[i][idxST]).replace(/^'/, '').trim()
        : 'TANPA ST';
      let dbNRPP = data[i][idxNRPP] ? String(data[i][idxNRPP]).trim() : '';

      // Jika ST dan NRPP terbukti identik, KUNCI MUTLAK!
      if (dbST === targetST && dbNRPP === targetNRPP) {
        sheet.getRange(i + 1, idxStatusKlaim + 1).setValue('SUDAH PRINT'); // +1 karena getRange dihitung dari 1
        sheet.getRange(i + 1, idxIdKlaim + 1).setValue(idKlaim);
        updatedCount++;
      }
    }

    console.log(`Berhasil mengunci ${updatedCount} baris untuk ST ${targetST}`);
    return { status: 'success', message: `Terkunci ${updatedCount} baris` };
  } catch (e) {
    console.error('Print Lock Error: ', e.message);
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL OTOMASI: ROBOT SAPU BERSIH (AUTO-SWEEPER)
// Trigger: Cron Job Harian pukul 23:50 atau 23:59
// ==========================================================

function trigger_AutoSweeper() {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    const dbSales = SpreadsheetApp.openById(DB_SALES_ID);
    const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);

    // 1. Eksekusi Sapu Bersih untuk Pasukan Operasional (DB_UPD)
    dbUpd.getSheets().forEach((sheet) => {
      if (!sheet.getName().startsWith('Log_')) return;
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;

      for (let i = 1; i < data.length; i++) {
        if (data[i][17] === 'SEDANG JALAN') {
          // Kolom R (Index 17)
          let wKeluar = data[i][11]; // Kolom L (Index 11)
          let dateBase = wKeluar instanceof Date ? wKeluar : new Date(wKeluar);
          if (isNaN(dateBase.getTime())) dateBase = new Date(); // Fallback

          // Kunci Mutlak Checkout Paksa
          let forcedTimeStr =
            Utilities.formatDate(dateBase, 'Asia/Jakarta', 'yyyy/MM/dd') +
            ' 23:59:00';

          sheet.getRange(i + 1, 14).setValue(forcedTimeStr); // Waktu Masuk
          sheet.getRange(i + 1, 15).setValue('SYSTEM_AUTO_SWEEP'); // Kordinat
          sheet.getRange(i + 1, 16).setValue(0); // Durasi = 0 (Hangus)
          sheet.getRange(i + 1, 17).setValue(0); // Nominal = 0 (Ditahan)
          sheet.getRange(i + 1, 18).setValue('SELESAI'); // Status ODOC
          sheet.getRange(i + 1, 19).setValue('PENDING'); // Red Flag ke HRD

          updateRekapSweeper(
            dbRekap,
            data[i][1],
            dateBase,
            sheet.getName().replace('Log_', '')
          );
        }
      }
    });

    // 2. Eksekusi Sapu Bersih untuk Pasukan Sales (DB_SALES)
    dbSales.getSheets().forEach((sheet) => {
      if (!sheet.getName().startsWith('Log_')) return;
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;

      for (let i = 1; i < data.length; i++) {
        if (data[i][15] === 'SEDANG JALAN') {
          // Kolom P (Index 15)
          let wKeluar = data[i][10]; // Kolom K (Index 10)
          let dateBase = wKeluar instanceof Date ? wKeluar : new Date(wKeluar);
          if (isNaN(dateBase.getTime())) dateBase = new Date();

          let forcedTimeStr =
            Utilities.formatDate(dateBase, 'Asia/Jakarta', 'yyyy/MM/dd') +
            ' 23:59:00';

          sheet.getRange(i + 1, 13).setValue(forcedTimeStr);
          sheet.getRange(i + 1, 14).setValue('SYSTEM_AUTO_SWEEP');
          sheet.getRange(i + 1, 15).setValue(0);
          sheet.getRange(i + 1, 16).setValue('SELESAI');

          updateRekapSweeper(dbRekap, data[i][1], dateBase, 'Sales');
        }
      }
    });
  } catch (e) {
    console.error('Sistem Sweeper Gagal: ' + e.message);
  }
}

// ==========================================================
// MODUL SUPER ADMIN: LIST APPROVAL & BULK APPROVE
// ==========================================================
function api_adminGetApprovalList() {
  try {
    let approvalData = [];
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);

    dbUpd.getSheets().forEach((sheet) => {
      if (!sheet.getName().startsWith('Log_')) return;
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;

      for (let i = data.length - 1; i >= 1; i--) {
        let statusJalan = data[i][17]
          ? data[i][17].toString().toUpperCase()
          : '';
        let statusKlaim = data[i][18]
          ? data[i][18].toString().toUpperCase()
          : 'BELUM KLAIM'; // Kolom S
        let statusApprove = data[i][20]
          ? data[i][20].toString().toUpperCase()
          : 'PENDING'; // Kolom U

        // [SMART FILTER FIX]:
        // Tampilkan jika Status Jalan SELESAI DAN (Belum Di-Approve ATAU Masih Terkunci Print)
        const butuhApproval = statusApprove.includes('PENDING');
        const masihTerkunci = statusKlaim.includes('SUDAH');

        if (statusJalan === 'SELESAI' && (butuhApproval || masihTerkunci)) {
          let wMasuk = data[i][13] ? data[i][13].toString() : '';
          let isAnomali = wMasuk.includes('23:59');

          let fmtKeluar =
            data[i][11] instanceof Date
              ? Utilities.formatDate(
                  data[i][11],
                  'Asia/Jakarta',
                  "yyyy-MM-dd'T'HH:mm"
                )
              : '';
          let fmtMasuk =
            data[i][13] instanceof Date
              ? Utilities.formatDate(
                  data[i][13],
                  'Asia/Jakarta',
                  "yyyy-MM-dd'T'HH:mm"
                )
              : '';

          approvalData.push({
            idTransaksi: data[i][0].toString(),
            nrpp: data[i][1],
            nama: data[i][2],
            jabatan: data[i][3],
            golongan: data[i][4],
            divisi: 'OPS (' + data[i][7] + ')',
            customer: data[i][9],
            lokasi: data[i][10] ? data[i][10].toString() : '-', // [NEW]: Ekstraksi Kolom K (Lokasi)
            waktuKeluar:
              data[i][11] instanceof Date
                ? Utilities.formatDate(
                    data[i][11],
                    'Asia/Jakarta',
                    'dd/MM/yyyy HH:mm'
                  )
                : data[i][11].toString(),
            waktuMasuk:
              data[i][13] instanceof Date
                ? Utilities.formatDate(
                    data[i][13],
                    'Asia/Jakarta',
                    'dd/MM/yyyy HH:mm'
                  )
                : wMasuk || '-',
            rawKeluar: fmtKeluar,
            rawMasuk: fmtMasuk,
            sheetName: sheet.getName(),
            durasi: data[i][15],
            nominal: data[i][16],
            isAnomali: isAnomali,
            statusKlaim: statusKlaim,
            persetujuan: statusApprove,
          });
        }
      }
    });
    return { status: 'success', data: approvalData };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function api_adminEditLog(payload) {
  try {
    const db = SpreadsheetApp.openById(DB_UPD_ID);
    const sheet = db.getSheetByName(payload.sheetName);
    if (!sheet) throw new Error('Sheet asal tidak ditemukan.');

    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === payload.idTransaksi) {
        targetRow = i + 1;
        break;
      }
    }
    if (targetRow === -1) throw new Error('ID Transaksi tidak valid.');

    // Kalkulasi Waktu Baru
    const dKeluar = new Date(payload.wKeluar.replace('T', ' ') + ':00 +0700');
    const dMasuk = new Date(payload.wMasuk.replace('T', ' ') + ':00 +0700');
    const diffMs = dMasuk - dKeluar;
    if (diffMs < 0)
      throw new Error('Waktu masuk tidak boleh lebih awal dari keluar.');
    const tHours = Math.floor(diffMs / (1000 * 60 * 60));
    const tMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const durasiJam = tHours + tMins / 100;

    // Kalkulasi Ulang UPD
    let nominalUPD = 0;
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const masterUPD = dbMaster
      .getSheetByName('Master_UPD')
      .getDataRange()
      .getValues();
    let baseUPD = 0,
      uangMakan = 0,
      mknSiangLibur = 0,
      lainKerja = 0,
      lainLibur = 0;

    let keyStatusKaryawan = data[targetRow - 1][5]
      ? data[targetRow - 1][5].toString().trim().toUpperCase()
      : '';

    for (let i = 1; i < masterUPD.length; i++) {
      let dbJabatan = masterUPD[i][0]
        ? masterUPD[i][0].toString().trim().toUpperCase()
        : '';
      let dbGolongan = masterUPD[i][1]
        ? masterUPD[i][1].toString().trim().toUpperCase()
        : '';
      let dbStatusJabatan = masterUPD[i][2]
        ? masterUPD[i][2].toString().trim().toUpperCase()
        : '';

      // [STRICT MATCHER LOGIC]: Anti Overlap "NON" vs "PROJECT"
      let isStatusMatch = false;
      if (dbStatusJabatan === '') {
        isStatusMatch = true;
      } else if (dbStatusJabatan === 'PROJECT') {
        if (
          keyStatusKaryawan.includes('PROJECT') &&
          !keyStatusKaryawan.includes('NON')
        )
          isStatusMatch = true;
      } else if (dbStatusJabatan === 'NON PROJECT') {
        if (
          keyStatusKaryawan.includes('NON') ||
          !keyStatusKaryawan.includes('PROJECT')
        )
          isStatusMatch = true;
      } else if (keyStatusKaryawan.includes(dbStatusJabatan)) {
        isStatusMatch = true;
      }

      if (
        dbJabatan === payload.jabatan.toUpperCase() &&
        dbGolongan === payload.golongan.toUpperCase() &&
        isStatusMatch
      ) {
        baseUPD =
          durasiJam >= 8
            ? parseFloat(masterUPD[i][3] || 0)
            : parseFloat(masterUPD[i][4] || 0);
        uangMakan = parseFloat(masterUPD[i][5] || 0);
        mknSiangLibur = parseFloat(masterUPD[i][6] || 0);
        lainKerja = parseFloat(masterUPD[i][7] || 0);
        lainLibur = parseFloat(masterUPD[i][8] || 0);
        break;
      }
    }
    const isWeekend = dMasuk.getDay() === 0 || dMasuk.getDay() === 6;
    nominalUPD = isWeekend
      ? baseUPD + mknSiangLibur + uangMakan + lainLibur
      : baseUPD + uangMakan + lainKerja;

    const timeKeluarSave = Utilities.formatDate(
      dKeluar,
      'Asia/Jakarta',
      'yyyy/MM/dd HH:mm:ss'
    );
    const timeMasukSave = Utilities.formatDate(
      dMasuk,
      'Asia/Jakarta',
      'yyyy/MM/dd HH:mm:ss'
    );

    // Timpa Database
    sheet.getRange(targetRow, 12).setValue(timeKeluarSave); // L (Keluar)
    sheet.getRange(targetRow, 14).setValue(timeMasukSave); // N (Masuk)
    sheet.getRange(targetRow, 16).setValue(durasiJam.toFixed(2)); // P (Durasi)
    sheet.getRange(targetRow, 17).setValue(nominalUPD); // Q (Nominal)
    sheet.getRange(targetRow, 19).setValue('BELUM KLAIM'); // Reset Klaim agar gembok terbuka

    return {
      status: 'success',
      message: `Data dikoreksi! Durasi baru: ${durasiJam.toFixed(2)} Jam.`,
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function api_adminBulkApprove(trxIds) {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let count = 0;

    dbUpd.getSheets().forEach((sheet) => {
      if (!sheet.getName().startsWith('Log_')) return;
      const data = sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        let currentId = data[i][0].toString();
        if (trxIds.includes(currentId)) {
          // Eksekusi TEPAT di Kolom U (Kolom ke-21)
          sheet.getRange(i + 1, 21).setValue('APPROVED');
          count++;
        }
      }
    });

    return {
      status: 'success',
      message: `${count} Dokumen perjalanan berhasil disetujui!`,
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function updateRekapSweeper(dbRekap, nrpp, dateBase, lokasiStr) {
  try {
    let rekapSheetName =
      lokasiStr === 'Sales'
        ? 'Rekap_Absensi_Sales'
        : 'Rekap_Absensi_' + lokasiStr;
    let sheet = dbRekap.getSheetByName(rekapSheetName);
    if (!sheet) return;

    let data = sheet.getDataRange().getValues();
    let targetRow = -1;
    let targetCol = -1;
    let todayStr = Utilities.formatDate(dateBase, 'Asia/Jakarta', 'dd/MM/yyyy');

    for (let r = 1; r < data.length; r++) {
      if (data[r][0].toString() === nrpp.toString()) {
        targetRow = r + 1;
        break;
      }
    }
    if (data.length > 0) {
      for (let c = 2; c < data[0].length; c += 4) {
        let cellDateStr =
          data[0][c] instanceof Date
            ? Utilities.formatDate(data[0][c], 'Asia/Jakarta', 'dd/MM/yyyy')
            : data[0][c].toString();
        if (cellDateStr.includes(todayStr)) {
          targetCol = c + 1;
          break;
        }
      }
    }
    if (targetRow !== -1 && targetCol !== -1) {
      sheet.getRange(targetRow, targetCol + 1).setValue('23:59'); // Waktu Masuk Anomali
      sheet.getRange(targetRow, targetCol + 3).setValue('0'); // Durasi Anomali
    }
  } catch (e) {}
}

// ==========================================================
// MODUL SUPER ADMIN: UNLOCK PRINT STATUS (RESET CLAIM)
// ==========================================================
function api_adminUnlockPrint(stNumber, nrpp) {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let count = 0;

    // Scan seluruh sheet log operasional
    dbUpd.getSheets().forEach((sheet) => {
      if (!sheet.getName().startsWith('Log_')) return;
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map((h) => String(h).toUpperCase().trim());

      const idxST = headers.indexOf('NO_ST');
      const idxNRPP = headers.indexOf('NRPP');
      const idxStatusKlaim =
        headers.indexOf('STATUS_KLAIM') !== -1
          ? headers.indexOf('STATUS_KLAIM')
          : 18;
      const idxIdKlaim =
        headers.indexOf('ID_KLAIM') !== -1 ? headers.indexOf('ID_KLAIM') : 19;

      const targetST = String(stNumber).replace(/^'/, '').trim();
      const targetNRPP = String(nrpp).trim();

      for (let i = 1; i < data.length; i++) {
        let dbST = data[i][idxST]
          ? String(data[i][idxST]).replace(/^'/, '').trim()
          : '';
        let dbNRPP = data[i][idxNRPP] ? String(data[i][idxNRPP]).trim() : '';

        if (dbST === targetST && dbNRPP === targetNRPP) {
          sheet.getRange(i + 1, idxStatusKlaim + 1).setValue('BELUM PRINT'); // Reset Status
          sheet.getRange(i + 1, idxIdKlaim + 1).setValue(''); // Hapus ID Klaim
          count++;
        }
      }
    });

    return {
      status: 'success',
      message: `Gembok ST ${stNumber} berhasil dibuka (${count} baris).`,
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function api_adminBulkUnlockPrint(trxIds) {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let count = 0;

    dbUpd.getSheets().forEach((sheet) => {
      if (!sheet.getName().startsWith('Log_')) return;
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map((h) => String(h).toUpperCase().trim());

      const idxStatusKlaim =
        headers.indexOf('STATUS_KLAIM') !== -1
          ? headers.indexOf('STATUS_KLAIM')
          : 18;
      const idxIdKlaim =
        headers.indexOf('ID_KLAIM') !== -1 ? headers.indexOf('ID_KLAIM') : 19;

      for (let i = 1; i < data.length; i++) {
        let currentId = data[i][0].toString();
        if (trxIds.includes(currentId)) {
          sheet.getRange(i + 1, idxStatusKlaim + 1).setValue('BELUM PRINT');
          sheet.getRange(i + 1, idxIdKlaim + 1).setValue('');
          count++;
        }
      }
    });

    return {
      status: 'success',
      message: `${count} Gembok berhasil dibuka secara masal!`,
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// MODUL HRIS: HYBRID ENGINE SCANNER LOG INDIVIDU (30 HARI)
// ==========================================================
function api_adminGetIndividualLogs(nrpp, month, year) {
  try {
    const dbs = [DB_UPD_ID, DB_ARCHIVE_ID]; // [HYBRID]: Scan Aktif & Arsip
    let logs = [];

    dbs.forEach((dbId) => {
      try {
        const db = SpreadsheetApp.openById(dbId);
        db.getSheets().forEach((sheet) => {
          const sheetName = sheet.getName();
          if (!sheetName.startsWith('Log_')) return;

          const data = sheet.getDataRange().getValues();
          if (data.length <= 1) return;

          const headers = data[0].map((h) => String(h).toUpperCase().trim());
          const idxNRPP = headers.indexOf('NRPP');

          // [DYNAMIC LOOKUP + ANTI MAGIC-INDEX]: Mencari index kolom yang mungkin bergeser
          const idxST =
            headers.indexOf('NO_ST') !== -1
              ? headers.indexOf('NO_ST')
              : MAP_LOG_OPS.NO_ST;
          const idxTgl =
            headers.indexOf('WAKTU_KELUAR') !== -1
              ? headers.indexOf('WAKTU_KELUAR')
              : MAP_LOG_OPS.WAKTU_KELUAR;
          const idxCust =
            headers.indexOf('CUSTOMER') !== -1
              ? headers.indexOf('CUSTOMER')
              : MAP_LOG_OPS.CUSTOMER;
          const idxLok = headers.lastIndexOf('LOKASI'); // Gunakan lastIndexOf untuk Destinasi (Kolom K)
          const idxDur =
            headers.indexOf('DURASI_JAM') !== -1
              ? headers.indexOf('DURASI_JAM')
              : MAP_LOG_OPS.DURASI;
          const idxNom =
            headers.indexOf('NOMINAL_UPD') !== -1
              ? headers.indexOf('NOMINAL_UPD')
              : MAP_LOG_OPS.NOMINAL;
          const idxStat =
            headers.indexOf('STATUS_PERJALANAN') !== -1
              ? headers.indexOf('STATUS_PERJALANAN')
              : MAP_LOG_OPS.STATUS_JALAN;
          const idxApp =
            headers.indexOf('STATUS_APPROVE') !== -1
              ? headers.indexOf('STATUS_APPROVE')
              : MAP_LOG_OPS.STATUS_APPROVE;

          // [GOLDEN RULE 4]: Scan data
          for (let i = 1; i < data.length; i++) {
            // [ZERO TRUST]: Validasi NRPP secara ketat (String Comparison)
            if (String(data[i][idxNRPP]).trim() === String(nrpp).trim()) {
              let rawTgl = data[i][idxTgl];
              let dateObj = rawTgl instanceof Date ? rawTgl : new Date(rawTgl);

              if (isNaN(dateObj.getTime())) continue;

              // Filter Berdasarkan Bulan dan Tahun Pilihan HRD
              if (
                dateObj.getMonth() === parseInt(month) &&
                dateObj.getFullYear() === parseInt(year)
              ) {
                logs.push({
                  tanggal: Utilities.formatDate(
                    dateObj,
                    'Asia/Jakarta',
                    'dd/MM/yyyy HH:mm'
                  ),
                  st: data[i][idxST]
                    ? String(data[i][idxST]).replace(/^'/, '').trim()
                    : 'TANPA ST',
                  customer: data[i][idxCust] || '-',
                  lokasi: data[i][idxLok] || '-',
                  durasi: parseFloat(data[i][idxDur] || 0),
                  nominal: parseFloat(data[i][idxNom] || 0),
                  status: data[i][idxStat] || 'SELESAI',
                  persetujuan: data[i][idxApp] || 'PENDING',
                  rawDate: dateObj.getTime(),
                });
              }
            }
          }
        });
      } catch (e) {
        console.warn('Skip DB: ' + dbId);
      }
    });

    // Urutkan secara kronologis (A-Z) agar laporan PDF rapi
    logs.sort((a, b) => a.rawDate - b.rawDate);
    return { status: 'success', data: logs, filter: { month, year } };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function renderPublicVerification(stNumber, nrpp) {
  let foundData = null;
  const targetST = String(stNumber).replace(/^'/, '').trim();
  const targetNRPP = String(nrpp).trim();

  try {
    // Mencari data di DB_UPD dan DB_SALES
    const dbs = [DB_UPD_ID, DB_SALES_ID];
    for (const dbId of dbs) {
      if (foundData) break;
      const db = SpreadsheetApp.openById(dbId);
      const sheets = db.getSheets();

      for (const sheet of sheets) {
        const values = sheet.getDataRange().getValues();
        if (values.length < 2) continue;
        const headers = values[0].map((h) => String(h).toUpperCase().trim());
        const iST =
          headers.indexOf('NO_ST') !== -1 ? headers.indexOf('NO_ST') : 8;
        const iNRPP =
          headers.indexOf('NRPP') !== -1 ? headers.indexOf('NRPP') : 1;

        for (let i = 1; i < values.length; i++) {
          if (
            String(values[i][iST]).includes(targetST) &&
            String(values[i][iNRPP]) === targetNRPP
          ) {
            foundData = {
              nama: values[i][2],
              customer: values[i][headers.indexOf('CUSTOMER') || 9],
              status:
                values[i][headers.indexOf('STATUS_PERJALANAN') || 17] ||
                'SELESAI',
              waktu: values[i][headers.indexOf('WAKTU_KELUAR') || 11],
            };
            break;
          }
        }
      }
    }

    const color = foundData ? 'emerald' : 'rose';
    const statusText = foundData ? 'DOKUMEN VALID' : 'DATA TIDAK DITEMUKAN';

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-100 flex items-center justify-center min-h-screen p-4">
        <div class="max-w-xs w-full bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          <div class="p-6 text-center">
            <div class="w-16 h-16 bg-${color}-100 text-${color}-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="${foundData ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'}"></path></svg>
            </div>
            <h1 class="text-xl font-black text-slate-800">${statusText}</h1>
            ${
              foundData
                ? `
              <div class="mt-4 text-left text-sm space-y-2 bg-slate-50 p-4 rounded-2xl">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Nama</p><p class="font-bold text-slate-700">${foundData.nama}</p>
                <p class="text-[10px] font-bold text-slate-400 uppercase">No ST</p><p class="font-bold text-indigo-600">${targetST}</p>
                <p class="text-[10px] font-bold text-slate-400 uppercase">Customer</p><p class="font-bold text-slate-700">${foundData.customer}</p>
              </div>
            `
                : `<p class="text-slate-500 text-xs mt-2">Nomor ST atau NRPP tidak cocok dengan database kami.</p>`
            }
          </div>
          <div class="bg-slate-800 p-3 text-center text-[9px] text-white font-bold tracking-widest uppercase">C.E.P.U VERIFICATION SYSTEM</div>
        </div>
      </body>
      </html>`;
    return HtmlService.createHtmlOutput(html);
  } catch (e) {
    return HtmlService.createHtmlOutput('<p>Error: ' + e.message + '</p>');
  }
}

// ==========================================================
// MODUL USER: UPDATE NOMOR ST EPICOR (FIXED VERSION)
// ==========================================================
function api_userUpdateST(trxIds, newST, user) {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = 'Log_' + user.lokasi.trim();
    let sheet = dbUpd.getSheetByName(targetSheetName);

    if (!sheet)
      throw new Error('Sheet ' + targetSheetName + ' tidak ditemukan.');

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map((h) => String(h).toUpperCase().trim());
    let idxST = headers.indexOf('NO_ST');

    // Safety check jika kolom NO_ST tidak ditemukan
    if (idxST === -1) idxST = 8;

    let count = 0;
    for (let i = 1; i < data.length; i++) {
      // Bandingkan ID Transaksi (Kolom A)
      let currentId = String(data[i][0]).trim();
      if (trxIds.includes(currentId)) {
        let targetCell = sheet.getRange(i + 1, idxST + 1);

        // SOLUSI: Set format sel ke Plain Text dulu, baru isi nilainya (Tanpa tanda petik)
        targetCell.setNumberFormat('@');
        targetCell.setValue(newST.toString().toUpperCase().trim());

        count++;
      }
    }

    SpreadsheetApp.flush(); // Paksa sinkronisasi database
    return {
      status: 'success',
      message: 'Berhasil update ' + count + ' trip ke ST: ' + newST,
    };
  } catch (e) {
    console.error('Error api_userUpdateST: ' + e.message);
    return { status: 'error', message: 'Gagal: ' + e.message };
  }
}

// ==========================================================
// [SECURITY FIX v1.3.02]: UNIVERSAL RADIUS VALIDATOR
// Memperbaiki deteksi "NON AKTIF" agar tidak terjebak teks 'AKTIF'
// ==========================================================
function _checkRadiusValidation(userLokasi, kordinat) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetLatlong = dbMaster.getSheetByName('Master_Latlong');
    if (!sheetLatlong) return { valid: true };

    const dataLatlong = sheetLatlong.getDataRange().getValues();
    let targetLat = null,
      targetLon = null,
      maxRadius = 0,
      isLatlongActive = false;

    for (let i = 1; i < dataLatlong.length; i++) {
      if (
        dataLatlong[i][0].toString().trim().toUpperCase() ===
        userLokasi.toString().trim().toUpperCase()
      ) {
        targetLat = parseFloat(dataLatlong[i][1]);
        targetLon = parseFloat(dataLatlong[i][2]);
        maxRadius = parseFloat(dataLatlong[i][3] || 50);

        // [FIX LOGIKA]: Pastikan mengandung 'AKTIF' TAPI TIDAK mengandung 'NON' atau 'TIDAK'
        let stat = dataLatlong[i][4].toString().trim().toUpperCase();
        isLatlongActive =
          (stat.includes('AKTIF') || stat.includes('AKITIF')) &&
          !stat.includes('NON') &&
          !stat.includes('TIDAK');
        break;
      }
    }

    if (isLatlongActive && targetLat !== null && targetLon !== null) {
      if (kordinat === 'BYPASS_ADMIN') return { valid: true };

      const userKordinat = kordinat.toString().split(',');
      if (userKordinat.length === 2) {
        const userLat = parseFloat(userKordinat[0].trim());
        const userLon = parseFloat(userKordinat[1].trim());

        const R = 6371e3; // Radius Bumi
        const rad = Math.PI / 180;
        const dLat = (targetLat - userLat) * rad;
        const dLon = (targetLon - userLon) * rad;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(userLat * rad) *
            Math.cos(targetLat * rad) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance > maxRadius) {
          return {
            valid: false,
            message: `⛔ FRAUD ALERT: Jarak Anda ${distance.toFixed(0)}m dari POS. (Maks: ${maxRadius}m)`,
          };
        }
      } else {
        return { valid: false, message: 'Kordinat GPS tidak valid!' };
      }
    }
    return { valid: true }; // Bypassed jika NON AKTIF
  } catch (e) {
    return { valid: true };
  }
}

// [FIX GOLDEN RULE #4]: Pengganti appendRow yang aman dari ArrayFormula
function _safeInsertRow(sheet, rowData) {
  const realLastRow = sheet.getRange('A:A').getValues().filter(String).length;
  const targetRow = realLastRow + 1;
  sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
}

// ==========================================================
// MODUL USER: AGREGATOR REKAP DEKLARASI TAHUNAN
// ==========================================================
function api_getSummaryDeklarasiTahunan(user, tahun) {
  try {
    user = _syncFreshUser(user);
    const dbs = [DB_UPD_ID, DB_ARCHIVE_ID]; // [HYBRID]: Baca Aktif & Arsip
    let summary = Array.from({ length: 12 }, () => ({
      totalTitik: 0,
      stSet: new Set(),
      totalTanpaST: 0,
    }));
    const tTahunStr = String(tahun);

    dbs.forEach((dbId) => {
      try {
        const db = SpreadsheetApp.openById(dbId);
        let sheet = db.getSheetByName('Log_' + user.lokasi.trim());
        if (!sheet) return;

        const data = sheet.getDataRange().getValues();
        const headers = data[0].map((h) => String(h).toUpperCase().trim());
        const iNoST =
          headers.indexOf('NO_ST') !== -1 ? headers.indexOf('NO_ST') : 8;
        const iWaktuKeluar =
          headers.indexOf('WAKTU_KELUAR') !== -1
            ? headers.indexOf('WAKTU_KELUAR')
            : 11;

        // [GOLDEN RULE 4]: Reverse Loop Scan
        for (let i = data.length - 1; i >= 1; i--) {
          if (data[i][1].toString() === user.nrpp.toString()) {
            let dateObj =
              data[i][iWaktuKeluar] instanceof Date
                ? data[i][iWaktuKeluar]
                : new Date(data[i][iWaktuKeluar]);
            if (isNaN(dateObj.getTime())) continue;

            if (
              Utilities.formatDate(dateObj, 'Asia/Jakarta', 'yyyy') ===
              tTahunStr
            ) {
              let mIndex =
                parseInt(
                  Utilities.formatDate(dateObj, 'Asia/Jakarta', 'MM'),
                  10
                ) - 1;
              let st = data[i][iNoST]
                ? String(data[i][iNoST]).replace(/^'/, '').trim()
                : '';

              summary[mIndex].totalTitik++;
              if (st && st !== 'TANPA ST' && st !== 'BELUM ADA NO ST')
                summary[mIndex].stSet.add(st);
              else summary[mIndex].totalTanpaST++;
            }
          }
        }
      } catch (e) {
        console.warn('Skip DB: ' + dbId);
      }
    });

    return {
      status: 'success',
      data: summary.map((s) => ({
        totalTitik: s.totalTitik,
        totalST: s.stSet.size,
        totalTanpaST: s.totalTanpaST,
      })),
    };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ==========================================================
// [ABSTRACTION LAYER]: KARYAWAN DTO & NORMALIZATION
// ==========================================================

/**
 * [HELPER]: Map raw spreadsheet row to UserSession object.
 * Mencegah kebocoran schema array (magic-index) ke dalam business logic.
 * Menjamin Data Integrity Policy (trim & toUpperCase) di titik ekstraksi.
 * @param {Array} row - Baris mentah dari tabel Master_Karyawan
 * @returns {Partial<UserSession> | null}
 */
function _mapKaryawanRow(row) {
  if (!row || row.length === 0) return null;

  return {
    nrpp: String(row[MAP_KARYAWAN.NRPP] || '').trim(),
    nama: String(row[MAP_KARYAWAN.NAMA] || '').trim(),
    jabatan: String(row[MAP_KARYAWAN.JABATAN] || '')
      .trim()
      .toUpperCase(),
    golongan: String(row[MAP_KARYAWAN.GOLONGAN] || '')
      .trim()
      .toUpperCase(),
    statusKaryawan: String(row[MAP_KARYAWAN.STATUS_KARYAWAN] || '')
      .trim()
      .toUpperCase(),
    departemen: String(row[MAP_KARYAWAN.DEPARTEMEN] || '')
      .trim()
      .toUpperCase(),
    lokasi: String(row[MAP_KARYAWAN.LOKASI] || '')
      .trim()
      .toUpperCase(),
  };
}

/**
 * [HELPER]: Memastikan objek sesi selalu memiliki properti standar (Anti-Undefined).
 * Melakukan sanitasi final (Safety Net) sebelum objek dilempar melintasi fungsi/frontend.
 * @param {Partial<UserSession> | Object} userObj - Objek mentah dari cache atau mapper
 * @returns {UserSession}
 */
function _normalizeUserSession(userObj) {
  if (!userObj) userObj = {}; // Anti-Crash jika undefined

  return {
    nrpp: String(userObj.nrpp || '').trim(),
    nama: String(userObj.nama || 'User').trim(),
    jabatan: String(userObj.jabatan || 'USER')
      .trim()
      .toUpperCase(),
    golongan: String(userObj.golongan || '-')
      .trim()
      .toUpperCase(),
    statusKaryawan: String(userObj.statusKaryawan || '-')
      .trim()
      .toUpperCase(),
    departemen: String(userObj.departemen || '-')
      .trim()
      .toUpperCase(),
    lokasi: String(userObj.lokasi || 'OFFICE')
      .trim()
      .toUpperCase(),
    isUpdEligible: Boolean(userObj.isUpdEligible),
  };
}

// ==========================================================
// MODUL OTOMASI: ENTERPRISE COLD STORAGE ARCHIVER
// Trigger: Cron Job Bulanan (Tanggal 1)
// ==========================================================
function trigger_AutoArchiver() {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    const dbArc = SpreadsheetApp.openById(DB_ARCHIVE_ID);

    // Batas usia data operasional aktif: 90 Hari (3 Bulan)
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 90);

    dbUpd.getSheets().forEach((sheet) => {
      const sheetName = sheet.getName();
      if (!sheetName.startsWith('Log_')) return;

      let arcSheet = dbArc.getSheetByName(sheetName);
      if (!arcSheet) arcSheet = dbArc.insertSheet(sheetName);

      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;

      const headers = data[0].map((h) => String(h).toUpperCase().trim());
      const iKeluar =
        headers.indexOf('WAKTU_KELUAR') !== -1
          ? headers.indexOf('WAKTU_KELUAR')
          : 11;
      const iStatus =
        headers.indexOf('STATUS_PERJALANAN') !== -1
          ? headers.indexOf('STATUS_PERJALANAN')
          : 17;
      const iKlaim =
        headers.indexOf('STATUS_KLAIM') !== -1
          ? headers.indexOf('STATUS_KLAIM')
          : 18;
      const iApprove =
        headers.indexOf('STATUS_APPROVE') !== -1
          ? headers.indexOf('STATUS_APPROVE')
          : 20;

      let rowsToArchive = [];
      let rowsToDelete = [];

      // [GOLDEN RULE 4]: REVERSE LOOP UNTUK PENGHAPUSAN AMAN
      // Loop dari bawah ke atas agar array push untuk deletion sudah terurut (Descending)
      for (let i = data.length - 1; i >= 1; i--) {
        let wKeluar = data[i][iKeluar];
        let dateObj = wKeluar instanceof Date ? wKeluar : new Date(wKeluar);

        if (!isNaN(dateObj.getTime()) && dateObj < limitDate) {
          let statJalan = String(data[i][iStatus] || '').toUpperCase();
          let statKlaim = String(data[i][iKlaim] || '').toUpperCase();
          let statApprove = String(data[i][iApprove] || '').toUpperCase();

          if (
            statJalan === 'SELESAI' &&
            statKlaim === 'SUDAH PRINT' &&
            statApprove === 'APPROVED'
          ) {
            // [ENTERPRISE FIX]: Kloning array baris untuk dimodifikasi secara aman
            let rowDataToMove = [...data[i]];

            // 1. Amankan Kolom NO_ST (Index 8) dari Auto-Casting (Hilang 0 di depan)
            let idxST =
              headers.indexOf('NO_ST') !== -1 ? headers.indexOf('NO_ST') : 8;
            if (rowDataToMove[idxST]) {
              rowDataToMove[idxST] =
                "'" + String(rowDataToMove[idxST]).replace(/^'/, '');
            }

            // 2. Amankan Kolom NRPP (Index 1) dari Auto-Casting
            let idxNRPP =
              headers.indexOf('NRPP') !== -1 ? headers.indexOf('NRPP') : 1;
            if (rowDataToMove[idxNRPP]) {
              rowDataToMove[idxNRPP] =
                "'" + String(rowDataToMove[idxNRPP]).replace(/^'/, '');
            }

            rowsToArchive.unshift(rowDataToMove); // Gunakan array yang sudah disuntik Apostrophe
            rowsToDelete.push(i + 1);
          }
        }
      }

      if (rowsToArchive.length > 0) {
        // 1. Write ke Cold Storage (Cek jika arsip masih kosong, copy header)
        const arcData = arcSheet.getDataRange().getValues();
        if (
          arcData.length === 0 ||
          (arcData.length === 1 && arcData[0][0] === '')
        ) {
          arcSheet.getRange(1, 1, 1, headers.length).setValues([data[0]]);
        }
        arcSheet
          .getRange(
            arcSheet.getLastRow() + 1,
            1,
            rowsToArchive.length,
            rowsToArchive[0].length
          )
          .setValues(rowsToArchive);

        // 2. Destruksi dari Database Aktif
        // Dieksekusi berurutan dari index terbawah ke teratas (berkat reverse loop), tidak akan merusak index baris!
        rowsToDelete.forEach((rowIdx) => {
          sheet.deleteRow(rowIdx);
        });

        console.log(
          `[COLD STORAGE] Mengamankan dan memusnahkan ${rowsToArchive.length} baris dari ${sheetName}.`
        );
      }
    });
  } catch (e) {
    console.error('Auto-Archiver Gagal: ' + e.message);
  }
}

// [PATCH]: API untuk mencatat aktivitas auto-login/refresh
function api_recordActivityLog(nrpp) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetLogin = dbMaster.getSheetByName('Master_Login');
    const data = sheetLogin.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === nrpp.toString()) {
        _stampActivityLog(sheetLogin, i + 1, 5, 'AUTO');
        return { status: 'success' };
      }
    }
  } catch (e) {
    return { status: 'error' };
  }
}

// ==========================================================
// [ABSTRACTION LAYER]: PULANG DTO & ATOMIC MUTATION
// ==========================================================

/**
 * [HELPER]: Normalisasi payload kepulangan untuk keamanan Business Logic.
 * @param {Object} payload - Objek mentah dari UI
 * @returns {PulangPayload}
 */
function _normalizePulangPayload(payload) {
  if (!payload) payload = {};
  return {
    idTransaksi: String(payload.idTransaksi || '').trim(),
    kordinatMasuk: String(payload.kordinatMasuk || '').trim(),
    statusAbsensi: String(payload.statusAbsensi || 'H (Non Project)').trim(),
  };
}

/**
 * [HELPER]: Atomic Row Mutation (1x API Call ke Google Sheets).
 * Menulis sekumpulan data kepulangan secara absolut dan instan.
 * Mencegah silent corruption & mempercepat waktu respons hingga 400%.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} targetRow - (1-indexed) baris aktual di Spreadsheet
 * @param {boolean} isSales
 * @param {Object} updateData - Kumpulan nilai akhir yang sudah di-finalize
 */
function _applyPulangMutation(sheet, targetRow, isSales, updateData) {
  if (!isSales) {
    // OPS: Kolom 14 sampai 18 (N-R) berurutan.
    // Index: WAKTU_MASUK, KORDINAT_MASUK, DURASI, NOMINAL, STATUS_JALAN
    const startCol = MAP_LOG_OPS.WAKTU_MASUK + 1; // getRange column is 1-indexed
    const rowData = [
      updateData.timeMasukSave,
      updateData.kordinatMasuk,
      updateData.durasi,
      updateData.nominalUPD,
      'SELESAI',
    ];
    // Eksekusi Atomik (O(1) Mutator)
    sheet.getRange(targetRow, startCol, 1, rowData.length).setValues([rowData]);
  } else {
    // SALES: Menggunakan Index Kolom 13 (M)
    const rowData = [
      updateData.timeMasukSave,
      updateData.kordinatMasuk,
      updateData.durasi,
      'SELESAI',
    ];
    sheet.getRange(targetRow, 13, 1, rowData.length).setValues([rowData]);
  }
}

// ==============================================================================
// [PATCH v1.4.34]: BE-Side URL Shortener — PropertiesService (Persistent)
// Ganti CacheService (hilang saat deploy) → PropertiesService (permanen).
// Fallback chain: is.gd → v.gd → full URL
// ==============================================================================
function api_getShortUrl(stNumber, nrpp) {
  try {
    // [FIX]: Gunakan URL aktif saat ini, bukan hardcoded — agar selalu mengarah ke kode terbaru
    const webAppUrl = ScriptApp.getService().getUrl();
    const fullUrl   = webAppUrl + "?verify_st=" + stNumber + "&nrpp=" + nrpp;

    // PropKey menyertakan 6 char hash URL → jika deploy baru (URL baru), short URL dibuat ulang
    const urlSig  = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, webAppUrl)
                      .map(function(b){ return (b < 0 ? b + 256 : b).toString(16).padStart(2,'0'); })
                      .join('').substring(0, 6).toUpperCase();
    const propKey = "SU_" + urlSig + "_" + stNumber + "_" + nrpp;

    // 1. Cek PropertiesService (persisten)
    const props  = PropertiesService.getScriptProperties();
    const stored = props.getProperty(propKey);
    if (stored) {
      console.log("[api_getShortUrl] Props hit:", stored);
      return { status: "success", shortUrl: stored, source: "props" };
    }

    // 2. Coba is.gd → v.gd sebagai fallback
    var shortUrl = _tryShorten("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(fullUrl));
    if (!shortUrl) {
      shortUrl = _tryShorten("https://v.gd/create.php?format=simple&url=" + encodeURIComponent(fullUrl));
    }

    if (shortUrl) {
      props.setProperty(propKey, shortUrl);
      console.log("[api_getShortUrl] Shortened & stored:", shortUrl);
      return { status: "success", shortUrl: shortUrl, source: "new" };
    }

    // 3. Final fallback: full URL aktif
    console.warn("[api_getShortUrl] Shortener gagal, pakai full URL");
    return { status: "success", shortUrl: fullUrl, source: "fallback" };

  } catch (e) {
    console.error("[api_getShortUrl] Error:", e.message);
    return { status: "success", shortUrl: ScriptApp.getService().getUrl() + "?verify_st=" + stNumber + "&nrpp=" + nrpp, source: "error-fallback" };
  }
}

function _tryShorten(apiUrl) {
  try {
    var resp = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true, followRedirects: true });
    var body = resp.getContentText().trim();
    if (resp.getResponseCode() === 200 && body.startsWith("http")) return body;
    return null;
  } catch (e) {
    return null;
  }
}

// ==============================================================================
// [NEW API]: ENTERPRISE GLOBAL ANALYTICS DASHBOARD (WITH TIME FILTER)
// ==============================================================================
function api_getGlobalAnalytics(timeFilter = 'ALL') {
  try {
    const dbs = [DB_UPD_ID, DB_SALES_ID, DB_ARCHIVE_ID]; 
    const now = new Date();
    
    let cutoffTime = 0; 

    // Kalkulasi batas waktu mundur ke belakang (Timestamp)
    if (timeFilter === '1M') {
      cutoffTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    } else if (timeFilter === '6M') {
      cutoffTime = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
    } else if (timeFilter === '1Y') {
      cutoffTime = new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime();
    }

    const stats = {
      attendance: { total: 0, hadir: 0, bks: 0, st: 0 },
      finance: { totalUpd: 0 },
      ops: { totalTrips: 0, locations: new Set(), totalHours: 0 },
      leaderboard: {},
      departments: {},
      customers: {},
      trend: {}
    };

    dbs.forEach(dbId => {
      try {
        if (!dbId || dbId === "") return;
        const dbApp = SpreadsheetApp.openById(dbId);
        
        dbApp.getSheets().forEach(sheet => {
          if (!sheet.getName().startsWith('Log_')) return;
          const values = sheet.getDataRange().getValues();
          if (values.length <= 1) return;
          
          const dynamicMap = _buildDynamicMap(values[0]);
          const dateIdx = dynamicMap.WAKTU_KELUAR !== undefined ? dynamicMap.WAKTU_KELUAR : 11;

          for (let i = 1; i < values.length; i++) {
            const row = values[i];
            
            // [LOGIKA FILTER TANGGAL TERBARU]
            const rawDate = row[dateIdx];
            const wKeluar = _safeDate(rawDate);
            const wTime = wKeluar.getTime();

            // Skip jika tanggal rusak ATAU lebih lama dari batas waktu filter
            if (isNaN(wTime) || wTime === 0) continue; 
            if (timeFilter !== 'ALL' && wTime < cutoffTime) continue;

            const dto = _mapLogOpsRow(row, dynamicMap);
            if (!dto || !dto.nrpp) continue;

            const nominal = Number(dto.nominal) || 0;
            const durasi = Number(dto.durasi) || 0;
            
            stats.ops.totalTrips++;
            stats.ops.totalHours += durasi;
            stats.finance.totalUpd += nominal;
            if (dto.lokasiDest && dto.lokasiDest !== '-') stats.ops.locations.add(_S(dto.lokasiDest));
            
            // 1. Attendance
            stats.attendance.total++;
            const sot = _S(_safeCell(row, 22)); 
            if (sot.includes('H') || sot.includes('HADIR')) stats.attendance.hadir++;
            else if (sot.includes('BKS')) stats.attendance.bks++;
            else if (sot.includes('ST') || sot.includes('SAKIT')) stats.attendance.st++;
            
            // 2. Leaderboard
            const nrpp = _S(dto.nrpp);
            if (!stats.leaderboard[nrpp]) stats.leaderboard[nrpp] = { nama: _safeCell(row, 2, nrpp), count: 0 };
            stats.leaderboard[nrpp].count++;

            // 3. Cost Center
            const dept = _S(_safeCell(row, 6, 'TANPA DEPARTEMEN'));
            const jabatan = _S(_safeCell(row, 3, 'TANPA JABATAN'));
            if (!stats.departments[dept]) stats.departments[dept] = { name: dept, totalUpd: 0, totalTrips: 0, jabatans: {} };
            stats.departments[dept].totalUpd += nominal;
            stats.departments[dept].totalTrips += 1;
            if (!stats.departments[dept].jabatans[jabatan]) stats.departments[dept].jabatans[jabatan] = { name: jabatan, totalUpd: 0, totalTrips: 0 };
            stats.departments[dept].jabatans[jabatan].totalUpd += nominal;
            stats.departments[dept].jabatans[jabatan].totalTrips += 1;

            // 4. Analitik Customer
            const cust = _S(dto.customer);
            const noST = _S(dto.noST);
            const lok = _S(dto.lokasiDest);
            if (!stats.customers[cust]) stats.customers[cust] = { name: cust, upd: 0, trips: 0, stSet: new Set(), locSet: new Set() };
            stats.customers[cust].upd += nominal;
            stats.customers[cust].trips++;
            if (noST && noST !== 'TANPA ST' && noST !== '-') stats.customers[cust].stSet.add(noST);
            if (lok && lok !== '-') stats.customers[cust].locSet.add(lok);

            // 5. Trend Chart
            const mKey = Utilities.formatDate(wKeluar, "Asia/Jakarta", "MMM yyyy");
            const sortKey = Utilities.formatDate(wKeluar, "Asia/Jakarta", "yyyy-MM");
            if (!stats.trend[sortKey]) stats.trend[sortKey] = { label: mKey, upd: 0, trips: 0, sort: sortKey };
            stats.trend[sortKey].upd += nominal;
            stats.trend[sortKey].trips++;
          }
        });
      } catch (dbErr) { console.warn(`[ANALYTICS] DB ${dbId}: ${dbErr.message}`); }
    });

    if (stats.ops.totalTrips === 0) return { status: 'success', data: null, filter: timeFilter };

    const deptArray = Object.values(stats.departments).map(d => ({
        ...d, jabatans: Object.values(d.jabatans).sort((a, b) => b.totalUpd - a.totalUpd)
    })).sort((a, b) => b.totalUpd - a.totalUpd);

    const custArray = Object.values(stats.customers).map(c => ({
        name: c.name, upd: c.upd, trips: c.trips,
        stList: Array.from(c.stSet).join(', '),
        locList: Array.from(c.locSet).join(' | ')
    })).sort((a, b) => b.upd - a.upd).slice(0, 30);

    const trendArray = Object.values(stats.trend).sort((a, b) => a.sort.localeCompare(b.sort));

    return {
      status: 'success',
      data: {
        filter: timeFilter,
        attendance: stats.attendance,
        totalUpd: stats.finance.totalUpd,
        totalTrips: stats.ops.totalTrips,
        uniqueLocations: stats.ops.locations.size,
        totalHours: stats.ops.totalHours.toFixed(1),
        avgUpd: (stats.finance.totalUpd / stats.ops.totalTrips || 0).toFixed(0),
        topPerformers: Object.values(stats.leaderboard).sort((a, b) => b.count - a.count).slice(0, 5),
        departments: deptArray,
        customers: custArray,
        trend: trendArray
      }
    };
  } catch (e) {
    return { status: 'error', message: 'Engine Error: ' + e.toString() };
  }
}

// ==============================================================================
// [ENGINE FIXED]: ENTERPRISE OPERATIONAL ANALYTICS AGGREGATOR
// Anti-Crash & Anti-Data Kosong (Strict Type Coercion)
// ==============================================================================
function api_getOperationalAnalytics(filters) {
  try {
    // 1. PROTEKSI PARAMETER (Mencegah Undefined dari Frontend)
    if (!filters || typeof filters !== 'object') {
      filters = { period: 'ALL', status: 'ALL', division: 'ALL', location: 'ALL' };
    }
    
    const dbs = [DB_UPD_ID, DB_SALES_ID, DB_ARCHIVE_ID]; 
    const now = new Date();
    
    // 2. NORMALISASI FILTER MENJADI STRING KAPITAL AMAN
    const fPeriod = String(filters.period || 'ALL').trim().toUpperCase();
    const fStatus = String(filters.status || 'ALL').trim().toUpperCase();
    const fDiv = String(filters.division || 'ALL').trim().toUpperCase();
    const fLoc = String(filters.location || 'ALL').trim().toUpperCase();

    // 3. KALKULASI BATAS WAKTU (Cutoff)
    let cutoff = 0; 
    if (fPeriod === '1D') cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    else if (fPeriod === '1W') cutoff = now.getTime() - (7 * 24 * 60 * 60 * 1000);
    else if (fPeriod === '1M') cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    else if (fPeriod === '1Y') cutoff = new Date(now.getFullYear(), 0, 1).getTime();
    else cutoff = 0; // Mode 'ALL' akan mereset cutoff ke 0 mutlak

    const stats = {
      summary: { trips: 0, upd: 0, hours: 0, stCount: new Set(), techSet: new Set() },
      workload: {}, 
      noST: {},     
      dist: { status: {}, div: {}, loc: {} },
      trend: {}
    };

    dbs.forEach(dbId => {
      try {
        if (!dbId || dbId === "") return;
        const db = SpreadsheetApp.openById(dbId);
        
        db.getSheets().forEach(sheet => {
          if (!sheet.getName().startsWith('Log_')) return;
          const data = sheet.getDataRange().getValues();
          if (data.length <= 1) return;

          const map = _buildDynamicMap(data[0]);

          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            
            // --- FILTER WAKTU ANTI-SKIP ---
            const rawDate = row[map.WAKTU_KELUAR] !== undefined ? row[map.WAKTU_KELUAR] : row[11];
            const wKeluar = _safeDate(rawDate);
            const wTime = wKeluar.getTime();

            // Aturan Utama: Lompati HANYA JIKA waktu lebih tua dari cutoff (dan cutoff aktif)
            if (cutoff > 0 && wTime < cutoff) continue;
            // Jika tanggal rusak (0) tapi user MINTA filter periode, lompati baris ini
            if (cutoff > 0 && wTime === 0) continue; 

            // --- NORMALISASI STRING SPREADSHEET ---
            const dept = _S(_safeCell(row, 6, 'UNKNOWN')); 
            const loc = _S(_safeCell(row, 7, 'UNKNOWN'));  
            const sot = _S(_safeCell(row, 22, 'H'));       

            // --- FILTER DIVISI & LOKASI ---
            if (fDiv !== 'ALL' && dept !== fDiv) continue;
            if (fLoc !== 'ALL' && loc !== fLoc) continue;
            if (fStatus !== 'ALL' && !sot.includes(fStatus)) continue;

            const dto = _mapLogOpsRow(row, map);
            if (!dto || !dto.nrpp) continue;

            // =========================================================
            // LULUS SEMUA FILTER -> MULAI MENGHITUNG (AGREGASI)
            // =========================================================
            const upd = Number(dto.nominal) || 0;
            const dur = Number(dto.durasi) || 0;
            const nrpp = _S(dto.nrpp);
            const st = _S(dto.noST);
            const cust = _S(dto.customer);
            const namaKaryawan = _safeCell(row, 2, nrpp); // Index 2 adalah Kolom C (Nama)

            stats.summary.trips++;
            stats.summary.upd += upd;
            stats.summary.hours += dur;
            if (st && st !== 'TANPA ST') stats.summary.stCount.add(st);
            stats.summary.techSet.add(nrpp); 

            const wkKey = `${cust}|${loc}`;
            if (!stats.workload[wkKey]) stats.workload[wkKey] = { customer: cust, lokasi: loc, trips: 0, upd: 0, hours: 0 };
            stats.workload[wkKey].trips++;
            stats.workload[wkKey].upd += upd;
            stats.workload[wkKey].hours += dur;

            if (st && st !== 'TANPA ST') {
              if (!stats.noST[st]) {
                stats.noST[st] = { 
                  st: st, 
                  customer: cust, 
                  locations: new Set(), // [NEW]: Container lokasi unik per ST
                  techs: new Set(), 
                  trips: 0, 
                  upd: 0, 
                  hours: 0, 
                  first: wTime, 
                  last: wTime 
                };
              }
              stats.noST[st].trips++;
              stats.noST[st].upd += upd;
              stats.noST[st].hours += dur;
              stats.noST[st].techs.add(namaKaryawan);
              // [PATCH]: Masukkan Lokasi Destinasi ke dalam ST ini
              if (loc && loc !== 'UNKNOWN') stats.noST[st].locations.add(loc);
              
              if (wTime < stats.noST[st].first) stats.noST[st].first = wTime;
              if (wTime > stats.noST[st].last) stats.noST[st].last = wTime;
            }

            stats.dist.status[sot] = (stats.dist.status[sot] || 0) + 1;
            stats.dist.div[dept] = (stats.dist.div[dept] || 0) + 1;
            stats.dist.loc[loc] = (stats.dist.loc[loc] || 0) + 1;

            if (wTime > 0) {
                const tKey = Utilities.formatDate(wKeluar, "GMT+7", "yyyy-MM-dd");
                if (!stats.trend[tKey]) stats.trend[tKey] = { label: tKey, trip: 0, upd: 0 };
                stats.trend[tKey].trip++;
                stats.trend[tKey].upd += upd;
            }
          }
        });
      } catch (dbErr) { console.warn(`DB ${dbId} error:`, dbErr.message); }
    });

const finalNoST = Object.values(stats.noST).map(s => ({ 
        ...s, 
        techCount: s.techs.size, 
        techs: Array.from(s.techs).join(', '),
        lokasi: Array.from(s.locations).join(', ') || '-'
    })).sort((a,b) => b.upd - a.upd).slice(0, 50);

    return {
      status: 'success',
      data: {
        summary: { 
          trips: stats.summary.trips, 
          upd: stats.summary.upd, 
          hours: stats.summary.hours, 
          stCount: stats.summary.stCount.size, 
          techCount: stats.summary.techSet.size 
        },
        workload: Object.values(stats.workload).sort((a,b) => b.hours - a.hours).slice(0, 15),
        noST: finalNoST,
        distribution: stats.dist,
        trend: Object.values(stats.trend).sort((a,b) => a.label.localeCompare(b.label)),
        insights: _generateOperationalInsights(stats)
      }
    };
  } catch (e) { 
    return { status: 'error', message: 'Engine Error: ' + e.toString() }; 
  }
}

// ==============================================================================
// [ENGINE]: PDF EXPORT GENERATOR (DIRECT DOWNLOAD / NO DRIVE)
// ==============================================================================
function api_exportOperationalPDF(filters) {
  try {
    // [PATCH]: Proteksi mutlak agar tidak error jika dijalankan tanpa parameter
    if (!filters || typeof filters !== 'object') {
      filters = { period: 'ALL', status: 'ALL', division: 'ALL', location: 'ALL' };
    }

    const res = api_getOperationalAnalytics(filters);
    if (res.status === 'error' || !res.data) return { status: 'error', message: 'Gagal menarik agregasi data.' };
    const d = res.data;

    // Render Template HTML khusus untuk cetak Paged Media (A4 Landscape)
    const htmlOutput = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page { size: A4 landscape; margin: 15mm; background-color: #faf8f5; }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; }
          
          .header { border-bottom: 4px solid #6366f1; padding-bottom: 15px; margin-bottom: 25px; }
          .header h1 { font-size: 24pt; font-weight: 900; margin: 0; color: #0f172a; letter-spacing: -1px; }
          .header p { font-size: 10pt; color: #6366f1; font-weight: bold; margin: 5px 0 0 0; text-transform: uppercase; letter-spacing: 2px; }
          
          .filters { margin-bottom: 25px; font-size: 9pt; font-weight: bold; color: #475569; }
          .filters span { background: #fff; padding: 5px 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-right: 10px; display: inline-block; }

          table.grid { width: 100%; margin-bottom: 30px; border-collapse: separate; border-spacing: 15px 0; margin-left: -15px; }
          table.grid td { width: 25%; }
          .card { background: #fff; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; }
          .card-label { font-size: 8pt; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 5px; }
          .card-value { font-size: 16pt; font-weight: 900; color: #0f172a; }

          .section-title { font-size: 12pt; font-weight: 900; margin-bottom: 10px; color: #1e293b; border-left: 4px solid #fbbf24; padding-left: 8px; }

          table.data { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
          table.data th { background: #0f172a; color: #fff; font-size: 8pt; font-weight: bold; text-transform: uppercase; padding: 12px; text-align: left; }
          table.data td { padding: 10px 12px; font-size: 9pt; border-bottom: 1px solid #f1f5f9; }
          .highlight-st { font-weight: bold; color: #6366f1; }
          .highlight-upd { font-weight: bold; color: #059669; text-align: right; }

          .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 8pt; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="header">
          <p>Enterprise Analytics Report</p>
          <h1>Operational Intelligence</h1>
        </div>

        <div class="filters">
          <span>Periode: ${filters.period}</span>
          <span>Divisi: ${filters.division}</span>
          <span>Lokasi: ${filters.location}</span>
        </div>

        <table class="grid">
          <tr>
            <td><div class="card"><div class="card-label">Total Aktivitas</div><div class="card-value">${d.summary.trips} Trip</div></div></td>
            <td><div class="card"><div class="card-label">Biaya Lapangan</div><div class="card-value">Rp ${Number(d.summary.upd).toLocaleString('id-ID')}</div></div></td>
            <td><div class="card"><div class="card-label">Surat Tugas Aktif</div><div class="card-value">${d.summary.stCount} ST</div></div></td>
            <td><div class="card"><div class="card-label">Teknisi Terlibat</div><div class="card-value">${d.summary.techCount} Personil</div></div></td>
          </tr>
        </table>

        <div class="section-title">Analisa Detail Per No. ST</div>
        <table class="data">
          <thead>
            <tr>
              <th style="width: 15%;">No ST</th>
              <th style="width: 25%;">Customer & Lokasi</th>
              <th style="width: 30%;">Teknisi Pelaksana</th>
              <th style="width: 10%;">Durasi</th>
              <th style="width: 20%; text-align: right;">Total UPD</th>
            </tr>
          </thead>
          <tbody>
            ${d.noST.map(s => `
              <tr>
                <td class="highlight-st">${s.st}</td>
                <td><strong>${s.customer}</strong><br><span style="font-size: 7pt; color: #64748b;">${s.lokasi || '-'}</span></td>
                <td style="font-size: 8pt; color: #475569;">${s.techs}</td>
                <td>${s.hours.toFixed(1)} Jam</td>
                <td class="highlight-upd">Rp ${Number(s.upd).toLocaleString('id-ID')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          Laporan Confidential - Dihasilkan oleh Sistem Enterprise C.E.P.U pada ${Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss")}
        </div>
      </body>
      </html>
    `;

    const blob = HtmlService.createHtmlOutput(htmlOutput)
      .getAs('application/pdf')
      .setName(`Operational_Report_${new Date().getTime()}.pdf`);

    // [NEW ENGINE]: Export langsung jadi Base64 String tanpa menyentuh Google Drive!
    const base64Data = Utilities.base64Encode(blob.getBytes());
    
    return { 
        status: 'success', 
        filename: blob.getName(),
        base64: base64Data 
    };

  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function _generateOperationalInsights(s) {
  const insights = [];
  const topLoc = Object.entries(s.dist.loc).sort((a,b) => b[1] - a[1])[0];
  if (topLoc) insights.push(`${topLoc[0]} merupakan titik operasional tersibuk (${topLoc[1]} aktivitas).`);
  
  const topSt = Object.values(s.noST).sort((a,b) => b.upd - a.upd)[0];
  if (topSt) insights.push(`Surat Tugas ${topSt.st} menyerap biaya tertinggi (Rp ${topSt.upd.toLocaleString('id-ID')}).`);
  
  if (insights.length === 0) insights.push("Belum ada insight signifikan pada periode ini.");
  return insights;
}

function _generateOperationalInsights(s) {
  const insights = [];
  const topLoc = Object.entries(s.dist.loc).sort((a,b) => b[1] - a[1])[0];
  if (topLoc) insights.push(`${topLoc[0]} merupakan titik operasional tersibuk (${topLoc[1]} trip).`);
  
  const topSt = Object.values(s.noST).sort((a,b) => b.upd - a.upd)[0];
  if (topSt) insights.push(`Surat Tugas ${topSt.st} menyerap biaya tertinggi (Rp ${topSt.upd.toLocaleString('id-ID')}).`);
  
  // Mencegah error jika array kosong
  if (insights.length === 0) insights.push("Belum ada insight signifikan pada periode ini.");
  return insights;
}

function _generateOperationalInsights(s) {
  const insights = [];
  const topLoc = Object.entries(s.dist.loc).sort((a,b) => b[1] - a[1])[0];
  if (topLoc) insights.push(`${topLoc[0]} merupakan hub operasional tersibuk dengan ${topLoc[1]} aktivitas.`);
  
  const totalUpd = s.summary.upd;
  const topSt = Object.values(s.noST).sort((a,b) => b.upd - a.upd)[0];
  if (topSt) insights.push(`Surat Tugas ${topSt.st} mencatat penyerapan biaya terbesar (Rp ${topSt.upd.toLocaleString('id-ID')}).`);
  
  return insights;
}

// GANTI FUNGSI INI DI BE_Services.gs
function api_getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Master Config: Sumber kebenaran versi aplikasi & Security.
 */
function api_getSystemConfig() {
  return {
    latestVersion: 'v1.10.46',
    scriptUrl: ScriptApp.getService().getUrl(),

    // [KILL SWITCH]: NAIKKAN ANGKA INI JIKA INGIN MEMAKSA SEMUA USER LOGOUT!
    // Contoh: Jika sekarang 1, besok-besok mau paksa logout lagi, ubah jadi 2, lalu 3, dst.
    securityTick: 1,
  };
}

// ==============================================================================
// UTILITY PATCH: ENGINE SINKRONISASI HISTORI LOG KE SHEET REKAP (ONE-TIME RUN)
// Tambahkan fungsi ini di bagian paling bawah file BE_Services.js Anda.
// Anda cukup menjalankan fungsi 'utility_rebuildAllRekapSheets' 1x dari Editor GAS.
// ==============================================================================

function utility_rebuildAllRekapSheets() {
  console.log("=== MEMULAI PROSES REBUILD REKAP ABSENSI ===");
  
  // 1. Sinkronisasi Data Sales (Dari DB_SALES_ID)
  _executeSyncLogToRekap(DB_SALES_ID, 'Log_Sales', 'Rekap_Absensi_Sales', true);
  
  // 2. Sinkronisasi Data FMC (Dari DB_UPD_ID)
  _executeSyncLogToRekap(DB_UPD_ID, 'Log_FMC', 'Rekap_Absesnsi_FMC', false);
  
  // 3. Sinkronisasi Data Satelite (Dari DB_UPD_ID)
  _executeSyncLogToRekap(DB_UPD_ID, 'Log_Satelite', 'Rekap_Absesnsi_Satelite', false);
  
  console.log("=== PROSES REBUILD SELESAI UNTUK SEMUA SHEET ===");
}

/**
 * Core Engine Scanner & Injector Rekap
 */
function _executeSyncLogToRekap(sourceDbId, logSheetName, rekapSheetName, isSales) {
  try {
    const dbSource = SpreadsheetApp.openById(sourceDbId);
    const logSheet = dbSource.getSheetByName(logSheetName);
    if (!logSheet) {
      console.warn(`[SKIP] Sheet sumber ${logSheetName} tidak ditemukan di DB.`);
      return;
    }
    
    const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);
    let rekapSheet = dbRekap.getSheetByName(rekapSheetName);
    if (!rekapSheet) {
      rekapSheet = dbRekap.insertSheet(rekapSheetName);
    }
    
    const logData = logSheet.getDataRange().getValues();
    if (logData.length <= 1) {
      console.log(`[INFO] Sheet ${logSheetName} tidak memiliki data transaksi.`);
      return;
    }
    
    // Membaca Dynamic Map dari Header Log sesuai engine internal Anda
    const map = _buildDynamicMap(logData[0]);
    const idxNama = 2; // Kolom C selalu Nama di sistem Anda
    const idxWaktuKeluar = isSales ? 10 : map.WAKTU_KELUAR;
    const idxWaktuMasuk = isSales ? 12 : map.WAKTU_MASUK;
    const idxDurasi = isSales ? 14 : map.DURASI;
    const idxStatusAbsensi = isSales ? 15 : 22; // Source of Truth status (Kolom W untuk Ops)

    console.log(`Mengolah ${logData.length - 1} baris dari ${logSheetName} menuju ${rekapSheetName}...`);
    
    // Memproses data kronologis dari baris terlama ke terbaru (Maju)
    for (let i = 1; i < logData.length; i++) {
      const row = logData[i];
      const nrpp = String(row[map.NRPP] || '').trim();
      const nama = String(row[idxNama] || '').trim();
      const rawWaktuKeluar = row[idxWaktuKeluar];
      const rawWaktuMasuk = row[idxWaktuMasuk];
      const rawDurasi = parseFloat(row[idxDurasi] || 0);
      
      // Ambil status absensi, jika kosong fallback ke 'H'
      let statusAbsensi = row[idxStatusAbsensi] ? String(row[idxStatusAbsensi]).trim().toUpperCase() : 'H';
      if (statusAbsensi === 'SEDANG JALAN' || statusAbsensi === 'SELESAI') {
        statusAbsensi = 'H'; // Normalisasi jika field terisi status trip
      }

      // Validasi Tanggal Keberangkatan
      const dateKeluarObj = _safeDate(rawWaktuKeluar);
      if (dateKeluarObj.getTime() === 0) continue; // Skip jika waktu keluar rusak

      const todayStr = Utilities.formatDate(dateKeluarObj, 'Asia/Jakarta', 'dd/MM/yyyy');
      const timeInStr = Utilities.formatDate(dateKeluarObj, 'Asia/Jakarta', 'HH:mm');
      
      // Ambil jam masuk jika data checkout-nya ada
      let timeOutStr = '';
      const dateMasukObj = _safeDate(rawWaktuMasuk);
      if (dateMasukObj.getTime() > 0) {
        timeOutStr = Utilities.formatDate(dateMasukObj, 'Asia/Jakarta', 'HH:mm');
      }

      // --- AKSI INJEKSI KE SHEET REKAP ---
      const dataRekap = rekapSheet.getDataRange().getValues();
      let tRow = -1;
      let tCol = -1;

      // Cari Baris Karyawan berdasarkan NRPP
      for (let r = 1; r < dataRekap.length; r++) {
        if (dataRekap[r][0].toString() === nrpp) {
          tRow = r + 1;
          break;
        }
      }

      // Jika Karyawan Belum Ada di Rekap, Daftarkan Baru
      if (tRow === -1) {
        tRow = rekapSheet.getLastRow() + 1;
        if (tRow < 3) tRow = 3;
        rekapSheet.getRange(tRow, 1).setValue("'" + nrpp);
        rekapSheet.getRange(tRow, 2).setValue(nama);
        
        // Buat Struktur Header Jika Sheet Benar-benar Kosong Baru
        if (rekapSheet.getRange('A1').getValue() === '') {
          rekapSheet.getRange('A1:A2').merge().setValue('NRPP').setBackground('#000000').setFontColor('#FFFFFF').setHorizontalAlignment('center').setVerticalAlignment('middle').setFontWeight('bold');
          rekapSheet.getRange('B1:B2').merge().setValue('Nama').setBackground('#000000').setFontColor('#FFFFFF').setHorizontalAlignment('center').setVerticalAlignment('middle').setFontWeight('bold');
        }
      }

      // Cari Koordinat Kolom Berdasarkan Tanggal Laporan
      let headerRow = dataRekap.length > 0 ? dataRekap[0] : [];
      for (let c = 2; c < headerRow.length; c += 4) {
        let cellDateStr = headerRow[c] instanceof Date ? Utilities.formatDate(headerRow[c], 'Asia/Jakarta', 'dd/MM/yyyy') : headerRow[c].toString();
        if (cellDateStr.includes(todayStr)) {
          tCol = c + 1;
          break;
        }
      }

      // Jika Blok Kolom Tanggal Tersebut Belum Ada, Buat 4 Kolom Baru (IN, OUT, STATUS, DURASI)
      if (tCol === -1) {
        tCol = rekapSheet.getLastColumn() + 1;
        if (tCol < 3) tCol = 3;
        rekapSheet.getRange(1, tCol).setValue(todayStr);
        rekapSheet.getRange(1, tCol, 1, 4).mergeAcross().setBackground('#000000').setFontColor('#FFFFFF').setHorizontalAlignment('center').setFontWeight('bold');
        rekapSheet.getRange(2, tCol).setValue('IN');
        rekapSheet.getRange(2, tCol + 1).setValue('OUT');
        rekapSheet.getRange(2, tCol + 2).setValue('STATUS');
        rekapSheet.getRange(2, tCol + 3).setValue('DURASI');
        rekapSheet.getRange(2, tCol, 1, 4).setBackground('#000000').setFontColor('#FFFFFF').setHorizontalAlignment('center').setFontWeight('bold');
      }

      // Tulis Data Jam Keluar (IN), Jam Masuk (OUT), Status, dan Durasi Jam ke Grid Rekap
      rekapSheet.getRange(tRow, tCol).setValue(timeInStr);
      if (timeOutStr !== '') rekapSheet.getRange(tRow, tCol + 1).setValue(timeOutStr);
      rekapSheet.getRange(tRow, tCol + 2).setValue(statusAbsensi);
      if (rawDurasi > 0) rekapSheet.getRange(tRow, tCol + 3).setValue(rawDurasi.toFixed(2));
    }
    
    SpreadsheetApp.flush();
    console.log(`[SUCCESS] Rebuild ${rekapSheetName} berhasil dimigrasikan.`);
  } catch (err) {
    console.error(`[ERROR] Gagal sinkronisasi ${logSheetName}: ` + err.message);
  }
}

// ==============================================================================
// UTILITY PATCH: ENGINE AUTO-FORMATTER UNTUK SHEET REKAP (ENTERPRISE UI)
// Jalankan fungsi ini 1x untuk merapikan seluruh sheet rekap Anda.
// ==============================================================================

function utility_formatRekapSheets() {
  console.log("=== MEMULAI PROSES FORMATTING REKAP ===");
  
  const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID); 
  const sheets = dbRekap.getSheets();
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    // Hanya proses sheet yang berawalan "Rekap_"
    if(!sheetName.startsWith('Rekap_')) return;
    
    console.log("Merapikan Sheet: " + sheetName);
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    // Skip jika sheet kosong
    if (lastRow < 2 || lastCol < 2) return; 

    // Ambil seluruh area yang ada datanya
    const fullRange = sheet.getRange(1, 1, lastRow, lastCol);
    
    // 1. Standarisasi Font dan Vertical Alignment (Tengah)
    fullRange.setVerticalAlignment('middle')
             .setFontFamily('Arial')
             .setFontSize(10);
             
    // 2. Terapkan Garis Tabel (Borders) Solid Black ke Semua Sel
    fullRange.setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    
    // 3. Rapikan Kolom A & B (NRPP & NAMA) -> Rata Kiri
    if (lastRow >= 3) {
      sheet.getRange(3, 1, lastRow - 2, 2)
           .setHorizontalAlignment('left')
           .setWrap(false);
    }
         
    // 4. Rapikan Data Absensi (Kolom C sampai akhir) -> Rata Tengah & Wrap Text
    if (lastRow >= 3 && lastCol >= 3) {
       sheet.getRange(3, 3, lastRow - 2, lastCol - 2)
            .setHorizontalAlignment('center')
            .setWrap(true); // Memastikan status panjang (misal: H (NON PROJECT)) tidak menabrak sel sebelah
    }
    
    // 5. Pertegas Tampilan Header (Baris 1 & 2) -> Hitam & Putih
    const headerRange = sheet.getRange(1, 1, 2, lastCol);
    headerRange.setBackground('#000000')
               .setFontColor('#FFFFFF')
               .setFontWeight('bold')
               .setHorizontalAlignment('center')
               .setVerticalAlignment('middle');
               
    // 6. Auto-Resize Kolom (Menyesuaikan lebar sel dengan isi teks)
    for (let i = 1; i <= lastCol; i++) {
      sheet.autoResizeColumn(i);
      
      // Berikan sedikit ruang ekstra (padding) agar tidak terlalu mepet
      const currentWidth = sheet.getColumnWidth(i);
      sheet.setColumnWidth(i, currentWidth + 15);
    }
  });
  
  console.log("=== PROSES FORMATTING SELESAI ===");
}

// ==============================================================================
// UTILITY PATCH: ENGINE REPARASI DATA HISTORIS LINTAS HARI (ONE-TIME REPAIR)
// Jalankan fungsi 'utility_repairExistingCrossDayLogs' 1x dari Editor GAS.
// Fungsi ini memanfaatkan internal helper 'updateRekapSweeper' bawaan Anda.
// ==============================================================================

function utility_repairExistingCrossDayLogs() {
  console.log("=== MEMULAI PROSES REPARASI DATA HISTORIS LINTAS HARI ===");
  const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);
  let totalOpsRepaired = 0;
  let totalSalesRepaired = 0;

  // 1. Scan & Perbaiki Data Operasional (DB_UPD_ID)
  const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
  dbUpd.getSheets().forEach(sheet => {
    const sheetName = sheet.getName();
    if (!sheetName.startsWith('Log_')) return;
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    
    const map = _buildDynamicMap(data[0]);
    const idxWaktuKeluar = map.WAKTU_KELUAR !== undefined ? map.WAKTU_KELUAR : 11;
    const idxWaktuMasuk = map.WAKTU_MASUK !== undefined ? map.WAKTU_MASUK : 13;
    
    for (let i = 1; i < data.length; i++) {
      const wKeluar = _safeDate(data[i][idxWaktuKeluar]);
      const wMasuk = _safeDate(data[i][idxWaktuMasuk]);
      
      // Pastikan kedua waktu terisi (sudah checkout)
      if (wKeluar.getTime() > 0 && wMasuk.getTime() > 0) {
        const dKeluarStr = Utilities.formatDate(wKeluar, 'Asia/Jakarta', 'yyyy/MM/dd');
        const dMasukStr = Utilities.formatDate(wMasuk, 'Asia/Jakarta', 'yyyy/MM/dd');
        
        // Deteksi Celah Cross-Day (Beda Hari)
        if (dKeluarStr !== dMasukStr) {
          // Idempotent Check: Pastikan belum pernah disapu/diperbaiki sebelumnya
          if (data[i][14] !== 'SYSTEM_AUTO_SWEEP') { 
            console.log(`[REPAIR OPS] Menindak data lintas hari NRPP: ${data[i][1]} pada Sheet: ${sheetName}`);
            
            let forcedTimeStr = dKeluarStr + ' 23:59:00';
            
            // Inject state Sweeper sesuai arsitektur kolom DB_UPD Anda (Kolom N sampai S)
            sheet.getRange(i + 1, 14).setValue(forcedTimeStr);       // Waktu Masuk (Index 13)
            sheet.getRange(i + 1, 15).setValue('SYSTEM_AUTO_SWEEP'); // Kordinat (Index 14)
            sheet.getRange(i + 1, 16).setValue(0);                   // Durasi Jam = 0 (Index 15)
            sheet.getRange(i + 1, 17).setValue(0);                   // Nominal UPD = 0 (Index 16)
            sheet.getRange(i + 1, 18).setValue('SELESAI');           // Status Jalan = SELESAI (Index 17)
            sheet.getRange(i + 1, 19).setValue('PENDING');           // Status Klaim = PENDING / Red Flag (Index 18)
            
            // Sinkronisasikan langsung perbaikan ke Sheet Rekap Absensi terkait
            updateRekapSweeper(dbRekap, data[i][1], wKeluar, sheetName.replace('Log_', ''));
            totalOpsRepaired++;
          }
        }
      }
    }
  });

  // 2. Scan & Perbaiki Data Sales (DB_SALES_ID)
  const dbSales = SpreadsheetApp.openById(DB_SALES_ID);
  dbSales.getSheets().forEach(sheet => {
    const sheetName = sheet.getName();
    if (!sheetName.startsWith('Log_')) return;
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    
    for (let i = 1; i < data.length; i++) {
      const wKeluar = _safeDate(data[i][10]); // Kolom K (Waktu Keluar Sales)
      const wMasuk = _safeDate(data[i][12]);  // Kolom M (Waktu Masuk Sales)
      
      if (wKeluar.getTime() > 0 && wMasuk.getTime() > 0) {
        const dKeluarStr = Utilities.formatDate(wKeluar, 'Asia/Jakarta', 'yyyy/MM/dd');
        const dMasukStr = Utilities.formatDate(wMasuk, 'Asia/Jakarta', 'yyyy/MM/dd');
        
        if (dKeluarStr !== dMasukStr) {
          if (data[i][13] !== 'SYSTEM_AUTO_SWEEP') {
            console.log(`[REPAIR SALES] Menindak data lintas hari NRPP: ${data[i][1]}`);
            
            let forcedTimeStr = dKeluarStr + ' 23:59:00';
            
            // Inject state Sweeper sesuai arsitektur kolom DB_SALES Anda (Kolom M sampai P)
            sheet.getRange(i + 1, 13).setValue(forcedTimeStr);       // Waktu Masuk (Index 12)
            sheet.getRange(i + 1, 14).setValue('SYSTEM_AUTO_SWEEP'); // Kordinat (Index 13)
            sheet.getRange(i + 1, 15).setValue(0);                   // Durasi = 0 (Index 14)
            sheet.getRange(i + 1, 16).setValue('SELESAI');           // Status = SELESAI (Index 15)
            
            updateRekapSweeper(dbRekap, data[i][1], wKeluar, 'Sales');
            totalSalesRepaired++;
          }
        }
      }
    }
  });
  
  SpreadsheetApp.flush(); // Commit mutasi I/O secara atomik
  console.log(`=== REPARASI SELESAI. Total Diperbaiki -> OPS: ${totalOpsRepaired} baris, SALES: ${totalSalesRepaired} baris ===`);
}

// ==============================================================================
// UTILITY PATCH: ENGINE REPARASI FORMAT DURASI HISTORIS (DESIMAL -> HH.MM)
// Mengubah sisa data lama yang masih format desimal murni (misal: 9.88)
// menjadi format jam.menit mutlak sesuai standar Enterprise (misal: 9.53).
// ==============================================================================

function utility_repairDurationFormat() {
  console.log("=== MEMULAI REPARASI FORMAT DURASI (DESIMAL -> HH.MM) ===");
  const dbs = [DB_UPD_ID, DB_SALES_ID];
  let repairedCount = 0;

  dbs.forEach(dbId => {
    try {
      const db = SpreadsheetApp.openById(dbId);
      const isSales = (dbId === DB_SALES_ID);
      
      db.getSheets().forEach(sheet => {
        if (!sheet.getName().startsWith('Log_')) return;
        
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return;
        
        const map = _buildDynamicMap(data[0]);
        // Cari posisi kolom dengan akurat
        const idxKeluar = isSales ? 10 : (map.WAKTU_KELUAR !== undefined ? map.WAKTU_KELUAR : 11);
        const idxMasuk = isSales ? 12 : (map.WAKTU_MASUK !== undefined ? map.WAKTU_MASUK : 13);
        const idxDurasi = isSales ? 14 : (map.DURASI !== undefined ? map.DURASI : 15);
        
        for (let i = 1; i < data.length; i++) {
          const rawDurasi = parseFloat(data[i][idxDurasi]);
          
          if (isNaN(rawDurasi)) continue;

          // Deteksi jika angka di belakang koma melebihi batas menit (>= 0.60)
          const desimal = rawDurasi - Math.floor(rawDurasi);
          
          // Jangan proses durasi 0 hasil dari Auto-Sweeper
          if (desimal >= 0.60 && data[i][idxMasuk] !== 'SYSTEM_AUTO_SWEEP') {
            const wKeluar = _safeDate(data[i][idxKeluar]);
            const wMasuk = _safeDate(data[i][idxMasuk]);
            
            // Jika ada waktu masuk dan keluar yang valid, hitung ulang!
            if (wKeluar.getTime() > 0 && wMasuk.getTime() > 0) {
              const diffMs = wMasuk.getTime() - wKeluar.getTime();
              const tHours = Math.floor(diffMs / (1000 * 60 * 60));
              const tMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
              
              // Rumus Enterprise Mutlak: HH + (MM/100)
              const durasiBaru = tHours + (tMins / 100);
              
              // Tulis ulang ke spreadsheet (Kolom adalah Index + 1)
              sheet.getRange(i + 1, idxDurasi + 1).setValue(durasiBaru.toFixed(2));
              repairedCount++;
            }
          }
        }
      });
    } catch (e) {
      console.error("Gagal membaca DB: " + e.message);
    }
  });
  
  SpreadsheetApp.flush();
  console.log(`=== REPARASI SELESAI: ${repairedCount} data durasi anomali berhasil dinormalisasi ===`);
}
