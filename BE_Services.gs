// ==============================================================================
// FILE: BE_Services.gs
// TIPE: SERVER-SIDE SCRIPT
// DESKRIPSI: API Endpoints (Routing, Login, Berangkat, dan Absen Pulang)
// UPDATE: Dynamic Status Absensi & Lookup Master_Status_Absensi
// ==============================================================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('UI_Base')
    .evaluate()
    .setTitle('C.E.P.U - Enterprise Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --- MODUL LOOKUP DATA MASTER ---

function api_getInitFormData(user) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetStatus = dbMaster.getSheetByName("Master_Status_Absensi");
    const dataStatus = sheetStatus.getDataRange().getValues();
    
    let options = [];
    let userLokasi = user.lokasi ? user.lokasi.toString().toUpperCase().trim() : "";
    let userJabatan = user.jabatan ? user.jabatan.toString().toUpperCase().trim() : "";

    for (let i = 1; i < dataStatus.length; i++) {
      let filterArea = dataStatus[i][2] ? dataStatus[i][2].toString().toUpperCase() : "";
      if (filterArea.includes(userLokasi) || filterArea.includes(userJabatan)) {
        options.push({ code: dataStatus[i][0], desc: dataStatus[i][1] });
      }
    }

    // [UPDATE FIX]: Smart Routing DB Sales vs UPD untuk History & Active Trip
    const isSales = (userLokasi === "SALES" || userJabatan === "SALES");
    const dbApp = isSales ? SpreadsheetApp.openById(DB_SALES_ID) : SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = isSales ? "Log_Sales" : "Log_" + user.lokasi.trim();
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
          if (!activeTrip && statusPerjalanan === "SEDANG JALAN") {
              let rawTime = dataLog[i][isSales ? 10 : 11];
              let waktuFormat = (rawTime instanceof Date) ? Utilities.formatDate(rawTime, "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss") : rawTime.toString();
              
              activeTrip = {
                  idTransaksi: dataLog[i][0].toString(),
                  waktuKeluar: waktuFormat,
                  lokasi: dataLog[i][isSales ? 9 : 10].toString(),
                  customer: dataLog[i][isSales ? 8 : 9].toString(),
                  statusAbsensi: "SEDANG JALAN" 
              };
          }

          let noSTRaw = isSales ? "" : dataLog[i][8];
          let noST = noSTRaw ? String(noSTRaw).replace(/^'/, '').trim() : ""; 
          
          if (noST !== "" && !stSet.has(noST)) {
            stSet.add(noST);
            history.push({
              noST: noST,
              customer: dataLog[i][isSales ? 8 : 9] ? dataLog[i][isSales ? 8 : 9].toString() : "", 
              lokasi: dataLog[i][isSales ? 9 : 10] ? dataLog[i][isSales ? 9 : 10].toString() : ""   
            });
          }
        }
      }
    }

    return { status: "success", data: { statusOptions: options, historyST: history, activeTrip: activeTrip } };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

// --- CARI DAN GANTI FUNGSI INI DI BE_Services.gs ---

