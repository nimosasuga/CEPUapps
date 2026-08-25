// ==============================================================================
// FILE: BE_Config.gs
// TIPE: SERVER-SIDE SCRIPT
// DESKRIPSI: Konfigurasi Master Database Enterprise C.E.P.U
// ==============================================================================

const DB_MASTER_ID = "1RxYlbfLqSK_188xJ4ypF-uuFSdWIV9228ie3WciwOuU";
/** * [ANTI MAGIC-INDEX ARCHITECTURE]
 * Kamus Index Kolom Master_Karyawan (0-indexed)
 * @type {Readonly<DBMapMasterKaryawan>}
 */
const MAP_KARYAWAN = Object.freeze({
  NRPP: 0,
  NAMA: 1,
  JABATAN: 2,
  GOLONGAN: 3,
  STATUS_KARYAWAN: 4,
  DEPARTEMEN: 5,
  LOKASI: 6,
});

/** * [ANTI MAGIC-INDEX ARCHITECTURE]
 * Kamus Index Kolom Log_Ops (0-indexed)
 * @type {Readonly<DBMapLogOps>}
 */
const MAP_LOG_OPS = Object.freeze({
  ID_TRANSAKSI: 0,
  NRPP: 1,
  NO_ST: 8,
  CUSTOMER: 9,
  LOKASI_DEST: 10,
  WAKTU_KELUAR: 11,
  KORDINAT_KELUAR: 12,
  WAKTU_MASUK: 13,
  KORDINAT_MASUK: 14,
  DURASI: 15,
  NOMINAL: 16,
  STATUS_JALAN: 17,
  STATUS_KLAIM: 18,
  ID_KLAIM: 19,
  STATUS_APPROVE: 20,
  SOURCE_OF_TRUTH: 22,
});

const DB_UPD_ID = "1yiaL3Jo9XkAsaXkhRW2oeiyUtenFm906os6ypPfVNMo";
const DB_SALES_ID = "1NoA6hNG95HizxCEMkrX3Fm39eOlgWa0OBZnzWe-HhqM";
const DB_REKAP_ID = "16CFJejUc9tt7E9V5jutXxlrOZqgeZexZqEyTCjzpO_w";
// [NEW]: Database Gudang Arsip untuk Cold Storage (> 90 Hari)
const DB_ARCHIVE_ID = "11rZDUUDtcn2jwAe6Or0IWD-g6ubAjoHFXeXnuvYVEX0"