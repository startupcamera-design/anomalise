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
  // Data State
  const [masterAnomali, setMasterAnomali] = useState([]);
  const [treeData, setTreeData] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  
  // UI Kontrol State
  const [expandedKec, setExpandedKec] = useState({});
  const [modalDetailObj, setModalDetailObj] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [loadingModal, setLoadingModal] = useState(false);
const [konfirmasiId, setKonfirmasiId] = useState(null);
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
      // HEMAT EGRESS: Hanya ambil kolom yang dibutuhkan untuk validasi excel & deskripsi
      const { data, error } = await supabaseData
        .from('master_anomali')
        .select('kode, deskripsi, aturan_teknis, kata_kunci, kategori');
      if (error) throw error;
      setMasterAnomali(data || []);
    } catch (err) {
      console.error('Gagal memuat aturan master anomali:', err.message);
    }
  };

  // 1. FUNGSI UTAMA BARU: Hanya mengambil kolom ringkas untuk agregasi tree utama
  const fetchDataMonitoringKantor = async () => {
    setLoading(true);
    try {
      // HEMAT EGRESS EXTREME: Membatasi kolom * ke kolom struktural esensial saja.
      // Kolom berat seperti `catatan_lapangan`, `nama_subjek`, `link_fasih` DITINGGALKAN dari query ini.
      const { data, error } = await supabaseData
        .from('view_monitoring_anomali')
        .select('kdkec, nmkec, nama_pml, pml_email, kode_anomali, status_konfirmasi, status_fasih');

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
      const pmlKey = item.nama_pml || item.pml_email || 'TANPA PML';
      const pmlEmailKey = item.pml_email || 'no-email';
      const kodeKey = item.kode_anomali || 'ERR';

      if (!kecMap[kecKey]) {
        kecMap[kecKey] = { kodeKec: kecKey, namaKec: namaKecamatannya, pmlRows: {} };
      }

      if (!kecMap[kecKey].pmlRows[pmlKey]) {
        kecMap[kecKey].pmlRows[pmlKey] = { namaPml: pmlKey, emailPml: pmlEmailKey, kodeRows: {} };
      }

      if (!kecMap[kecKey].pmlRows[pmlKey].kodeRows[kodeKey]) {
        kecMap[kecKey].pmlRows[pmlKey].kodeRows[kodeKey] = {
          kode: kodeKey,
          total: 0, sudahPcl: 0, belumPcl: 0, sudahFasih: 0, belumFasih: 0,
          kdkec: kecKey,
          pml_email: pmlEmailKey,
          namaPml: pmlKey
        };
      }

      const targetKode = kecMap[kecKey].pmlRows[pmlKey].kodeRows[kodeKey];
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
      pmlList: Object.values(k.pmlRows).map(p => ({
        ...p,
        kodeList: Object.values(p.kodeRows).sort((a, b) => a.kode.localeCompare(b.kode))
      })).sort((a, b) => a.namaPml.localeCompare(b.namaPml))
    }));

    finalTree.sort((a, b) => String(a.kodeKec).localeCompare(String(b.kodeKec), undefined, { numeric: true }));
    setTreeData(finalTree);
  };

  const handleUploadExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(ws);

        if (rawData.length === 0) {
          setUploading(false);
          return alert('File Excel kosong!');
        }

        const formattedData = rawData.map((row, index) => {
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

          return {
            idsubsls: generatedIdSubSls,
            assignment_id: String(normalizedRow['assignmentid'] || normalizedRow['assignment_id'] || `GEN-${Date.now()}-${index}`),
            nama_subjek: namaSubjek,
            kode_anomali: kodeAnomali,
            kategori_anomali: kategori,
            link_fasih: normalizedRow['linkfasih'] || normalizedRow['link_fasih'] || '',
          };
        });

        const { error } = await supabaseData
          .from('anomali_data')
          .upsert(formattedData, {
            onConflict: 'assignment_id, kode_anomali',
            ignoreDuplicates: true
          });

        if (error) throw error;
        alert(`Berhasil memproses & mengimpor ${formattedData.length} rekord data anomali baru!`);
        fetchDataMonitoringKantor();

      } catch (err) {
        console.error(err);
        alert('Gagal mengimpor data anomali: ' + err.message);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  // 2. MODIFIKASI UTAMA: Ambil data detail via Supabase HANYA saat baris di-klik (Lazy Loading)
  const handleBukaModalDetail = async (itemObj, namaKec) => {
    setSubjekFilterTab('siap_eksekusi');
    setLoadingModal(true);
    
    // Simpan juga kode yang di-klik ke state agar kita bisa memberi highlight di dalam modal
    setModalDetailObj({ ...itemObj, namaKec: namaKec, kodePemicu: itemObj.kode, daftarSubjek: [] });

    try {
      // PENGATURAN BARU: Hapus filter .eq('kode_anomali', itemObj.kode)
      // Agar semua anomali dengan assignment_id yang sama ikut ketarik
      const { data: sampelTarget, error } = await supabaseData
        .from('view_monitoring_anomali')
        .select('anomali_id, assignment_id, nama_subjek, nmdesa, nmsls, nama_pcl, pcl_email, link_fasih, kode_anomali, status_konfirmasi, catatan_lapangan, status_fasih')
        .eq('kdkec', itemObj.kdkec)
        .eq('pml_email', itemObj.pml_email); // Menarik semua kode untuk subjek di wilayah PML ini

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
          // Ini akan menampung semua baris anomali yang dimiliki assignment_id tersebut
          detailAnomali: semuaAnomaliSubjek.map(a => ({
            anomali_id: a.anomali_id,
            kode: a.kode_anomali,
            status_konfirmasi: a.status_konfirmasi,
            catatan_lapangan: a.catatan_lapangan,
            status_fasih: a.status_fasih,
          }))
        };
      });

      // Opsional: Filter grupBerdasarkanSubjek agar hanya memuat subjek yang minimal mempunyai kodePemicu tersebut
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

  // 3. OPTIMALISASI AKSI: Mengubah data lokal tanpa hit ulang API Global Supabase (*Zero Egress Refresh*)