function api_verifyLogin(nrpp, password, deviceId) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetLogin = dbMaster.getSheetByName("Master_Login");
    const dataLogin = sheetLogin.getDataRange().getValues();
    const headers = dataLogin[0].map(h => h.toString().toUpperCase().trim());

    const idx = {
      nrpp: headers.indexOf("NRPP"),
      pass: headers.indexOf("PASSWORD"),
      devId: headers.indexOf("DEVICE_ID"),
      name: headers.indexOf("NAMA"),
      lastLogin: headers.indexOf("LAST_LOGIN")
    };

    if (idx.nrpp === -1 || idx.pass === -1) throw new Error("Struktur kolom Master_Login rusak!");

    let userFound = false;
    let userData = null;

    for (let i = 1; i < dataLogin.length; i++) {
      let row = dataLogin[i];
      if (row[idx.nrpp].toString() === nrpp.toString() && row[idx.pass].toString() === password.toString()) {
        
        let registeredDeviceId = row[idx.devId] ? row[idx.devId].toString() : "";
        let rowIndex = i + 1;

        if (registeredDeviceId === "") {
          sheetLogin.getRange(rowIndex, idx.devId + 1).setValue(deviceId);
        } else if (registeredDeviceId !== deviceId.toString()) {
          return { status: "error", message: "⛔ SECURITY LOCK: NRPP ini terikat pada perangkat lain!" };
        }

        userFound = true;
        sheetLogin.getRange(rowIndex, idx.lastLogin + 1).setValue(new Date());

        const sheetKaryawan = dbMaster.getSheetByName("Master_Karyawan");
        const dataKar = sheetKaryawan.getDataRange().getValues();
        const headKar = dataKar[0].map(h => h.toString().toUpperCase().trim());
        
        const iK = {
          nrpp: headKar.indexOf("NRPP"),
          jabatan: headKar.indexOf("JABATAN"),
          gol: headKar.indexOf("GOLONGAN"),
          status: headKar.indexOf("STATUS_KARYAWAN"),
          dept: headKar.indexOf("DEPARTEMEN"),
          loc: headKar.indexOf("LOKASI")
        };

        let details = dataKar.find(r => r[iK.nrpp].toString() === nrpp.toString());
        
        userData = {
          nrpp: nrpp,
          nama: row[idx.name],
          jabatan: details ? details[iK.jabatan] : "User",
          golongan: details ? details[iK.gol] : "-",
          statusKaryawan: details ? details[iK.status] : "-",
          departemen: details ? details[iK.dept] : "-",
          lokasi: details ? details[iK.loc] : "OFFICE"
        };

        // [KILLER FEATURE]: Pengecekan Hak Akses UPD secara otomatis
        const sheetUPD = dbMaster.getSheetByName("Master_UPD");
        if (sheetUPD) {
            const dataUPD = sheetUPD.getDataRange().getValues();
            let headUPD = dataUPD[0].map(h => h.toString().toUpperCase().trim());
            let idxJabUPD = headUPD.indexOf("JABATAN");
            if(idxJabUPD !== -1) {
                userData.isUpdEligible = dataUPD.some(r => r[idxJabUPD].toString().trim().toUpperCase() === userData.jabatan.toString().trim().toUpperCase());
            } else {
                userData.isUpdEligible = false;
            }
        }
        break;
      }
    }

    if (!userFound) return { status: "error", message: "NRPP atau Password salah!" };
    return { status: "success", data: userData };

  } catch (error) {
    return { status: "error", message: "System Error: " + error.toString() };
  }
}

// --- CARI DAN GANTI FUNGSI INI DI BE_Services.gs ---

