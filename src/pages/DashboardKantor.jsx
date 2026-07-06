// src/pages/DashboardKantor.jsx
import React, { useState, useEffect } from 'react';
import { supabaseData } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';

export default function DashboardKantor() {
  const { profile: profilUser, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  const hitungPersen = (pembilang, penyebut) => {
    if (!penyebut || penyebut === 0) return "0.0%";
    return `${((pembilang / penyebut) * 100).toFixed(1)}%`;
  };

  const formatTanggalIndo = (stringTanggal) => {
    if (!stringTanggal || stringTanggal === '0000-00-00') return "-";
    const opsi = { day: '2-digit', month: 'long', year: 'numeric' };
    return new Date(stringTanggal).toLocaleDateString('id-ID', opsi);
  };

  // Data State
  const [masterAnomali, setMasterAnomali] = useState([]);
  const [treeData, setTreeData] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  
  // UI Kontrol State
  const [expandedKec, setExpandedKec] = useState({});
  const [expandedSnap, setExpandedSnap] = useState({});
  const [modalDetailObj, setModalDetailObj] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [loadingModal, setLoadingModal] = useState(false);
  const [konfirmasiId, setKonfirmasiId] = useState(null);
  const [idSelesaiLokal, setIdSelesaiLokal] = useState([]);

  // State Baru untuk Alur Unggah Excel Cerdas
  const [rawExcelData, setRawExcelData] = useState(null);
  const [modalUploadReview, setModalUploadReview] = useState(false);
  const [pilihanTanggalSnapshot, setPilihanTanggalSnapshot] = useState(new Date().toISOString().split('T')[0]);
  const [uploadProgressStatus, setUploadProgressStatus] = useState(''); // 'membaca', 'mengirim', 'selesai'
  const [hasilUploadRingkasan, setHasilUploadRingkasan] = useState(null);

  // State untuk Tab Filter di Dalam Modal
  const [subjekFilterTab, setSubjekFilterTab] = useState('siap_eksekusi');

  // KPI Rapor Ringkasan Global
  const [summaryMetrics, setSummaryMetrics] = useState({
    totalAnomali: 0, sudahPcl: 0, belumPcl: 0, sudahFasih: 0, belumFasih: 0
  });

  const getInfoAnomali = (kode, tipe = 'deskripsi') => {
    const target = masterAnomali.find(a => a.kode === kode);
    if (!target) return kode;
    return tipe === 'deskripsi' ? target.deskripsi : target.aturan_teknis;
  };

  const fetchMasterAnomali = async () => {
    try {
      const { data, error } = await supabaseData
        .from('master_anomali')
        .select('kode, deskripsi, aturan_teknis, kata_kunci, kategori');
      if (error) throw error;
      setMasterAnomali(data || []);
    } catch (err) {
      console.error('Gagal memuat aturan master anomali:', err.message);
    }
  };

  const fetchDataMonitoringKantor = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseData
        .from('view_monitoring_anomali')
        .select('kdkec, nmkec, tanggal_snapshot, nama_pml, pml_email, kode_anomali, status_konfirmasi, status_fasih');

      if (error) throw error;
      
      hitungMetrikGlobal(data || []);
      prosesStrukturAgregat(data || []);
    } catch (err) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const siapkanDataAwal = async () => {
      await fetchMasterAnomali();
      await fetchDataMonitoringKantor();
    };
    siapkanDataAwal();
  }, []);

  const hitungMetrikGlobal = (data) => {
    const total = data.length;
    const sudahPcl = data.filter(d => d.status_konfirmasi !== 'Belum Tindak Lanjut').length;
    const sudahFasih = data.filter(d => d.status_fasih === 'Sudah Tindak Lanjut FASIH').length;

    setSummaryMetrics({
      totalAnomali: total, sudahPcl: sudahPcl, belumPcl: total - sudahPcl, sudahFasih: sudahFasih, belumFasih: sudahPcl - sudahFasih
    });
  };

  const prosesStrukturAgregat = (data) => {
    const kecMap = {};

    data.forEach(item => {
      const kecKey = item.kdkec || '999';
      const namaKecamatannya = item.nmkec || 'TIDAK TERDEFINISI';
      const tglKey = item.tanggal_snapshot || '0000-00-00';
      const pmlKey = item.nama_pml || item.pml_email || 'TANPA PML';
      const pmlEmailKey = item.pml_email || 'no-email';
      const kodeKey = item.kode_anomali || 'ERR';

      if (!kecMap[kecKey]) {
        kecMap[kecKey] = { kodeKec: kecKey, namaKec: namaKecamatannya, snapshotRows: {} };
      }

      if (!kecMap[kecKey].snapshotRows[tglKey]) {
        kecMap[kecKey].snapshotRows[tglKey] = { tglSnapshot: tglKey, pmlRows: {} };
      }

      if (!kecMap[kecKey].snapshotRows[tglKey].pmlRows[pmlKey]) {
        kecMap[kecKey].snapshotRows[tglKey].pmlRows[pmlKey] = { namaPml: pmlKey, emailPml: pmlEmailKey, kodeRows: {} };
      }

      if (!kecMap[kecKey].snapshotRows[tglKey].pmlRows[pmlKey].kodeRows[kodeKey]) {
        kecMap[kecKey].snapshotRows[tglKey].pmlRows[pmlKey].kodeRows[kodeKey] = {
          kode: kodeKey,
          total: 0, sudahPcl: 0, belumPcl: 0, sudahFasih: 0, belumFasih: 0,
          kdkec: kecKey,
          tanggal_snapshot: tglKey,
          pml_email: pmlEmailKey,
          namaPml: pmlKey
        };
      }

      const targetKode = kecMap[kecKey].snapshotRows[tglKey].pmlRows[pmlKey].kodeRows[kodeKey];
      targetKode.total += 1;

      if (item.status_konfirmasi !== 'Belum Tindak Lanjut') {
        targetKode.sudahPcl += 1;
        if (item.status_fasih === 'Sudah Tindak Lanjut FASIH') {
          targetKode.sudahFasih += 1;
        } else {
          targetKode.belumFasih += 1;
        }
      } else {
        targetKode.belumPcl += 1;
      }
    });

    const finalTree = Object.values(kecMap).map(k => ({
      ...k,
      snapshotList: Object.values(k.snapshotRows).map(s => ({
        ...s,
        pmlList: Object.values(s.pmlRows).map(p => ({
          ...p,
          kodeList: Object.values(p.kodeRows).sort((a, b) => a.kode.localeCompare(b.kode))
        })).sort((a, b) => a.namaPml.localeCompare(b.namaPml))
      })).sort((a, b) => b.tglSnapshot.localeCompare(a.tglSnapshot))
    }));

    finalTree.sort((a, b) => String(a.kodeKec).localeCompare(String(b.kodeKec), undefined, { numeric: true }));
    setTreeData(finalTree);
  };

  // Fase 1: Membaca File Excel & Membuka Modal Review Ringkasan Awal
  const handlePilihFileExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadProgressStatus('membaca');

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(ws);

        if (rawData.length === 0) {
          alert('File Excel kosong!');
          setUploading(false);
          return;
        }

        setRawExcelData(rawData);
        setHasilUploadRingkasan(null); // Reset hasil ringkasan sebelumnya
        setModalUploadReview(true);    // Buka dialog review konfirmasi
      } catch (err) {
        alert('Gagal membaca file Excel: ' + err.message);
        setUploading(false);
      }
    };
    reader.readAsBinaryString(file);
    // Reset file input value agar bisa memilih file yang sama lagi nantinya
    e.target.value = '';
  };

  // Fase 2: Eksekusi Penyimpanan Data ke Supabase dengan Progres & Ringkasan Akhir
  const handleEksekusiUploadKeDatabase = async () => {
    if (!rawExcelData) return;
    setUploadProgressStatus('mengirim');

    try {
      const { data: dataMenggantung } = await supabaseData
        .from('view_monitoring_anomali')
        .select('assignment_id, kode_anomali, pertama_muncul_pada')
        .not('status_fasih', 'eq', 'Sudah Tindak Lanjut FASIH');

      let jumlahSukses = 0;
      let jumlahGagal = 0;

      const formattedData = rawExcelData.map((row, index) => {
        try {
          const normalizedRow = {};
          Object.keys(row).forEach((key) => {
            normalizedRow[key.toString().toLowerCase().replace(/[\s_/]/g, '')] = row[key];
          });

          const namaAnomaliRaw = normalizedRow['namaanomali'] || '';
          const aturanCocok = masterAnomali.find(aturan =>
            namaAnomaliRaw.toLowerCase().includes(aturan.kata_kunci.toLowerCase())
          );

          const kodeAnomali = aturanCocok ? aturanCocok.kode : 'ERR';
          const kategori = aturanCocok ? aturanCocok.kategori : 'USAHA';
          const namaSubjek = normalizedRow['namausaha'] || normalizedRow['namakrt'] || normalizedRow['namasubjek'] || 'Tanpa Nama';
          const desa = String(normalizedRow['kodedesa'] || normalizedRow['kddesa'] || '').trim().padStart(10, '0');
          const sls = String(normalizedRow['kodesls'] || String(normalizedRow['kdsls'] || '')).trim().padStart(4, '0');
          const subSls = String(normalizedRow['subsls'] || normalizedRow['kdsubsls'] || '00').trim().padStart(2, '0');
          const generatedIdSubSls = `${desa}${sls}${subSls}`;
          const assignmentId = String(normalizedRow['assignmentid'] || normalizedRow['assignment_id'] || `GEN-${Date.now()}-${index}`);

          const temukanDataLama = dataMenggantung?.find(
            old => old.assignment_id === assignmentId && old.kode_anomali === kodeAnomali
          );

          jumlahSukses++; // Asumsi awal baris data terformat dengan baik
          return {
            idsubsls: generatedIdSubSls,
            assignment_id: assignmentId,
            nama_subjek: namaSubjek,
            kode_anomali: kodeAnomali,
            kategori_anomali: kategori,
            link_fasih: normalizedRow['linkfasih'] || normalizedRow['link_fasih'] || '',
            tanggal_snapshot: pilihanTanggalSnapshot,
            pertama_muncul_pada: temukanDataLama ? temukanDataLama.pertama_muncul_pada : pilihanTanggalSnapshot
          };
        } catch (errRow) {
          jumlahGagal++;
          return null;
        }
      }).filter(item => item !== null);

      if (formattedData.length > 0) {
        const { error } = await supabaseData
          .from('anomali_data')
          .upsert(formattedData, {
            onConflict: 'assignment_id, kode_anomali, tanggal_snapshot',
            ignoreDuplicates: true
          });

        if (error) throw error;
      }

      // Tampilkan hasil final akhir di modal
      setHasilUploadRingkasan({
        total: rawExcelData.length,
        sukses: jumlahSukses,
        gagal: jumlahGagal
      });
      setUploadProgressStatus('selesai');
      fetchDataMonitoringKantor();

    } catch (err) {
      console.error(err);
      alert('Gagal mengimpor data anomali: ' + err.message);
      setModalUploadReview(false);
      setUploading(false);
    }
  };

  const handleBukaModalDetail = async (itemObj, namaKec) => {
    setSubjekFilterTab('siap_eksekusi');
    setLoadingModal(true);
    setIdSelesaiLokal([]);
    
    setModalDetailObj({ 
      ...itemObj, 
      namaKec: namaKec, 
      kodePemicu: itemObj.kode, 
      tglSnapshot: itemObj.tanggal_snapshot, 
      daftarSubjek: [] 
    });

    try {
      const { data: sampelTarget, error } = await supabaseData
        .from('view_monitoring_anomali')
        .select('anomali_id, assignment_id, nama_subjek, nmdesa, nmsls, nama_pcl, pcl_email, link_fasih, kode_anomali, status_konfirmasi, catatan_lapangan, status_fasih')
        .eq('kdkec', itemObj.kdkec)
        .eq('pml_email', itemObj.pml_email)
        .eq('tanggal_snapshot', itemObj.tanggal_snapshot);

      if (error) throw error;

      const listAssignmentId = [...new Set(sampelTarget.map(s => s.assignment_id))];
      const grupBerdasarkanSubjek = listAssignmentId.map(assignId => {
        const semuaAnomaliSubjek = sampelTarget.filter(raw => raw.assignment_id === assignId);
        const profilUtama = semuaAnomaliSubjek[0];

        return {
          assignment_id: assignId,
          nama_subjek: profilUtama.nama_subjek,
          nmdesa: profilUtama.nmdesa,
          nmsls: profilUtama.nmsls,
          nama_pcl: profilUtama.nama_pcl || profilUtama.pcl_email,
          link_fasih: profilUtama.link_fasih,
          detailAnomali: semuaAnomaliSubjek.map(a => ({
            anomali_id: a.anomali_id,
            kode: a.kode_anomali,
            status_konfirmasi: a.status_konfirmasi,
            catatan_lapangan: a.catatan_lapangan,
            status_fasih: a.status_fasih,
          }))
        };
      });

      const subjekValid = grupBerdasarkanSubjek.filter(subjek => 
        subjek.detailAnomali.some(a => a.kode === itemObj.kode)
      );

      setModalDetailObj(prev => ({ ...prev, daftarSubjek: subjekValid }));
    } catch (err) {
      console.error("Gagal memuat detail sampel:", err.message);
      alert("Gagal memuat data detail subjek.");
      setModalDetailObj(null);
    } finally {
      setLoadingModal(false);
    }
  };

  const handleTutupModal = () => {
    setModalDetailObj(null);
    setIdSelesaiLokal([]);
  };

  const handleSimpanFasihTunggal = async (anomaliId) => {
    setUpdatingId(anomaliId);
    setKonfirmasiId(null);
    try {
      const targetSubjek = modalDetailObj.daftarSubjek.find(s => 
        s.detailAnomali.some(a => a.anomali_id === anomaliId)
      );
      const detailAnomaliTarget = targetSubjek?.detailAnomali.find(a => a.anomali_id === anomaliId);
      
      if (!targetSubjek || !detailAnomaliTarget) throw new Error("Data lokal tidak sinkron");

      const assignIdIdem = targetSubjek.assignment_id;
      const kodeAnomaliIdem = detailAnomaliTarget.kode;

      const { data: daftarKembar, error: errCari } = await supabaseData
        .from('view_monitoring_anomali')
        .select('anomali_id')
        .eq('assignment_id', assignIdIdem)
        .eq('kode_anomali', kodeAnomaliIdem);

      if (errCari) throw errCari;

      const listPayload = daftarKembar.map(item => ({
        anomali_id: item.anomali_id,
        status_fasih: 'Sudah Tindak Lanjut FASIH',
        dieksekusi_oleh_email: profilUser?.email,
        waktu_eksekusi_fasih: new Date().toISOString()
      }));

      const { error: errUpsert } = await supabaseData
        .from('tindak_lanjut_anomali')
        .upsert(listPayload, { onConflict: 'anomali_id' });

      if (errUpsert) throw errUpsert;

      alert('Berhasil memverifikasi data! Semua anomali serupa di tanggal snapshot lain otomatis diselesaikan.');
      
      await fetchDataMonitoringKantor();
      handleTutupModal();
      
    } catch (err) {
      alert('Gagal memperbarui status: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleExpandKec = (kecName) => {
    setExpandedKec(prev => ({ ...prev, [kecName]: !prev[kecName] }));
  };

  const toggleExpandSnap = (kecKey, snapDate) => {
    const compositeKey = `${kecKey}_${snapDate}`;
    setExpandedSnap(prev => ({ ...prev, [compositeKey]: !prev[compositeKey] }));
  };

  const semuaSubjekModal = modalDetailObj?.daftarSubjek || [];
  const jumlahSiapEksekusi = semuaSubjekModal.filter(subjek => 
    subjek.detailAnomali.some(a => a.status_fasih !== 'Sudah Tindak Lanjut FASIH' && a.status_konfirmasi !== 'Belum Tindak Lanjut' && a.catatan_lapangan)
  ).length;
  const jumlahSelesai = semuaSubjekModal.filter(subjek => subjek.detailAnomali.every(a => a.status_fasih === 'Sudah Tindak Lanjut FASIH')).length;
  const jumlahSemua = semuaSubjekModal.length;

  const subjekTersaring = semuaSubjekModal.filter(subjek => {
    const isSelesaiSemuaMurni = subjek.detailAnomali.every(a => a.status_fasih === 'Sudah Tindak Lanjut FASIH');
    const adaSiapEksekusiMurni = subjek.detailAnomali.some(a => a.status_fasih !== 'Sudah Tindak Lanjut FASIH' && a.status_konfirmasi !== 'Belum Tindak Lanjut' && a.catatan_lapangan);
    const adaYangBaruDisetujuiLokal = subjek.detailAnomali.some(a => idSelesaiLokal.includes(a.anomali_id));

    if (subjekFilterTab === 'siap_eksekusi') {
      return (adaSiapEksekusiMurni && !isSelesaiSemuaMurni) || adaYangBaruDisetujuiLokal;
    }
    if (subjekFilterTab === 'selesai') return isSelesaiSemuaMurni;
    return true;
  });

  const subjekSiapTampil = [...subjekTersaring].sort((a, b) => {
    const aSiapAtauBaruSelesai = a.detailAnomali.some(an => (an.catatan_lapangan && an.status_fasih !== 'Sudah Tindak Lanjut FASIH') || idSelesaiLokal.includes(an.anomali_id));
    const bSiapAtauBaruSelesai = b.detailAnomali.some(an => (an.catatan_lapangan && an.status_fasih !== 'Sudah Tindak Lanjut FASIH') || idSelesaiLokal.includes(an.anomali_id));
    
    if (aSiapAtauBaruSelesai && !bSiapAtauBaruSelesai) return -1;
    if (!aSiapAtauBaruSelesai && bSiapAtauBaruSelesai) return 1;
    return 0;
  });

  if (loading && masterAnomali.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 text-slate-500 font-sans text-xs font-bold">
        ⏳ Memuat Pengaturan Aturan & Data Agregat Kantor...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-slate-700 font-sans antialiased">
      {/* NAVBAR */}
      <div className="bg-gradient-to-r from-amber-800 to-orange-900 text-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="space-y-0.5">
            <h1 className="text-base font-black tracking-tight text-amber-50">SIMALI</h1>
            <p className="text-xs text-amber-200/80 font-medium">Pegawai: {profilUser?.nama_pengguna || profilUser?.email}</p>
          </div>
          <button onClick={logout} className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-1.5 rounded-lg text-xs shadow-xs transition-colors">Keluar</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-6 pb-24 space-y-6">
        {/* WIDGET KPI GLOBAL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
            <span className="text-stone-400 text-[10px] font-bold block uppercase tracking-wider">Total Anomali</span>
            <span className="text-2xl font-black text-slate-800 mt-1 block font-mono">{summaryMetrics.totalAnomali}</span>
            <span className="text-[10px] text-stone-500 font-medium mt-1 block">Total Anomali Keseluruhan</span>
          </div>

          <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/50 shadow-2xs">
            <span className="text-amber-800/80 text-[10px] font-bold block uppercase tracking-wider">Sudah Konfirmasi Petugas</span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-black text-amber-700 font-mono">{summaryMetrics.sudahPcl}</span>
              <span className="text-xs font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-sm font-mono">
                {hitungPersen(summaryMetrics.sudahPcl, summaryMetrics.totalAnomali)}
              </span>
            </div>
            <span className="text-[10px] text-amber-900/60 font-medium mt-1 block">Dari total beban anomali</span>
          </div>

          <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-200/50 shadow-2xs">
            <span className="text-emerald-800/80 text-[10px] font-bold block uppercase tracking-wider">Sudah Tindak Lanjut Fasih</span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-black text-emerald-700 font-mono">{summaryMetrics.sudahFasih}</span>
              <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-sm font-mono">
                {hitungPersen(summaryMetrics.sudahFasih, summaryMetrics.totalAnomali)}
              </span>
            </div>
            <span className="text-[10px] text-emerald-900/60 font-medium mt-1 block">Selesai ditindak lanjuti di Fasih</span>
          </div>

          <div className="bg-orange-50 border-2 border-orange-400/80 p-4 rounded-xl shadow-xs">
            <span className="text-orange-900 text-[10px] font-black block uppercase tracking-wider animate-pulse">Belum Tindak Lanjut Fasih</span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-3xl font-black text-orange-700 font-mono">{summaryMetrics.belumFasih}</span>
              <span className="text-xs font-black text-orange-950 bg-orange-200 px-1.5 py-0.5 rounded-sm font-mono">
                {hitungPersen(summaryMetrics.belumFasih, summaryMetrics.sudahPcl)}
              </span>
            </div>
            <span className="text-[10px] text-orange-900/70 font-medium mt-1 block">Sudah konfirmasi petugas tapi belum Fasih</span>
          </div>
        </div>

        {/* TABEL AGREGAT UTAMA */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-stone-50 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Rekap Anomali</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`cursor-pointer inline-flex items-center gap-1.5 bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs hover:bg-amber-600 shadow-3xs transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <span>📁 Impor Excel</span>
                <input type="file" accept=".xlsx, .xls" onChange={handlePilihFileExcel} className="hidden" disabled={uploading} />
              </label>
              <button onClick={fetchDataMonitoringKantor} className="bg-white border text-xs text-amber-800 font-bold px-3 py-1.5 rounded-lg hover:bg-stone-50 shadow-3xs">🔄 Segarkan Progres</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm table-fixed">
              <thead>
                <tr className="bg-stone-100 text-slate-600 font-bold border-b border-stone-200 text-[11px] uppercase tracking-wider">
                  <th className="p-3 pl-6 w-[40%]">Wilayah Tugas / Deskripsi Aturan Validasi</th>
                  <th className="p-3 text-center w-[8%]">Kode</th>
                  <th className="p-3 text-center w-[10%]">Total</th>
                  <th className="p-3 text-center bg-amber-50/20 w-[10%]">Sudah Konfirmasi</th>
                  <th className="p-3 text-center bg-amber-50/20 w-[10%] border-r border-stone-200/60">Belum Konfirmasi</th>
                  <th className="p-3 text-center bg-emerald-50/20 w-[11%] text-emerald-800">Sudah Fasih</th>
                  <th className="p-3 text-center bg-orange-50/40 w-[11%] text-orange-800">Belum Fasih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {treeData.map(kec => {
                  const isKecOpen = !!expandedKec[kec.namaKec];
                  let kecTotal = 0, kecSudahPcl = 0, kecBelumPcl = 0, kecSudahF = 0, kecBelumF = 0;

                  kec.snapshotList.forEach(s => {
                    s.pmlList.forEach(p => {
                      p.kodeList.forEach(c => {
                        kecTotal += c.total; kecSudahPcl += c.sudahPcl; kecBelumPcl += c.belumPcl;
                        kecSudahF += c.sudahFasih; kecBelumF += c.belumFasih;
                      });
                    });
                  });

                  return (
                    <React.Fragment key={kec.kodeKec}>
                      {/* TINGKAT 1: BARIS KECAMATAN */}
                      <tr onClick={() => toggleExpandKec(kec.namaKec)} className="bg-stone-50/80 hover:bg-amber-50/20 font-bold text-slate-900 cursor-pointer transition-colors border-b border-stone-200">
                        <td className="p-3 pl-6"><span className="text-amber-700 mr-2">{isKecOpen ? '▼' : '▶'}</span>🗺️ [{kec.kodeKec}] KEC. {kec.namaKec}</td>
                        <td className="p-3 text-center text-stone-300">-</td>
                        <td className="p-3 text-center font-mono">{kecTotal}</td>
                        <td className="p-3 text-center bg-amber-50/10 font-mono text-amber-700">{kecSudahPcl}</td>
                        <td className="p-3 text-center bg-amber-50/10 font-mono text-orange-600 border-r border-stone-200/60">{kecBelumPcl}</td>
                        <td className="p-3 text-center bg-emerald-50/5 font-mono text-emerald-700">{kecSudahF}</td>
                        <td className="p-3 text-center bg-orange-50/10 font-mono text-orange-700">{kecBelumF}</td>
                      </tr>

                      {isKecOpen && kec.snapshotList.map(snap => {
                        const snapKey = `${kec.kodeKec}_${snap.tglSnapshot}`;
                        const isSnapOpen = !!expandedSnap[snapKey];

                        let snapTotal = 0, snapSudahPcl = 0, snapBelumPcl = 0, snapSudahF = 0, snapBelumF = 0;
                        snap.pmlList.forEach(p => {
                          p.kodeList.forEach(c => {
                            snapTotal += c.total; snapSudahPcl += c.sudahPcl; snapBelumPcl += c.belumPcl;
                            snapSudahF += c.sudahFasih; snapBelumF += c.belumFasih;
                          });
                        });

                        return (
                          <React.Fragment key={snap.tglSnapshot}>
                            {/* TINGKAT 2: BARIS SNAPSHOT DENGAN FITUR TOGGLE ARROW & RINGKASAN TOTAL */}
                            <tr 
                              onClick={() => toggleExpandSnap(kec.kodeKec, snap.tglSnapshot)}
                              className="bg-amber-50/30 text-slate-700 border-b border-stone-100 font-semibold text-xs cursor-pointer hover:bg-amber-100/40 select-none transition-colors"
                            >
                              <td className="p-2 pl-10 text-[11px] text-amber-900 tracking-wide uppercase font-bold">
                                <span className="text-amber-800 mr-2 inline-block transition-transform">{isSnapOpen ? '▼' : '▶'}</span>
                                📅 Tanggal Anomali: <span className="font-black underline">{formatTanggalIndo(snap.tglSnapshot)}</span>
                              </td>
                              <td className="p-2 text-center text-stone-300">-</td>
                              <td className="p-2 text-center font-mono text-[11px] text-amber-950 font-bold">{snapTotal}</td>
                              <td className="p-2 text-center font-mono text-[11px] text-amber-700 font-bold">{snapSudahPcl}</td>
                              <td className="p-2 text-center font-mono text-[11px] text-orange-600 font-bold border-r border-stone-200/60">{snapBelumPcl}</td>
                              <td className="p-2 text-center font-mono text-[11px] text-emerald-700 font-bold">{snapSudahF}</td>
                              <td className="p-2 text-center font-mono text-[11px] text-orange-700 font-bold">{snapBelumF}</td>
                            </tr>

                            {isSnapOpen && snap.pmlList.map(pml => (
                              <React.Fragment key={pml.namaPml}>
                                {/* TINGKAT 3: BARIS DATA PML */}
                                <tr className="bg-white font-medium text-slate-800 border-b border-stone-100 text-xs">
                                  <td className="p-2 pl-14 text-slate-700">└─ 👔 Pengawas (PML): <span className="font-bold text-slate-900">{pml.namaPml}</span></td>
                                  <td colSpan="6" className="p-2 text-stone-400 text-[10px] font-mono italic">{pml.emailPml}</td>
                                </tr>

                                {/* TINGKAT 4: BARIS INDIVIDU KODE ANOMALI */}
                                {pml.kodeList.map(item => {
                                  const adaAntreanFasih = item.belumFasih > 0;
                                  return (
                                    <tr
                                      key={item.kode}
                                      onClick={() => handleBukaModalDetail(item, kec.namaKec)}
                                      className={`text-xs border-b border-stone-100 transition-colors cursor-pointer select-none ${adaAntreanFasih ? 'bg-orange-50/40 hover:bg-orange-50' : 'hover:bg-stone-50/50 text-slate-500'}`}
                                    >
                                      <td className="p-2.5 pl-24 font-medium truncate flex items-center gap-1.5">
                                        <span className="text-stone-300 font-bold">└─</span>
                                        {adaAntreanFasih && (
                                          <span className="bg-orange-600 text-white font-black text-[8px] px-1.5 py-0.2 rounded-md animate-pulse tracking-wide shrink-0">BUTUH INPUT</span>
                                        )}
                                        <span className={adaAntreanFasih ? 'font-bold text-slate-900' : ''}>
                                          {getInfoAnomali(item.kode, 'deskripsi')}
                                        </span>
                                      </td>
                                      <td className="p-2.5 text-center">
                                        <span className={`font-mono font-black px-1.5 py-0.5 rounded text-[10px] ${adaAntreanFasih ? 'bg-orange-200 text-orange-900' : 'bg-stone-100 text-stone-600'}`}>{item.kode}</span>
                                      </td>
                                      <td className="p-2.5 text-center font-mono">{item.total}</td>
                                      <td className="p-2.5 text-center bg-amber-50/10 font-mono text-amber-700 font-medium">{item.sudahPcl}</td>
                                      <td className="p-2.5 text-center bg-amber-50/10 font-mono text-stone-400 border-r border-stone-200/60">{item.belumPcl}</td>
                                      <td className="p-2.5 text-center bg-emerald-50/5 font-mono text-emerald-700 font-medium">{item.sudahFasih}</td>
                                      <td className={`p-2.5 text-center font-mono font-black ${adaAntreanFasih ? 'text-orange-700 bg-orange-100/40' : 'text-stone-400'}`}>{adaAntreanFasih ? `⚠️ ${item.belumFasih}` : '0'}</td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL PROSES & REVIEW IMPOR EXCEL CERDAS */}
      {modalUploadReview && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl border border-stone-200 p-6 shadow-2xl space-y-5 animate-scale-up">
            
            <div className="flex items-center gap-2.5 text-amber-800 border-b pb-3">
              <span className="text-xl">📊</span>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Manajer Snapshot Excel</h3>
            </div>

            {/* KONDISI 1: FORMULIR ATUR TANGGAL & RINGKASAN SEBELUM PROSES */}
            {uploadProgressStatus === 'membaca' && (
              <div className="space-y-4">
                <div className="bg-stone-50 border p-3.5 rounded-xl space-y-1.5 shadow-inner">
                  <span className="text-[10px] text-stone-400 block uppercase font-bold tracking-wider">Hasil Pemindaian File:</span>
                  <p className="text-xs text-slate-700 font-medium">Total Baris Anomali Terdeteksi: <strong className="text-amber-800 font-mono text-sm font-black">{rawExcelData?.length || 0}</strong> Baris Rekord.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 block uppercase tracking-wide">Tentukan Tanggal Snapshot Data:</label>
                  <input 
                    type="date" 
                    value={pilihanTanggalSnapshot} 
                    onChange={(e) => setPilihanTanggalSnapshot(e.target.value)}
                    className="w-full bg-white border border-stone-300 rounded-lg p-2 text-xs font-mono font-bold text-slate-800 focus:outline-amber-600"
                  />
                  <p className="text-[10px] text-stone-400/80 italic font-medium mt-1">Sistem akan mengelompokkan data ini sesuai folder tanggal yang Anda tentukan di atas.</p>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t text-xs font-bold">
                  <button 
                    type="button" 
                    onClick={() => { setModalUploadReview(false); setUploading(false); }} 
                    className="bg-stone-100 hover:bg-stone-200 text-slate-700 px-4 py-2 rounded-xl border"
                  >
                    Batal
                  </button>
                  <button 
                    type="button" 
                    onClick={handleEksekusiUploadKeDatabase} 
                    className="bg-amber-700 hover:bg-amber-600 text-white px-5 py-2 rounded-xl shadow-md shadow-amber-900/20"
                  >
                    🚀 Jalankan Sinkronisasi
                  </button>
                </div>
              </div>
            )}

            {/* KONDISI 2: TAMPILAN PROGRES INTERAKTIF SAAT PROSES DATA */}
            {uploadProgressStatus === 'mengirim' && (
              <div className="py-8 flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-amber-700/20 border-t-amber-700 rounded-full animate-spin"></div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black text-slate-800 tracking-wide animate-pulse">Menghubungkan ke Database...</p>
                  <p className="text-[10px] text-stone-400 font-medium">Memproses pencocokan data historis untuk mendeteksi anomali berulang.</p>
                </div>
              </div>
            )}

            {/* KONDISI 3: HASIL PROGRES FINAL (TOTAL SUKSES DAN TOTAL ERROR) */}
            {uploadProgressStatus === 'selesai' && hasilUploadRingkasan && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl shadow-3xs">
                    <span className="text-[10px] text-emerald-800 font-bold uppercase block tracking-wide">Sukses Terproses</span>
                    <span className="text-2xl font-black text-emerald-700 font-mono block mt-1">{hasilUploadRingkasan.sukses}</span>
                  </div>
                  <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl shadow-3xs">
                    <span className="text-[10px] text-rose-800 font-bold uppercase block tracking-wide">Gagal / Format Error</span>
                    <span className="text-2xl font-black text-rose-700 font-mono block mt-1">{hasilUploadRingkasan.gagal}</span>
                  </div>
                </div>

                <blockquote className="bg-stone-50 border-l-4 border-amber-600 p-3 rounded text-[11px] leading-relaxed font-medium text-slate-600">
                  Sinkronisasi snapshot tanggal <span className="font-bold text-slate-900 font-mono">{formatTanggalIndo(pilihanTanggalSnapshot)}</span> selesai. Grafik rekap anomali wilayah telah dimutakhirkan.
                </blockquote>

                <div className="flex justify-end pt-2 border-t text-xs font-bold">
                  <button 
                    type="button" 
                    onClick={() => { setModalUploadReview(false); setUploading(false); }} 
                    className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2 rounded-xl shadow-sm"
                  >
                    Selesai & Tutup Jendela
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* MODAL DETAIL SUBJEK & SINKRONISASI FASIH */}
      {modalDetailObj && (
        <div className="fixed inset-0 bg-slate-950/60 z-30 flex items-center justify-center p-6 animate-fade-in backdrop-blur-xs">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] border border-stone-200 animate-scale-up">
            
            <div className="p-5 bg-gradient-to-r from-stone-900 to-stone-800 text-stone-100 rounded-t-2xl flex justify-between items-center shadow-xs">
              <div className="space-y-1 w-[90%]">
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Detail Status Anomali</span>
                <h3 className="text-base font-extrabold text-white">Kecamatan {modalDetailObj.namaKec} • PML: {modalDetailObj.namaPml}</h3>
                <div className="text-xs text-stone-300 space-y-1">
                  <p>Jenis Anomali: <span className="bg-amber-500/20 text-amber-300 font-mono font-bold px-1.5 py-0.2 rounded border border-amber-500/30">[{modalDetailObj.kode}] {getInfoAnomali(modalDetailObj.kode, 'deskripsi')}</span></p>
                  <div className="bg-stone-950 text-stone-400 p-2.5 rounded border border-stone-700/60 font-sans mt-1.5 shadow-inner">
                    <strong className="text-stone-300 text-[10px] block uppercase tracking-wider mb-0.5 font-bold">Rumus Aturan Validasi Teknis:</strong>
                    <span className="text-xs leading-relaxed text-stone-300">{getInfoAnomali(modalDetailObj.kode, 'aturan_teknis')}</span>
                  </div>
                </div>
              </div>
              <button onClick={handleTutupModal} className="bg-white/10 hover:bg-white/20 text-stone-300 hover:text-white font-black text-sm p-2 rounded-full w-9 h-9 flex items-center justify-center transition-all">✕</button>
            </div>

            <div className="flex border-b border-stone-200 bg-stone-100 p-2 gap-2 sticky top-0 z-10">
              <button type="button" onClick={() => setSubjekFilterTab('siap_eksekusi')} className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${subjekFilterTab === 'siap_eksekusi' ? 'bg-orange-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-stone-50 border border-stone-200'}`}>
                ⚡ Siap Eksekusi FASIH <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${subjekFilterTab === 'siap_eksekusi' ? 'bg-orange-800 text-orange-100' : 'bg-stone-200 text-slate-600'}`}>{jumlahSiapEksekusi}</span>
              </button>
              <button type="button" onClick={() => setSubjekFilterTab('semua')} className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${subjekFilterTab === 'semua' ? 'bg-slate-800 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-stone-50 border border-stone-200'}`}>
                📂 Semua Data <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${subjekFilterTab === 'semua' ? 'bg-slate-950 text-slate-200' : 'bg-stone-200 text-slate-600'}`}>{jumlahSemua}</span>
              </button>
              <button type="button" onClick={() => setSubjekFilterTab('selesai')} className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${subjekFilterTab === 'selesai' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-stone-50 border border-stone-200'}`}>
                ✔ Selesai FASIH <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${subjekFilterTab === 'selesai' ? 'bg-emerald-800 text-emerald-100' : 'bg-stone-200 text-slate-600'}`}>{jumlahSelesai}</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto bg-stone-50/50 space-y-4 flex-1">
              {loadingModal ? (
                <div className="text-center py-16 text-xs font-bold text-stone-500 animate-pulse">
                  ⏳ Menarik data sampel detail subjek dari database (Meminimalkan Egress)...
                </div>
              ) : subjekSiapTampil.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-stone-300">
                  <p className="text-stone-400 font-bold text-sm">
                    {subjekFilterTab === 'siap_eksekusi' ? '🎉 Luar biasa! Tidak ada antrean data yang siap dieksekusi di sini.' : 'Tidak ada data sampel yang sesuai dengan kriteria filter.'}
                  </p>
                </div>
              ) : (
                subjekSiapTampil.map(subjek => (
                  <div key={subjek.assignment_id} className="bg-white rounded-xl border border-stone-200 shadow-3xs overflow-hidden">
                    <div className="bg-gradient-to-r from-stone-700 to-stone-500 border-b border-stone-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          {/* Label Ikon Kategori Kepala RT/Usaha */}
                          <span className="bg-white/10 text-stone-100 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border border-white/15 backdrop-blur-xs shadow-3xs">
                            🧑
                          </span>
                          <h4 className="font-black text-white text-sm sm:text-base tracking-tight drop-shadow-xs">
                            {subjek.nama_subjek}
                          </h4>
                                                    <span className="bg-stone-900/40 px-2 py-0.5 rounded font-mono font-bold text-amber-300 text-[11px] border border-stone-900/20">
                            ID: {subjek.assignment_id}
                          </span>
                        </div>
                        
                        {/* Meta metadata area dengan badge tersendiri */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-200/90 font-medium">

                          <div className="flex items-center gap-3 flex-wrap opacity-95">
                            <p className="flex items-center gap-1">Desa: <span className="text-white font-extrabold">{subjek.nmdesa}</span></p>
                            <p className="text-stone-400/80 hidden sm:inline">•</p>
                            <p className="flex items-center gap-1">SLS: <span className="text-white font-extrabold">{subjek.nmsls}</span></p>
                            <p className="text-stone-400/80 hidden sm:inline">•</p>
                            <p className="flex items-center gap-1">PCL: <span className="text-white font-extrabold">{subjek.nama_pcl}</span></p>
                          </div>
                        </div>
                      </div>
                      {subjek.link_fasih && (
                        <a href={subjek.link_fasih.replace('/assignment-detail/', '/assignment/fd68e454-ba45-4b85-8205-f3bf777ded24/') + '/edit'} target="_blank" rel="noreferrer" className="bg-stone-800 hover:bg-stone-900 text-white font-bold text-center px-3 py-1.5 rounded-lg text-xs shadow-3xs transition-colors shrink-0">Buka Dokumen FASIH ↗</a>
                      )}
                    </div>

                    <div className="divide-y divide-stone-100">
                      {subjek.detailAnomali.map(anomali => {
                        const isSelesaiFasih = anomali.status_fasih === 'Sudah Tindak Lanjut FASIH';
                        const belumAdaKeteranganLapangan = !anomali.catatan_lapangan || anomali.status_konfirmasi === 'Belum Tindak Lanjut';
                        const IsSiapEksekusi = !isSelesaiFasih && !belumAdaKeteranganLapangan;
                        const isPemicuUtama = anomali.kode === modalDetailObj.kodePemicu;

                        const handleCopyTeks = (id, teks) => {
                          if (!teks) return;
                          navigator.clipboard.writeText(teks);
                          setCopiedId(id);
                          setTimeout(() => setCopiedId(null), 2000);
                        };

                        return (
                          <div 
                            key={anomali.anomali_id} 
                            className={`p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 transition-colors ${
                              isPemicuUtama 
                                ? 'bg-amber-50/70 border-l-4 border-l-amber-600 shadow-xs ring-1 ring-amber-500/20' 
                                : IsSiapEksekusi 
                                  ? 'bg-orange-50/30 border-l-4 border-l-orange-400' 
                                  : isSelesaiFasih 
                                    ? 'bg-emerald-50/10 opacity-60' 
                                    : 'bg-white'
                            }`}
                          >
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs font-mono font-black px-2 py-0.5 rounded ${isSelesaiFasih ? 'bg-emerald-100 text-emerald-800 line-through' : 'bg-red-100 text-red-900'}`}>{anomali.kode}</span>
                                <span className="text-xs font-bold text-slate-700">{getInfoAnomali(anomali.kode, 'deskripsi')}</span>
                                
                                {isPemicuUtama ? (
                                  <span className="text-[9px] font-black bg-amber-700 text-white px-1.5 py-0.5 rounded shadow-3xs">ANOMALI DIPILIH</span>
                                ) : (
                                  <span className="text-[9px] font-black bg-stone-500 text-white px-1.5 py-0.5 rounded shadow-3xs">ANOMALI LAINNYA</span>
                                )}
                                
                                {anomali.status_konfirmasi === 'Sesuai Kondisi Lapangan' && <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md border border-emerald-200 shadow-3xs">🟢 Sesuai Kondisi Lapangan</span>}
                                {anomali.status_konfirmasi === 'Perlu Perbaikan Data' && <span className="text-[10px] font-extrabold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md border border-rose-200 shadow-3xs">🔴 Perlu Perbaikan Data</span>}
                                {IsSiapEksekusi && <span className="text-[9px] font-extrabold bg-amber-600 text-white px-1.5 py-0.5 rounded animate-pulse">SIAP VERIFIKASI</span>}
                              </div>

                              {anomali.catatan_lapangan ? (
                                <div className="p-2.5 bg-white border border-stone-200 rounded-lg text-xs text-slate-600 leading-relaxed shadow-3xs space-y-2">
                                  <div className="flex justify-between items-center border-b border-stone-100 pb-1">
                                    <span className="font-bold text-amber-900 text-[10px] block uppercase tracking-wide">Keterangan Lapangan ({anomali.kode}):</span>
                                    <button type="button" onClick={() => handleCopyTeks(anomali.anomali_id, anomali.catatan_lapangan)} className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all active:scale-95 ${copiedId === anomali.anomali_id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border-stone-300'}`}>{copiedId === anomali.anomali_id ? '📋 Tersalin!' : '📄 Salin Catatan'}</button>
                                  </div>
                                  <div className="italic text-slate-700 font-medium">"{anomali.catatan_lapangan}"</div>
                                </div>
                              ) : (
                                <p className="text-[11px] text-stone-400 font-semibold italic">⏳ Petugas lapangan belum memberikan konfirmasi untuk kode {anomali.kode}.</p>
                              )}
                            </div>

                            <div className="shrink-0 flex items-center md:items-end flex-row md:flex-col justify-between md:justify-start gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-stone-100">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isSelesaiFasih ? 'bg-emerald-100 text-emerald-800' : IsSiapEksekusi ? 'bg-amber-100 text-amber-900 font-extrabold' : 'bg-stone-100 text-stone-500'}`}>{isSelesaiFasih ? '✔ Selesai' : IsSiapEksekusi ? '⏳ Menunggu Anda' : '💤 Belum dikonfirmasi'}</span>
                              {IsSiapEksekusi && (
                                <button 
                                  type="button" 
                                  disabled={updatingId === anomali.anomali_id} 
                                  onClick={() => setKonfirmasiId(anomali.anomali_id)} 
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3 py-1.5 rounded-lg text-xs shadow-md transition-all active:scale-95"
                                >
                                  {updatingId === anomali.anomali_id ? 'Proses...' : '✔ Sudah FASIH'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 bg-stone-100 border-t border-stone-200 rounded-b-2xl flex justify-end">
              <button onClick={handleTutupModal} className="bg-white border border-stone-300 hover:bg-stone-50 text-slate-700 font-bold px-5 py-2 rounded-xl text-xs shadow-3xs transition-colors">Tutup Jendela</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI PERSETUJUAN */}
      {konfirmasiId && (
        <div className="fixed inset-0 bg-slate-950/70 z-40 flex items-center justify-center p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-xl border border-stone-200 p-5 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center gap-2.5 text-orange-600">
              <span className="text-xl">⚠️</span>
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">Konfirmasi Tindak Lanjut</h4>
            </div>
            
            <div className="space-y-2 text-xs leading-relaxed text-slate-600 font-medium">
              <p>Apakah Anda yakin ingin menandai anomali ini sebagai <strong className="text-emerald-700 font-bold">"Sudah Tindak Lanjut FASIH"</strong>?</p>
              <blockquote className="bg-orange-50 border-l-2 border-orange-400 p-2 rounded text-[11px] font-semibold text-orange-950 italic">
                Penting: Pastikan isian data dokumen pada aplikasi FASIH benar-benar telah ditindaklanjuti anomalinya.
              </blockquote>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-100 text-xs font-bold">
              <button
                type="button"
                onClick={() => setKonfirmasiId(null)}
                className="bg-stone-100 hover:bg-stone-200 text-slate-700 px-4 py-2 rounded-lg transition-colors border"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleSimpanFasihTunggal(konfirmasiId)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg shadow-sm transition-colors"
              >
                Ya, Saya Yakin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}