const handleSimpanFasihTunggal = async (anomaliId) => {
    setUpdatingId(anomaliId);
    setKonfirmasiId(null); // Tutup modal konfirmasi setelah disetujui
    try {
      const payload = {
        anomali_id: anomaliId,
        status_fasih: 'Sudah Tindak Lanjut FASIH',
        dieksekusi_oleh_email: profilUser?.email,
        waktu_eksekusi_fasih: new Date().toISOString()
      };

      const { error } = await supabaseData
        .from('tindak_lanjut_anomali')
        .upsert(payload, { onConflict: 'anomali_id' });

      if (error) throw error;

      // --- OPTIMALISASI ZERO-EGRESS LOCAL STATE UPDATE ---
      const kodeAnomaliTerupdate = modalDetailObj.daftarSubjek
        .flatMap(s => s.detailAnomali)
        .find(a => a.anomali_id === anomaliId)?.kode;

      setTreeData(prevTree => {
        return prevTree.map(kec => {
          if (kec.namaKec !== modalDetailObj.namaKec) return kec;
          return {
            ...kec,
            pmlList: kec.pmlList.map(pml => {
              if (pml.emailPml !== modalDetailObj.pml_email) return pml;
              return {
                ...pml,
                kodeList: pml.kodeList.map(item => {
                  if (item.kode !== kodeAnomaliTerupdate) return item;
                  return {
                    ...item,
                    sudahFasih: item.sudahFasih + 1,
                    belumFasih: Math.max(0, item.belumFasih - 1)
                  };
                })
              };
            })
          };
        });
      });

      setSummaryMetrics(prev => ({
        ...prev,
        sudahFasih: prev.sudahFasih + 1,
        belumFasih: Math.max(0, prev.belumFasih - 1)
      }));

      if (modalDetailObj) {
        const grupTerbaru = modalDetailObj.daftarSubjek.map(subjek => {
          return {
            ...subjek,
            detailAnomali: subjek.detailAnomali.map(anomali => {
              if (anomali.anomali_id === anomaliId) {
                return { ...anomali, status_fasih: 'Sudah Tindak Lanjut FASIH' };
              }
              return anomali;
            })
          };
        });
        setModalDetailObj(prev => ({ ...prev, daftarSubjek: grupTerbaru }));
      }
      
    } catch (err) {
      alert('Gagal memperbarui status: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleExpandKec = (kecName) => {
    setExpandedKec(prev => ({ ...prev, [kecName]: !prev[kecName] }));
  };

  // Logic Filtering Modal Tetap Sama
  const semuaSubjekModal = modalDetailObj?.daftarSubjek || [];
  const jumlahSiapEksekusi = semuaSubjekModal.filter(subjek => 
    subjek.detailAnomali.some(a => a.status_fasih !== 'Sudah Tindak Lanjut FASIH' && a.status_konfirmasi !== 'Belum Tindak Lanjut' && a.catatan_lapangan)
  ).length;
  const jumlahSelesai = semuaSubjekModal.filter(subjek => subjek.detailAnomali.every(a => a.status_fasih === 'Sudah Tindak Lanjut FASIH')).length;
  const jumlahSemua = semuaSubjekModal.length;

  const subjekTersaring = semuaSubjekModal.filter(subjek => {
    const isSelesaiSemua = subjek.detailAnomali.every(a => a.status_fasih === 'Sudah Tindak Lanjut FASIH');
    const adaSiapEksekusi = subjek.detailAnomali.some(a => a.status_fasih !== 'Sudah Tindak Lanjut FASIH' && a.status_konfirmasi !== 'Belum Tindak Lanjut' && a.catatan_lapangan);

    if (subjekFilterTab === 'siap_eksekusi') return adaSiapEksekusi && !isSelesaiSemua;
    if (subjekFilterTab === 'selesai') return isSelesaiSemua;
    return true;
  });

  const subjekSiapTampil = [...subjekTersaring].sort((a, b) => {
    const aAdaKeterangan = a.detailAnomali.some(an => an.catatan_lapangan && an.status_fasih !== 'Sudah Tindak Lanjut FASIH');
    const bAdaKeterangan = b.detailAnomali.some(an => an.catatan_lapangan && an.status_fasih !== 'Sudah Tindak Lanjut FASIH');
    if (aAdaKeterangan && !bAdaKeterangan) return -1;
    if (!aAdaKeterangan && bAdaKeterangan) return 1;
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
  {/* Card 1: Total Anomali */}
  <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
    <span className="text-stone-400 text-[10px] font-bold block uppercase tracking-wider">Total Anomali</span>
    <span className="text-2xl font-black text-slate-800 mt-1 block font-mono">
      {summaryMetrics.totalAnomali}
    </span>
    <span className="text-[10px] text-stone-500 font-medium mt-1 block">
      Basis data anomali masuk
    </span>
  </div>

  {/* Card 2: Sudah Konfirmasi Petugas (PCL) */}
  <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/50 shadow-2xs">
    <span className="text-amber-800/80 text-[10px] font-bold block uppercase tracking-wider">Sudah Konfirmasi Petugas</span>
    <div className="flex items-baseline justify-between mt-1">
      <span className="text-2xl font-black text-amber-700 font-mono">{summaryMetrics.sudahPcl}</span>
      <span className="text-xs font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-sm font-mono">
        {hitungPersen(summaryMetrics.sudahPcl, summaryMetrics.totalAnomali)}
      </span>
    </div>
    <span className="text-[10px] text-amber-900/60 font-medium mt-1 block">
      Dari total beban anomali
    </span>
  </div>

  {/* Card 3: Sudah Tindak Lanjut FASIH */}
  <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-200/50 shadow-2xs">
    <span className="text-emerald-800/80 text-[10px] font-bold block uppercase tracking-wider">Sudah Tindak Lanjut Fasih</span>
    <div className="flex items-baseline justify-between mt-1">
      <span className="text-2xl font-black text-emerald-700 font-mono">{summaryMetrics.sudahFasih}</span>
      <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-sm font-mono">
        {hitungPersen(summaryMetrics.sudahFasih, summaryMetrics.totalAnomali)}
      </span>
    </div>
    <span className="text-[10px] text-emerald-900/60 font-medium mt-1 block">
      Selesai diverifikasi oleh kantor
    </span>
  </div>

  {/* Card 4: Belum Tindak Lanjut Fasih (Antrean Kantor) */}
  <div className="bg-orange-50 border-2 border-orange-400/80 p-4 rounded-xl shadow-xs">
    <span className="text-orange-900 text-[10px] font-black block uppercase tracking-wider animate-pulse">Belum Tindak Lanjut Fasih</span>
    <div className="flex items-baseline justify-between mt-1">
      <span className="text-3xl font-black text-orange-700 font-mono">{summaryMetrics.belumFasih}</span>
      <span className="text-xs font-black text-orange-950 bg-orange-200 px-1.5 py-0.5 rounded-sm font-mono">
        {/* Rasio sisa antrean kantor dibanding total anomali yang sudah dilaporkan PCL */}
        {hitungPersen(summaryMetrics.belumFasih, summaryMetrics.sudahPcl)}
      </span>
    </div>
    <span className="text-[10px] text-orange-900/70 font-medium mt-1 block">
      Rasio antrean dari konfirmasi PCL
    </span>
  </div>
</div>

        {/* TABEL AGREGAT UTAMA */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-stone-50 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Rekap Anomali</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`cursor-pointer inline-flex items-center gap-1.5 bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs hover:bg-amber-600 shadow-3xs transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <span>{uploading ? '⏳ Memproses...' : '📁 Impor Excel'}</span>
                <input type="file" accept=".xlsx, .xls" onChange={handleUploadExcel} className="hidden" disabled={uploading} />
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

                  kec.pmlList.forEach(p => {
                    p.kodeList.forEach(c => {
                      kecTotal += c.total; kecSudahPcl += c.sudahPcl; kecBelumPcl += c.belumPcl;
                      kecSudahF += c.sudahFasih; kecBelumF += c.belumFasih;
                    });
                  });

                  return (
                    <React.Fragment key={kec.kodeKec}>
                      <tr onClick={() => toggleExpandKec(kec.namaKec)} className="bg-stone-50/80 hover:bg-amber-50/20 font-bold text-slate-900 cursor-pointer transition-colors border-b border-stone-200">
                        <td className="p-3 pl-6"><span className="text-amber-700 mr-2">{isKecOpen ? '▼' : '▶'}</span>🗺️ [{kec.kodeKec}] KEC. {kec.namaKec}</td>
                        <td className="p-3 text-center text-stone-300">-</td>
                        <td className="p-3 text-center font-mono">{kecTotal}</td>
                        <td className="p-3 text-center bg-amber-50/10 font-mono text-amber-700">{kecSudahPcl}</td>
                        <td className="p-3 text-center bg-amber-50/10 font-mono text-orange-600 border-r border-stone-200/60">{kecBelumPcl}</td>
                        <td className="p-3 text-center bg-emerald-50/5 font-mono text-emerald-700">{kecSudahF}</td>
                        <td className="p-3 text-center bg-orange-50/10 font-mono text-orange-700">{kecBelumF}</td>
                      </tr>

                      {isKecOpen && kec.pmlList.map(pml => (
                        <React.Fragment key={pml.namaPml}>
                          <tr className="bg-white font-semibold text-slate-800 border-b border-stone-100">
                            <td className="p-2.5 pl-12 text-slate-800">👔 Pengawas (PML): <span className="font-bold text-amber-900">{pml.namaPml}</span></td>
                            <td colSpan="6" className="p-2.5 text-stone-400 text-[10px] font-mono italic">{pml.emailPml}</td>
                          </tr>

                          {pml.kodeList.map(item => {
                            const adaAntreanFasih = item.belumFasih > 0;
                            return (
                              <tr
                                key={item.kode}
                                onClick={() => handleBukaModalDetail(item, kec.namaKec)}
                                className={`text-xs border-b border-stone-100 transition-colors cursor-pointer select-none ${adaAntreanFasih ? 'bg-orange-50/40 hover:bg-orange-50' : 'hover:bg-stone-50/50 text-slate-500'}`}
                              >
                                <td className="p-2.5 pl-20 font-medium truncate flex items-center gap-1.5">
                                  <span className="text-slate-300 font-bold">└</span>
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
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL DETAIL SUBJEK & SINKRONISASI FASIH */}
      {modalDetailObj && (
        <div className="fixed inset-0 bg-slate-950/60 z-30 flex items-center justify-center p-6 animate-fade-in backdrop-blur-xs">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] border border-stone-200 animate-scale-up">
            
            {/* STICKY DI ATAS: JUDUL MODAL */}
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
              <button onClick={() => setModalDetailObj(null)} className="bg-white/10 hover:bg-white/20 text-stone-300 hover:text-white font-black text-sm p-2 rounded-full w-9 h-9 flex items-center justify-center transition-all">✕</button>
            </div>

            {/* QUICK FILTERS */}
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

            {/* BODY SCROLL CONTENT: DAFTAR KARTU SUBJEK */}
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
                    {/* HEADER KARTU */}
                    <div className="bg-stone-50 border-b border-stone-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">🧑 {subjek.nama_subjek}</h4>
                          <span className="text-[10px] bg-white font-mono text-slate-500 px-2 py-0.5 rounded border">ID: {subjek.assignment_id}</span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                          <p>Desa: <span className="text-slate-700 font-bold">{subjek.nmdesa}</span></p>
                          <p>SLS: <span className="text-slate-700 font-bold">{subjek.nmsls}</span></p>
                          <p>PCL: <span className="text-slate-700 font-bold">{subjek.nama_pcl}</span></p>
                        </div>
                      </div>
                      {subjek.link_fasih && (
                        <a href={subjek.link_fasih.replace('/assignment-detail/', '/assignment/fd68e454-ba45-4b85-8205-f3bf777ded24/') + '/edit'} target="_blank" rel="noreferrer" className="bg-stone-800 hover:bg-stone-900 text-white font-bold text-center px-3 py-1.5 rounded-lg text-xs shadow-3xs transition-colors shrink-0">Buka Dokumen FASIH ↗</a>
                      )}
                    </div>

                    {/* LIST ANOMALI DI DALAMNYA */}
                    <div className="divide-y divide-stone-100">
{subjek.detailAnomali.map(anomali => {
    const isSelesaiFasih = anomali.status_fasih === 'Sudah Tindak Lanjut FASIH';
    const belumAdaKeteranganLapangan = !anomali.catatan_lapangan || anomali.status_konfirmasi === 'Belum Tindak Lanjut';
    const IsSiapEksekusi = !isSelesaiFasih && !belumAdaKeteranganLapangan;
    
    // PENGATURAN BARU: Deteksi apakah baris ini adalah kode spesifik yang di-klik user di tabel utama
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
            ? 'bg-amber-50/70 border-l-4 border-l-amber-600 shadow-xs ring-1 ring-amber-500/20' // Highlight khusus untuk kode pemicu klik
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
            
            {/* PENGATURAN BARU: Badge penanda asal klik */}
            {!isPemicuUtama && <span className="text-[9px] font-black bg-amber-700 text-white px-1.5 py-0.5 rounded shadow-3xs">ANOMALI LAINNYA</span>}
            
            {anomali.status_konfirmasi === 'Sesuai Kondisi Lapangan' && <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md border border-emerald-200 shadow-3xs">🟢 Sesuai Kondisi Lapangan</span>}
            {anomali.status_konfirmasi === 'Perlu Perbaikan Data' && <span className="text-[10px] font-extrabold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md border border-rose-200 shadow-3xs">🔴 Perlu Perbaikan Data</span>}
            {IsSiapEksekusi && <span className="text-[9px] font-extrabold bg-amber-600 text-white px-1.5 py-0.5 rounded animate-pulse">SIAP VERIFIKASI</span>}
          </div>

          {/* Sisa kode detail catatan lapangan dan tombol verifikasi ke bawah tetap sama... */}
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
    onClick={() => setKonfirmasiId(anomali.anomali_id)} // Mengaktifkan modal konfirmasi
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

            {/* FOOTER */}
            <div className="p-4 bg-stone-100 border-t border-stone-200 rounded-b-2xl flex justify-end">
              <button onClick={() => setModalDetailObj(null)} className="bg-white border border-stone-300 hover:bg-stone-50 text-slate-700 font-bold px-5 py-2 rounded-xl text-xs shadow-3xs transition-colors">Tutup Jendela</button>
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