function api_submitPerjalananDinas(payload, user) {
  try {
    if (!user.lokasi) throw new Error("Data Lokasi Karyawan kosong di Master Database!");
    const userLokasiUpper = user.lokasi.toString().trim().toUpperCase();
    const isSales = (userLokasiUpper === "SALES" || user.jabatan.toString().trim().toUpperCase() === "SALES");
    
    const dbApp = isSales ? SpreadsheetApp.openById(DB_SALES_ID) : SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = isSales ? "Log_Sales" : "Log_" + user.lokasi.trim(); 
    
    let sheet = dbApp.getSheetByName(targetSheetName);
    if (!sheet) throw new Error("Sheet database tujuan ('" + targetSheetName + "') tidak ditemukan di database!");
    
    const timestamp = new Date();
    const timeToSave = Utilities.formatDate(timestamp, "Asia/Jakarta", "yyyy/MM/dd HH:mm:ss");
    
    const d_wib = Utilities.formatDate(timestamp, "Asia/Jakarta", "dd");
    const m_wib = Utilities.formatDate(timestamp, "Asia/Jakarta", "MM");
    const y_wib = Utilities.formatDate(timestamp, "Asia/Jakarta", "yyyy");

    // ==========================================================
    // PROTOKOL ODOC (One-Day-One-Checkin) - DYNAMIC COLUMN VALIDATOR
    // ==========================================================
    if (user.jabatan !== "Super Admin" && user.jabatan !== "Administrator") {
        const dataLog = sheet.getDataRange().getValues();
        
        let nrppIndex = 1;
        let waktuKeluarIndex = isSales ? 10 : 11; // Default Index
        
        if (dataLog.length > 0) {
            let header = dataLog[0];
            for(let c = 0; c < header.length; c++) {
                let colName = header[c].toString().toUpperCase().trim();
                if(colName === "NRPP") nrppIndex = c;
                // [UPDATE]: Mencari Index Kolom Waktu Keluar secara dinamis
                if(colName === "WAKTU_KELUAR" || colName === "WAKTU KELUAR") waktuKeluarIndex = c;
            }
        }

        for (let i = 1; i < dataLog.length; i++) {
            let dbNRPP = String(dataLog[i][nrppIndex]).trim().toUpperCase();
            let reqNRPP = String(user.nrpp).trim().toUpperCase();
            
            let isUserMatch = (dbNRPP === reqNRPP);
            if (!isUserMatch && dbNRPP !== "" && reqNRPP !== "" && !isNaN(dbNRPP) && !isNaN(reqNRPP)) {
                isUserMatch = (Number(dbNRPP) === Number(reqNRPP));
            }
            
            if (isUserMatch) {
                let isAlreadyClockedIn = false;
                // [KUNCI ABSOLUT]: Ekstrak Waktu Langsung dari Kolom Visual (Agar bisa dites Admin)
                let rawTime = dataLog[i][waktuKeluarIndex];
                
                if (rawTime) {
                    let logDate = (rawTime instanceof Date) ? rawTime : new Date(rawTime.toString() + " +0700");
                    
                    if (!isNaN(logDate.getTime()) && logDate.getFullYear() > 2000) {
                        let r_y = Utilities.formatDate(logDate, "Asia/Jakarta", "yyyy");
                        let r_m = Utilities.formatDate(logDate, "Asia/Jakarta", "MM");
                        let r_d = Utilities.formatDate(logDate, "Asia/Jakarta", "dd");
                        
                        // Jika ada data dengan tanggal yang sama seperti hari ini, BLOKIR.
                        if (r_y === y_wib && r_m === m_wib && r_d === d_wib) {
                            isAlreadyClockedIn = true;
                        }
                    } else if (typeof rawTime === "string" || typeof rawTime === "number") {
                        // Fallback Plan: String Scanner
                        let timeStr = String(rawTime);
                        let d_nz = parseInt(d_wib, 10).toString();
                        let m_nz = parseInt(m_wib, 10).toString();
                        const checkFormats = [
                            `${y_wib}/${m_wib}/${d_wib}`, `${d_wib}/${m_wib}/${y_wib}`,
                            `${y_wib}-${m_wib}-${d_wib}`, `${d_wib}-${m_wib}-${y_wib}`,
                            `${d_nz}/${m_nz}/${y_wib}`, `${m_nz}/${d_nz}/${y_wib}`, `${y_wib}/${m_nz}/${d_nz}`
                        ];
                        if (checkFormats.some(fmt => timeStr.includes(fmt))) {
                            isAlreadyClockedIn = true;
                        }
                    }
                }

                if (isAlreadyClockedIn) {
                    return { status: "error", message: "⛔ FRAUD ALERT: Anda sudah melakukan absensi keberangkatan hari ini. (Limit 1x/Hari)" };
                }
            }
        }
    }
    // ==========================================================

    const idTransaksi = "TRX-" + timestamp.getTime();
    const statusAbsensi = payload.statusAbsensi || "H";

    let rowData = [];
    if (isSales) {
        rowData = [
          idTransaksi, user.nrpp, user.nama, user.jabatan, user.golongan, user.statusKaryawan, user.departemen, user.lokasi,
          payload.customer, payload.lokasi, timeToSave, payload.kordinat, "", "", "", "SEDANG JALAN"
        ];
    } else {
        rowData = [
          idTransaksi, user.nrpp, user.nama, user.jabatan, user.golongan, user.statusKaryawan, user.departemen, user.lokasi, 
          ("'" + payload.noST), payload.customer, payload.lokasi, timeToSave, payload.kordinat, "", "", "", "", "SEDANG JALAN", "BELUM KLAIM", ""
        ];
    }
    
    sheet.appendRow(rowData);

    // [AUTO-GRID DB_REKAP]
    try {
      const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);
      let rekapSheetName = "";
      if (isSales) rekapSheetName = "Rekap_Absensi_Sales";
      else if (userLokasiUpper === "FMC") rekapSheetName = "Rekap_Absesnsi_FMC";
      else if (userLokasiUpper === "SATELITE") rekapSheetName = "Rekap_Absesnsi_Satelite";
      else rekapSheetName = "Rekap_Absensi_" + user.lokasi.trim();

      const rekapSheet = dbRekap.getSheetByName(rekapSheetName);
      if (rekapSheet) {
        const todayStr = Utilities.formatDate(timestamp, "Asia/Jakarta", "dd/MM/yyyy");
        const timeStr = Utilities.formatDate(timestamp, "Asia/Jakarta", "HH:mm");
        const dataRekap = rekapSheet.getDataRange().getValues();
        let targetRow = -1; let targetCol = -1;
        
        for (let r = 1; r < dataRekap.length; r++) {
          if (dataRekap[r][0].toString() === user.nrpp.toString()) { targetRow = r + 1; break; }
        }
        
        if (targetRow === -1) {
          targetRow = rekapSheet.getLastRow() + 1;
          if (targetRow < 3) targetRow = 3; 
          rekapSheet.getRange(targetRow, 1).setValue(user.nrpp);
          rekapSheet.getRange(targetRow, 2).setValue(user.nama);
          if (rekapSheet.getRange("A1").getValue() === "") {
             rekapSheet.getRange("A1:A2").merge().setValue("NRPP").setBackground("#000000").setFontColor("#FFFFFF").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontWeight("bold");
             rekapSheet.getRange("B1:B2").merge().setValue("Nama").setBackground("#000000").setFontColor("#FFFFFF").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontWeight("bold");
          }
        }

        let headerRow = dataRekap.length > 0 ? dataRekap[0] : [];
        for (let c = 2; c < headerRow.length; c += 4) {
          let cellDateStr = (headerRow[c] instanceof Date) ? Utilities.formatDate(headerRow[c], "Asia/Jakarta", "dd/MM/yyyy") : headerRow[c].toString();
          if (cellDateStr.includes(todayStr)) { targetCol = c + 1; break; }
        }

        if (targetCol === -1) {
          targetCol = rekapSheet.getLastColumn() + 1;
          if (targetCol < 3) targetCol = 3;
          rekapSheet.getRange(1, targetCol).setValue(todayStr);
          rekapSheet.getRange(1, targetCol, 1, 4).mergeAcross().setBackground("#000000").setFontColor("#FFFFFF").setHorizontalAlignment("center").setFontWeight("bold");
          rekapSheet.getRange(2, targetCol).setValue("IN");
          rekapSheet.getRange(2, targetCol + 1).setValue("OUT");
          rekapSheet.getRange(2, targetCol + 2).setValue("STATUS");
          rekapSheet.getRange(2, targetCol + 3).setValue("DURASI");
          rekapSheet.getRange(2, targetCol, 1, 4).setBackground("#000000").setFontColor("#FFFFFF").setHorizontalAlignment("center").setFontWeight("bold");
        }

        rekapSheet.getRange(targetRow, targetCol).setValue(timeStr); 
        rekapSheet.getRange(targetRow, targetCol + 2).setValue(statusAbsensi);
      }
    } catch(e) { console.error("Error DB_REKAP IN: " + e.message); }

    return {
      status: "success",
      message: "Keberangkatan Berhasil. Status: " + statusAbsensi,
      data: { idTransaksi: idTransaksi, waktuKeluar: timestamp.toLocaleString('id-ID'), lokasi: payload.lokasi, customer: payload.customer, statusAbsensi: statusAbsensi }
    };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

function api_submitPulangDinas(payload, user) {
  try {
    if (!user.lokasi) throw new Error("Data Lokasi Karyawan kosong!");
    const userLokasiUpper = user.lokasi.toString().trim().toUpperCase();
    const isSales = (userLokasiUpper === "SALES" || user.jabatan.toString().trim().toUpperCase() === "SALES");
    
    const dbApp = isSales ? SpreadsheetApp.openById(DB_SALES_ID) : SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = isSales ? "Log_Sales" : "Log_" + user.lokasi.trim(); 
    
    const sheet = dbApp.getSheetByName(targetSheetName);
    if (!sheet) throw new Error("Sheet tujuan tidak ditemukan.");

    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    let waktuKeluar = null;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === payload.idTransaksi) {
        targetRow = i + 1;
        let rawKeluar = data[i][isSales ? 10 : 11]; 
        
        // [UPDATE BUG FIX] Memaksa JavaScript membaca String sebagai Zona Waktu Jakarta (+0700)
        waktuKeluar = (rawKeluar instanceof Date) ? rawKeluar : new Date(rawKeluar.toString() + " +0700");
        
        // [KILLER BUG FIX]: Koreksi jika Admin edit jam manual di G-Sheets (Tahun menjadi 1899)
        if (waktuKeluar.getFullYear() < 2000) {
            const today = new Date();
            waktuKeluar.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
        }
        
        break;
      }
    }

    if (targetRow === -1) throw new Error("ID Transaksi tidak ditemukan.");

    const waktuMasuk = new Date();
    const timeMasukToSave = Utilities.formatDate(waktuMasuk, "Asia/Jakarta", "yyyy/MM/dd HH:mm:ss");
    
    const diffMs = waktuMasuk - waktuKeluar;
    const durasiJam = diffMs / (1000 * 60 * 60);

    let nominalUPD = 0;

    if (!isSales) {
        const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
        const masterUPD = dbMaster.getSheetByName("Master_UPD").getDataRange().getValues();
        let baseUPD = 0, uangMakan = 0, mknSiangLibur = 0, lainKerja = 0, lainLibur = 0;
        
        let keyJabatan = user.jabatan ? user.jabatan.toString().trim().toUpperCase() : "";
        let keyGolongan = user.golongan ? user.golongan.toString().trim().toUpperCase() : "";

        for (let i = 1; i < masterUPD.length; i++) {
          let dbJabatan = masterUPD[i][0] ? masterUPD[i][0].toString().trim().toUpperCase() : "";
          let dbGolongan = masterUPD[i][1] ? masterUPD[i][1].toString().trim().toUpperCase() : "";

          if (dbJabatan === keyJabatan && dbGolongan === keyGolongan) {
            baseUPD = (durasiJam >= 8) ? parseFloat(masterUPD[i][2] || 0) : parseFloat(masterUPD[i][3] || 0);
            uangMakan = parseFloat(masterUPD[i][4] || 0);
            mknSiangLibur = parseFloat(masterUPD[i][5] || 0);
            lainKerja = parseFloat(masterUPD[i][6] || 0);
            lainLibur = parseFloat(masterUPD[i][7] || 0);
            break;
          }
        }

        const isWeekend = (waktuMasuk.getDay() === 0 || waktuMasuk.getDay() === 6);
        if (isWeekend) nominalUPD = baseUPD + mknSiangLibur + uangMakan + lainLibur;
        else nominalUPD = baseUPD + uangMakan + lainKerja;

        sheet.getRange(targetRow, 14).setValue(timeMasukToSave);
        sheet.getRange(targetRow, 15).setValue(payload.kordinatMasuk);
        sheet.getRange(targetRow, 16).setValue(durasiJam.toFixed(2));
        sheet.getRange(targetRow, 17).setValue(nominalUPD);
        sheet.getRange(targetRow, 18).setValue("SELESAI");
    } else {
        sheet.getRange(targetRow, 13).setValue(timeMasukToSave);
        sheet.getRange(targetRow, 14).setValue(payload.kordinatMasuk);
        sheet.getRange(targetRow, 15).setValue(durasiJam.toFixed(2));
        sheet.getRange(targetRow, 16).setValue("SELESAI");
    }

    // [AUTO-GRID DB_REKAP]
    try {
      const dbRekap = SpreadsheetApp.openById(DB_REKAP_ID);
      let rekapSheetName = "";
      if (isSales) rekapSheetName = "Rekap_Absensi_Sales";
      else if (userLokasiUpper === "FMC") rekapSheetName = "Rekap_Absesnsi_FMC";
      else if (userLokasiUpper === "SATELITE") rekapSheetName = "Rekap_Absesnsi_Satelite";
      else rekapSheetName = "Rekap_Absensi_" + user.lokasi.trim();

      const rekapSheet = dbRekap.getSheetByName(rekapSheetName);
      if (rekapSheet) {
        const todayStr = Utilities.formatDate(waktuMasuk, "Asia/Jakarta", "dd/MM/yyyy");
        const timeStr = Utilities.formatDate(waktuMasuk, "Asia/Jakarta", "HH:mm");
        const dataRekap = rekapSheet.getDataRange().getValues();
        let tRow = -1; let tCol = -1;
        
        for (let r = 1; r < dataRekap.length; r++) {
          if (dataRekap[r][0].toString() === user.nrpp.toString()) { tRow = r + 1; break; }
        }

        let headerRow = dataRekap.length > 0 ? dataRekap[0] : [];
        for (let c = 2; c < headerRow.length; c += 4) {
          let cellDateStr = (headerRow[c] instanceof Date) ? Utilities.formatDate(headerRow[c], "Asia/Jakarta", "dd/MM/yyyy") : headerRow[c].toString();
          if (cellDateStr.includes(todayStr)) { tCol = c + 1; break; }
        }

        if (tRow !== -1 && tCol !== -1) {
          rekapSheet.getRange(tRow, tCol + 1).setValue(timeStr);
          rekapSheet.getRange(tRow, tCol + 3).setValue(durasiJam.toFixed(2)); 
        }
      }
    } catch(e) { console.error("Error DB_REKAP OUT: " + e.message); }

    return { 
        status: "success", 
        message: "Selesai!", 
        data: { durasi: durasiJam.toFixed(2), nominal: nominalUPD } 
    };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

// ==========================================================
// MODUL SUPER ADMIN: UNIVERSAL CRUD MASTER DATA
// ==========================================================


function api_adminGetMaster(sheetName) {
  try {
    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheet = db.getSheetByName(sheetName);
    if (!sheet) throw new Error("Tabel Master '" + sheetName + "' tidak ditemukan!");

    const data = sheet.getDataRange().getValues();
    if (data.length === 0) return { status: "success", data: { headers: [], rows: [] } };

    // [KILLER BUG FIX]: Memaksa seluruh elemen sel menjadi teks untuk mencegah JSON Serialization Crash dari google.script.run
    const headers = data[0].map(h => String(h).trim());
    const rows = data.slice(1).map(row => {
        return row.map(cell => {
            if (cell instanceof Date) return Utilities.formatDate(cell, "Asia/Jakarta", "yyyy/MM/dd HH:mm:ss");
            if (cell === null || cell === undefined) return "";
            return String(cell); 
        });
    });

    return {
      status: "success",
      data: { headers: headers, rows: rows } 
    };
  } catch(e) { 
    return { status: "error", message: e.toString() }; 
  }
}

function api_adminMutateMaster(action, sheetName, payload, rowIndex) {
  try {
    // [DEBUG LOGGING]
    console.log("=== API MUTATE EXECUTED ===");
    console.log("Action:", action);
    console.log("Sheet:", sheetName);
    console.log("Payload:", payload);
    console.log("RowIndex:", rowIndex);

    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheet = db.getSheetByName(sheetName);
    if (!sheet) throw new Error("Tabel Master '" + sheetName + "' tidak ditemukan!");

    if (action === "CREATE") {
      sheet.appendRow(payload);
      
      // Protokol Auto-Login
      if (sheetName === "Master_Karyawan") {
          const loginSheet = db.getSheetByName("Master_Login");
          if (loginSheet) {
              loginSheet.appendRow([payload[0], payload[1], payload[0], "", ""]);
              console.log("Auto-Login Created for NRPP:", payload[0]);
          } else {
              console.warn("Sheet Master_Login tidak ditemukan untuk Auto-Login!");
          }
      }

      return { status: "success", message: "Entitas baru berhasil direkam ke " + sheetName };
    } 
    else if (action === "UPDATE") {
      const targetRow = parseInt(rowIndex) + 2; 
      if(isNaN(targetRow)) throw new Error("Target baris tidak valid!");
      
      sheet.getRange(targetRow, 1, 1, payload.length).setValues([payload]);
      return { status: "success", message: "Entitas pada baris " + targetRow + " berhasil diperbarui!" };
    } 
    else if (action === "DELETE") {
      const targetRow = parseInt(rowIndex) + 2;
      if(isNaN(targetRow)) throw new Error("Target baris tidak valid!");
      
      sheet.deleteRow(targetRow);
      return { status: "success", message: "Entitas berhasil dimusnahkan." };
    } 
    else {
      throw new Error("Protokol Mutasi (CRUD) tidak dikenali: " + action);
    }
  } catch(e) { 
    console.error("Backend Error:", e.toString());
    return { status: "error", message: e.toString() }; 
  }
}

// ==========================================================
// MODUL SUPER ADMIN: SMART HRIS & LIVE TRACKING
// ==========================================================

function api_adminGetKaryawanDetails() {
  try {
    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const karSheet = db.getSheetByName("Master_Karyawan");
    const logSheet = db.getSheetByName("Master_Login");
    
    const karData = karSheet.getDataRange().getValues();
    const logData = logSheet.getDataRange().getValues();

    // Pemetaan data Login untuk digabungkan dengan Master_Karyawan (Relational Mapping)
    let logMap = {};
    for(let i = 1; i < logData.length; i++) {
        logMap[logData[i][0].toString()] = {
            deviceId: logData[i][3] ? logData[i][3].toString() : "",
            lastLogin: logData[i][4] instanceof Date ? Utilities.formatDate(logData[i][4], "Asia/Jakarta", "dd/MM/yyyy HH:mm") : logData[i][4].toString()
        };
    }

    let results = [];
    for(let i = 1; i < karData.length; i++) {
        let nrpp = karData[i][0].toString();
        if(!nrpp) continue;
        results.push({
            nrpp: nrpp, nama: karData[i][1], jabatan: karData[i][2],
            golongan: karData[i][3], departemen: karData[i][5], lokasi: karData[i][6],
            deviceId: logMap[nrpp] ? logMap[nrpp].deviceId : "",
            lastLogin: logMap[nrpp] ? logMap[nrpp].lastLogin : "Belum Pernah Login"
        });
    }
    return { status: "success", data: results };
  } catch(e) { return { status: "error", message: e.toString() }; }
}

function api_adminResetDevice(nrpp) {
  try {
    const db = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheet = db.getSheetByName("Master_Login");
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === nrpp.toString()) {
            sheet.getRange(i + 1, 4).setValue(""); // Kolom ke-4 adalah Device_ID
            return { status: "success", message: "Security Lock untuk NRPP " + nrpp + " berhasil dihancurkan!" };
        }
    }
    throw new Error("Data Kredensial tidak ditemukan!");
  } catch(e) { return { status: "error", message: e.toString() }; }
}

