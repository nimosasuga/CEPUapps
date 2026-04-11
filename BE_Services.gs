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
    // 1. Tarik Data Status Absensi dengan Smart Dual-Lookup
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetStatus = dbMaster.getSheetByName("Master_Status_Absensi");
    const dataStatus = sheetStatus.getDataRange().getValues();
    
    let options = [];
    let userLokasi = user.lokasi ? user.lokasi.toString().toUpperCase().trim() : "";
    let userJabatan = user.jabatan ? user.jabatan.toString().toUpperCase().trim() : "";

    for (let i = 1; i < dataStatus.length; i++) {
      let filterArea = dataStatus[i][2] ? dataStatus[i][2].toString().toUpperCase() : "";
      
      // [UPDATE]: Mengecek apakah kolom Lokasi di Master mengandung Lokasi user ATAU Jabatan user
      if (filterArea.includes(userLokasi) || filterArea.includes(userJabatan)) {
        options.push({ code: dataStatus[i][0], desc: dataStatus[i][1] });
      }
    }

    // 2. Tarik Data Riwayat ST khusus NRPP tersebut
    const dbUpd = SpreadsheetApp.openById(DB_UPD_ID);
    let targetSheetName = "Log_" + user.lokasi.trim();
    let sheetLog = dbUpd.getSheetByName(targetSheetName);
    
    let history = [];
    if (sheetLog) {
      const dataLog = sheetLog.getDataRange().getValues();
      let stSet = new Set();
      
      // Looping dari bawah (data terbaru) ke atas
      for (let i = dataLog.length - 1; i >= 1; i--) {
        if (dataLog[i][1].toString() === user.nrpp.toString()) { 
          let noST = dataLog[i][8] ? dataLog[i][8].toString().trim() : ""; 
          if (noST !== "" && !stSet.has(noST)) {
            stSet.add(noST);
            history.push({
              noST: noST,
              customer: dataLog[i][9] ? dataLog[i][9].toString() : "", 
              lokasi: dataLog[i][10] ? dataLog[i][10].toString() : ""   
            });
          }
        }
      }
    }

    return { status: "success", data: { statusOptions: options, historyST: history } };
  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

function api_verifyLogin(nrpp, password, deviceId) {
  try {
    const dbMaster = SpreadsheetApp.openById(DB_MASTER_ID);
    const sheetLogin = dbMaster.getSheetByName("Master_Login");
    const dataLogin = sheetLogin.getDataRange().getValues();
    
    let userFound = false;
    let rowIndex = -1;
    let userName = "";

    for (let i = 1; i < dataLogin.length; i++) {
      if (dataLogin[i][0].toString() === nrpp.toString() && dataLogin[i][2].toString() === password.toString()) {
        let registeredDeviceId = dataLogin[i][3] ? dataLogin[i][3].toString() : "";
        rowIndex = i + 1; 

        if (registeredDeviceId === "") {
          sheetLogin.getRange(rowIndex, 4).setValue(deviceId);
        } else if (registeredDeviceId !== deviceId.toString()) {
          return { status: "error", message: "⛔ SECURITY LOCK: NRPP ini telah ditautkan ke perangkat/HP lain. Dilarang keras titip absen!" };
        }

        userFound = true;
        userName = dataLogin[i][1];
        sheetLogin.getRange(rowIndex, 5).setValue(new Date()); 
        break;
      }
    }

    if (!userFound) return { status: "error", message: "Kredensial tidak valid!" };

    const sheetKaryawan = dbMaster.getSheetByName("Master_Karyawan");
    const dataKaryawan = sheetKaryawan.getDataRange().getValues();
    let jabatan = "", golongan = "", statusKaryawan = "", departemen = "", lokasi = "";

    for (let i = 1; i < dataKaryawan.length; i++) {
      if (dataKaryawan[i][0].toString() === nrpp.toString()) {
        jabatan = dataKaryawan[i][2]; 
        golongan = dataKaryawan[i][3];
        statusKaryawan = dataKaryawan[i][4]; // [UPDATE] Mengambil Status Karyawan
        departemen = dataKaryawan[i][5];
        lokasi = dataKaryawan[i][6];
        break;
      }
    }

    return {
      status: "success",
      data: { nrpp: nrpp, nama: userName, jabatan: jabatan, golongan: golongan, statusKaryawan: statusKaryawan, departemen: departemen, lokasi: lokasi }
    };

  } catch (error) {
    return { status: "error", message: "Kesalahan Server: " + error.toString() };
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
    // PROTOKOL ODOC (One-Day-One-Checkin) - THE ULTIMATE TRX-EPOCH VALIDATOR
    // ==========================================================
    if (user.jabatan !== "Super Admin" && user.jabatan !== "Administrator") {
        const dataLog = sheet.getDataRange().getValues();
        
        let idIndex = 0;
        let nrppIndex = 1;
        
        if (dataLog.length > 0) {
            let header = dataLog[0];
            for(let c = 0; c < header.length; c++) {
                let colName = header[c].toString().toUpperCase().trim();
                if(colName === "ID_TRANSAKSI" || colName === "ID") idIndex = c;
                if(colName === "NRPP") nrppIndex = c;
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
                let cellID = String(dataLog[i][idIndex]).trim();
                
                // [KUNCI ABSOLUT]: Ekstrak Waktu Langsung dari ID Transaksi (TRX-17...)
                // Mengabaikan kolom tanggal Google Sheets sepenuhnya agar kebal Timezone Server.
                if (cellID.startsWith("TRX-")) {
                    let epochStr = cellID.replace("TRX-", "");
                    let epochNum = parseInt(epochStr, 10);
                    
                    if (!isNaN(epochNum)) {
                        let logDate = new Date(epochNum);
                        let r_y = Utilities.formatDate(logDate, "Asia/Jakarta", "yyyy");
                        let r_m = Utilities.formatDate(logDate, "Asia/Jakarta", "MM");
                        let r_d = Utilities.formatDate(logDate, "Asia/Jakarta", "dd");
                        
                        if (r_y === y_wib && r_m === m_wib && r_d === d_wib) {
                            isAlreadyClockedIn = true;
                        }
                    }
                } else {
                    // Fallback Plan: String Scanner jika ID rusak (Sangat jarang terjadi)
                    let timeIndex = isSales ? 10 : 11;
                    let fallbackDate = String(dataLog[i][timeIndex]);
                    let d_nz = parseInt(d_wib, 10).toString();
                    let m_nz = parseInt(m_wib, 10).toString();
                    const checkFormats = [
                        `${y_wib}/${m_wib}/${d_wib}`, `${d_wib}/${m_wib}/${y_wib}`,
                        `${y_wib}-${m_wib}-${d_wib}`, `${d_wib}-${m_wib}-${y_wib}`,
                        `${d_nz}/${m_nz}/${y_wib}`, `${m_nz}/${d_nz}/${y_wib}`, `${y_wib}/${m_nz}/${d_nz}`
                    ];
                    if (checkFormats.some(fmt => fallbackDate.includes(fmt))) {
                        isAlreadyClockedIn = true;
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
          payload.noST, payload.customer, payload.lokasi, timeToSave, payload.kordinat, "", "", "", "", "SEDANG JALAN", "BELUM KLAIM", ""
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
        break;
      }
    }

    if (targetRow === -1) throw new Error("ID Transaksi tidak ditemukan.");

    const waktuMasuk = new Date();
    // [UPDATE BUG FIX] Format string UI dengan WIB lock
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