function api_adminGetLiveLogs() {
  try {
    const timestamp = new Date();
    const todayWIB = Utilities.formatDate(timestamp, "Asia/Jakarta", "yyyy/MM/dd");
    let liveData = [];

    // Fungsi Scraper Internal untuk mengekstrak multi-sheet
    function extractLogs(dbId, isSales) {
      const db = SpreadsheetApp.openById(dbId);
      const sheets = db.getSheets();
      
      sheets.forEach(sheet => {
        const sheetName = sheet.getName();
        if(!sheetName.startsWith("Log_")) return; 
        
        const data = sheet.getDataRange().getValues();
        if(data.length > 1) {
          let timeIndex = isSales ? 10 : 11;
          for(let i = data.length - 1; i >= 1; i--) { 
            let wKeluar = data[i][timeIndex];
            if (!wKeluar) continue;
            
            let wKeluarDate = (wKeluar instanceof Date) ? wKeluar : new Date(wKeluar.toString() + " +0700");
            if (isNaN(wKeluarDate.getTime())) continue;
            
            let wKeluarStr = Utilities.formatDate(wKeluarDate, "Asia/Jakarta", "yyyy/MM/dd");
            
            if(wKeluarStr === todayWIB) {
              liveData.push({
                nrpp: data[i][1], nama: data[i][2],
                divisi: isSales ? "SALES" : "OPS (" + data[i][7] + ")",
                customer: isSales ? data[i][8] : data[i][9],
                waktuKeluar: Utilities.formatDate(wKeluarDate, "Asia/Jakarta", "HH:mm"),
                status: isSales ? (data[i][15] || "SEDANG JALAN") : (data[i][17] || "SEDANG JALAN")
              });
            }
          }
        }
      });
    }
    
    extractLogs(DB_UPD_ID, false);
    extractLogs(DB_SALES_ID, true);

    return { status: "success", data: liveData };
  } catch(e) { return { status: "error", message: e.toString() }; }
}

// ==========================================================
// MODUL SUPER ADMIN: REKAPITULASI & EKSPOR DATA
// ==========================================================

function api_adminGetRekapSheets() {
  try {
    const db = SpreadsheetApp.openById(DB_REKAP_ID);
    const sheets = db.getSheets();
    // Tarik semua nama Sheet yang ada di dalam DB_REKAP
    const sheetNames = sheets.map(s => s.getName());
    return { status: "success", data: sheetNames };
  } catch(e) {
    return { status: "error", message: e.toString() };
  }
}

function api_adminGetRekapData(sheetName) {
  try {
    const db = SpreadsheetApp.openById(DB_REKAP_ID);
    const sheet = db.getSheetByName(sheetName);
    if(!sheet) throw new Error("Sheet Rekap '" + sheetName + "' tidak ditemukan!");
    
    // [KILLER FEATURE]: Menggunakan getDisplayValues() alih-alih getValues(). 
    // Ini memaksa Google Sheets mengirim data persis seperti yang Anda lihat di layar (Teks),
    // mencegah kerusakan format jam (-13.99) atau Date Object Object saat diekspor.
    const data = sheet.getDataRange().getDisplayValues(); 
    
    return { status: "success", data: data, sheetName: sheetName };
  } catch(e) {
    return { status: "error", message: e.toString() };
  }
}

// ==========================================================
// MODUL USER: RIWAYAT PERJALANAN DINAS & UPD (GROUPING ST)
// ==========================================================

// --- CARI DAN GANTI FUNGSI INI DI BE_Services.gs ---

function api_getLogPribadi(user) {
  try {
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = "Log_" + user.lokasi.trim();
    let sheet = dbUpd.getSheetByName(targetSheetName);
    if(!sheet) return { status: "success", data: {} };
    const data = sheet.getDataRange().getValues();
    if(data.length <= 1) return { status: "success", data: {} };

    // [MESIN BARU]: Tarik Master UPD untuk breakdown otomatis di PDF
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const masterUPD = dbMaster.getSheetByName("Master_UPD").getDataRange().getValues();
    let upd_ge8 = 0, upd_lt8 = 0, uangMakan = 0, mknSiangLibur = 0, lainKerja = 0, lainLibur = 0;
    let keyJabatan = user.jabatan ? user.jabatan.toString().trim().toUpperCase() : "";
    let keyGolongan = user.golongan ? user.golongan.toString().trim().toUpperCase() : "";

    for (let i = 1; i < masterUPD.length; i++) {
      let dbJab = masterUPD[i][0] ? masterUPD[i][0].toString().trim().toUpperCase() : "";
      let dbGol = masterUPD[i][1] ? masterUPD[i][1].toString().trim().toUpperCase() : "";
      if (dbJab === keyJabatan && dbGol === keyGolongan) {
        upd_ge8 = parseFloat(masterUPD[i][2] || 0);
        upd_lt8 = parseFloat(masterUPD[i][3] || 0);
        uangMakan = parseFloat(masterUPD[i][4] || 0);
        mknSiangLibur = parseFloat(masterUPD[i][5] || 0);
        lainKerja = parseFloat(masterUPD[i][6] || 0);
        lainLibur = parseFloat(masterUPD[i][7] || 0);
        break;
      }
    }

    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    const iNoST = headers.indexOf("NO_ST");
    const iCust = headers.indexOf("CUSTOMER");
    const iLokasi = headers.lastIndexOf("LOKASI"); // [FIX]: Pastikan index 10 (Lokasi Customer)
    
    const iWaktuKeluar = headers.indexOf("WAKTU_KELUAR") !== -1 ? headers.indexOf("WAKTU_KELUAR") : headers.indexOf("WAKTU KELUAR");
    const iWaktuMasuk = headers.indexOf("WAKTU_MASUK") !== -1 ? headers.indexOf("WAKTU_MASUK") : headers.indexOf("WAKTU MASUK");
    const iDurasi = headers.indexOf("DURASI_JAM") !== -1 ? headers.indexOf("DURASI_JAM") : headers.indexOf("DURASI JAM");
    const iNominal = headers.indexOf("NOMINAL_UPD") !== -1 ? headers.indexOf("NOMINAL_UPD") : headers.indexOf("NOMINAL UPD");
    const iStatus = headers.indexOf("STATUS_PERJALANAN") !== -1 ? headers.indexOf("STATUS_PERJALANAN") : headers.indexOf("STATUS PERJALANAN");
    const iKlaim = headers.indexOf("STATUS_KLAIM") !== -1 ? headers.indexOf("STATUS_KLAIM") : headers.indexOf("STATUS KLAIM");

    let groupedData = {};
    for(let i = data.length - 1; i >= 1; i--) {
       if(data[i][1].toString() === user.nrpp.toString()) {
           let st = (iNoST !== -1 && data[i][iNoST]) ? data[i][iNoST].toString().trim() : "TANPA ST";
           if(!st) st = "TANPA ST";
           
           if(!groupedData[st]) groupedData[st] = [];
           
           let wKeluar = (iWaktuKeluar !== -1) ? data[i][iWaktuKeluar] : "";
           let wKeluarStr = (wKeluar instanceof Date) ? Utilities.formatDate(wKeluar, "Asia/Jakarta", "dd/MM/yyyy HH:mm") : wKeluar.toString();
           let wMasuk = (iWaktuMasuk !== -1 && data[i][iWaktuMasuk]) ? data[i][iWaktuMasuk] : "";
           let wMasukStr = (wMasuk instanceof Date) ? Utilities.formatDate(wMasuk, "Asia/Jakarta", "dd/MM/yyyy HH:mm") : (wMasuk ? wMasuk.toString() : "-");
           
           // [RULE 3, 4, 5, 6]: Kalkulasi Breakdown UPD per baris
           let durVal = (iDurasi !== -1 && data[i][iDurasi]) ? parseFloat(data[i][iDurasi]) : 0;
           let dbNominal = (iNominal !== -1 && data[i][iNominal]) ? parseFloat(data[i][iNominal]) : 0;
           
           let logDateObj = (wKeluar instanceof Date) ? wKeluar : new Date(); 
           if (wMasuk instanceof Date) logDateObj = wMasuk; 
           else if (typeof wMasuk === "string" && wMasuk.length > 5) logDateObj = new Date(wMasuk.toString().replace(/-/g, "/") + " +0700");
           
           let isWeekend = (logDateObj.getDay() === 0 || logDateObj.getDay() === 6);

           let calc_upd = (durVal >= 8) ? upd_ge8 : upd_lt8;
           let calc_makanTotal = uangMakan;
           let calc_makanSiang = isWeekend ? mknSiangLibur : 0;
           let calc_lain = isWeekend ? lainLibur : lainKerja;
           let calc_total = calc_upd + calc_makanTotal + calc_makanSiang + calc_lain;

           // Bypass angka jika durasi masih 0 (belum pulang)
           if(durVal === 0) {
               calc_upd = 0; calc_makanTotal = 0; calc_makanSiang = 0; calc_lain = 0; calc_total = 0;
           }

           groupedData[st].push({
               customer: (iCust !== -1 && data[i][iCust]) ? data[i][iCust].toString() : "-",
               lokasi: (iLokasi !== -1 && data[i][iLokasi]) ? data[i][iLokasi].toString() : "-",
               waktuKeluar: wKeluarStr,
               waktuMasuk: wMasukStr,
               durasi: durVal.toFixed(2),
               nominal: dbNominal,
               status: (iStatus !== -1 && data[i][iStatus]) ? data[i][iStatus].toString() : "SEDANG JALAN",
               klaim: (iKlaim !== -1 && data[i][iKlaim]) ? data[i][iKlaim].toString() : "BELUM KLAIM",
               breakdown: {
                   upd: calc_upd,
                   makanTotal: calc_makanTotal,
                   makanSiang: calc_makanSiang,
                   lain: calc_lain,
                   total: calc_total
               }
           });
       }
    }

    return { status: "success", data: groupedData };
  } catch(e) {
    return { status: "error", message: e.toString() };
  }
}
