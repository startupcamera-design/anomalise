// src/pages/DashboardKantor.jsx
import React, { useState, useEffect } from 'react';
import { supabaseData } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx'; // pastikan sudah install: npm install xlsx

const DESKRIPSI_ANOMALI = {
  'U01': 'Biaya Produksi Dominan',
  'U02': 'Keuntungan Usaha',
  'U03': 'Bukan badan usaha tetapi ada penyertaan modal korporasi',
  'U04': 'Data Keuangan MBG',
  'U05': 'Hubungan Aset, Pekerja, dan Produksi Usaha',
  'U06': 'Usaha Menengah & Besar tanpa internet usaha',
  'U07': 'Usaha Menengah & Besar tidak memiliki laporan keuangan',
  'U08': 'Perbedaan KBLI 2 Digit Pendataan dan SBR',
  'K01': 'Status Cerai / Belum Kawin',
  'K02': 'Kepala Keluarga < 10 Th di Rumah Sendiri',
  'K03': 'Semua Anggota Keluarga Disabilitas',
  'K04': 'Luas lantai per kapita < 3 m2 atau > 200 m2',
  'K05': 'Selisih pendapatan dan pengeluaran negatif',
  'K06': 'Listrik Rendah & Ada Barang Mewah',
  'K07': 'Jumlah Anggota Keluarga Ekstrem',
};

export default function DashboardKantor() {
  const { profile: profilUser, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false); // State loading untuk excel
  
  // Data State
  const [rawAnomali, setRawAnomali] = useState([]);
  const [treeData, setTreeData] = useState([]);
  
  // UI Kontrol State
  const [expandedKec, setExpandedKec] = useState({});
  const [modalDetailObj, setModalDetailObj] = useState(null); 
  const [updatingId, setUpdatingId] = useState(null);

  // KPI Rapor Ringkasan
  const [summaryMetrics, setSummaryMetrics] = useState({
    totalAnomali: 0, sudahPcl: 0, belumPcl: 0, sudahFasih: 0, belumFasih: 0
  });

  const fetchDataMonitoringKantor = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseData
        .from('view_monitoring_anomali')
        .select('*');

      if (error) throw error;
      setRawAnomali(data || []);
      hitungMetrikGlobal(data || []);
      prosesStrukturAgregat(data || []);

      if (modalDetailObj) {
        const updatedTarget = data.filter(raw => 
          raw.kdkec === modalDetailObj.kdkec && 
          raw.pml_email === modalDetailObj.pml_email && 
          raw.kode_anomali === modalDetailObj.kode
        );
        setModalDetailObj(prev => ({ ...prev, daftarSampel: updatedTarget }));
      }
    } catch (err) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

useEffect(() => {
    const siapkanDataAwal = async () => {
      await fetchDataMonitoringKantor();
      setLoading(false); // 💡 Menutup loading screen setelah hitung agregat selesai
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
          total: 0, schonPcl: 0, sudahPcl: 0, belumPcl: 0, sudahFasih: 0, belumFasih: 0,
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
        kodeList: Object.values(p.kodeRows).sort((a,b) => a.kode.localeCompare(b.kode))
      })).sort((a,b) => a.namaPml.localeCompare(b.namaPml))
    }));

    finalTree.sort((a, b) => String(a.kodeKec).localeCompare(String(b.kodeKec), undefined, { numeric: true }));
    setTreeData(finalTree);
  };

  // --- LOGIKA UNGGUR & PARSING EXCEL ---
  const handleUploadExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(ws);

        if (rawData.length === 0) return alert('File Excel kosong!');

        // Proses Mapping & Konstruksi IDSUBSLS 16 Digit
        const formattedData = rawData.map((row, index) => {
          const normalizedRow = {};
          Object.keys(row).forEach((key) => {
            normalizedRow[key.toString().toLowerCase().replace(/[\s_/]/g, '')] = row[key];
          });

          // A. Deteksi Nama Anomali & Konversi ke Kode Singkat
          const namaAnomaliRaw = normalizedRow['namaanomali'] || '';
          let kodeAnomali = 'ERR'; 
          let kategori = 'USAHA';

          // Kelompok Usaha (Prefix U)
          if (namaAnomaliRaw.includes('Biaya Produksi Dominan')) kodeAnomali = 'U01';
          else if (namaAnomaliRaw.includes('Keuntungan Usaha')) kodeAnomali = 'U02';
          else if (namaAnomaliRaw.includes('penyertaan modal korporasi')) kodeAnomali = 'U03';
          else if (namaAnomaliRaw.includes('Keuangan MBG')) kodeAnomali = 'U04';
          else if (namaAnomaliRaw.includes('Aset, Pekerja, dan Produksi')) kodeAnomali = 'U05';
          else if (namaAnomaliRaw.includes('tanpa menggunakan internet')) kodeAnomali = 'U06';
          else if (namaAnomaliRaw.includes('tidak memiliki laporan keuangan')) kodeAnomali = 'U07';
          else if (namaAnomaliRaw.includes('KBLI 2 Digit')) kodeAnomali = 'U08';
          
          // Kelompok Keluarga (Prefix K)
          else if (namaAnomaliRaw.includes('Cerai / Belum Kawin')) { kodeAnomali = 'K01'; kategori = 'KELUARGA'; }
          else if (namaAnomaliRaw.includes('Kepala Keluarga < 10 Th')) { kodeAnomali = 'K02'; kategori = 'KELUARGA'; }
          else if (namaAnomaliRaw.includes('Anggota Keluarga Disabilitas')) { kodeAnomali = 'K03'; kategori = 'KELUARGA'; }
          else if (namaAnomaliRaw.includes('Luas lantai per kapita')) { kodeAnomali = 'K04'; kategori = 'KELUARGA'; }
          else if (namaAnomaliRaw.includes('Selisih pendapatan dan pengeluaran')) { kodeAnomali = 'K05'; kategori = 'KELUARGA'; }
          else if (namaAnomaliRaw.includes('Pengeluaran listrik sebulan')) { kodeAnomali = 'K06'; kategori = 'KELUARGA'; }
          else if (namaAnomaliRaw.includes('Jumlah Anggota Keluarga Ekstrem')) { kodeAnomali = 'K07'; kategori = 'KELUARGA'; }

          // B. Fleksibilitas Nama Subjek (Usaha / KRT)
          const namaSubjek = normalizedRow['namausaha'] || normalizedRow['namakrt'] || normalizedRow['namasubjek'] || 'Tanpa Nama';

          // C. KUNCI UTAMA: GENERATE AUTOMATIC 16-DIGIT IDSUBSLS
          // Format standard BPS: Prov (2) + Kab (2) + Kec (3) + Desa (3) + SLS (4) + SubSLS (2) = 16 Digit
          const prov = "33";
          const kab = "09";
          
          // Memastikan padding digit kode wilayah dari Excel aman (contoh: 30 menjadi 030, 5 menjadi 005)
          const kec = String(normalizedRow['kodekec'] || normalizedRow['kdkec'] || '').trim().padStart(3, '0');
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

        console.log("Memulai proses Bulk Upsert ke tabel anomali_data...", formattedData);

        // Kirim data ke tabel anomali_data (Aman dari duplicate berkat composite constraint key)
        const { error } = await supabaseData
          .from('anomali_data')
          .upsert(formattedData, { 
            onConflict: 'assignment_id, kode_anomali', 
            ignoreDuplicates: true 
          });

        if (error) throw error;

        alert(`Berhasil memproses & mengimpor ${formattedData.length} rekord data anomali baru secara relasional!`);
        
        // Panggil fungsi fetch data monitoring kantor untuk menyegarkan tabel
        if (typeof fetchSemuaAnomali === 'function') fetchSemuaAnomali();
        
      } catch (err) {
        console.error(err);
        alert('Gagal mengimpor data anomali. Pastikan kode wilayah (Kec/Desa/SLS) di Excel terdaftar di master muatan_sls! Detail Error: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleDirectSimpanFasih = async (anomaliId, catatanLpg, statusKonf) => {
    setUpdatingId(anomaliId);
    try {
      const { error } = await supabaseData
        .from('tindak_lanjut_anomali')
        .upsert({
          anomali_id: anomaliId,
          status_konfirmasi: statusKonf,
          catatan_lapangan: catatanLpg,
          status_fasih: 'Sudah Tindak Lanjut FASIH',
          dieksekusi_oleh_email: profilUser?.email,
          waktu_eksekusi_fasih: new Date().toISOString()
        }, { onConflict: 'anomali_id' });

      if (error) throw error;
      
      const { data: updatedData } = await supabaseData.from('view_monitoring_anomali').select('*');
      if (updatedData) {
        setRawAnomali(updatedData);
        hitungMetrikGlobal(updatedData);
        prosesStrukturAgregat(updatedData);

        if (modalDetailObj) {
          const freshSampel = updatedData.filter(raw => 
            raw.kdkec === modalDetailObj.kdkec && 
            raw.pml_email === modalDetailObj.pml_email && 
            raw.kode_anomali === modalDetailObj.kode
          );
          setModalDetailObj(prev => ({ ...prev, daftarSampel: freshSampel }));
        }
      }
    } catch (err) {
      alert('Gagal: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleBukaModalDetail = (itemObj, namaKec) => {
    const daftarSampel = rawAnomali.filter(raw => 
      raw.kdkec === itemObj.kdkec && 
      (raw.nama_pml === itemObj.namaPml || raw.pml_email === itemObj.pml_email) && 
      raw.kode_anomali === itemObj.kode
    );

    setModalDetailObj({
      ...itemObj,
      namaKec: namaKec,
      daftarSampel: daftarSampel
    });
  };

  const toggleExpandKec = (kecName) => {
    setExpandedKec(prev => ({ ...prev, [kecName]: !prev[kecName] }));
  };

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
        
        {/* WIDGET KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
            <span className="text-stone-400 text-[10px] font-bold block uppercase tracking-wider">Total Anomali</span>
            <span className="text-2xl font-black text-slate-800 mt-1 block font-mono">{summaryMetrics.totalAnomali}</span>
          </div>
          <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/50 shadow-2xs">
            <span className="text-amber-800/80 text-[10px] font-bold block uppercase tracking-wider">Sudah Konfirmasi Petugas</span>
            <span className="text-2xl font-black text-amber-700 mt-1 block font-mono">{summaryMetrics.sudahPcl}</span>
          </div>
          <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-200/50 shadow-2xs">
            <span className="text-emerald-800/80 text-[10px] font-bold block uppercase tracking-wider">Sudah Tindak Lanjut Fasih</span>
            <span className="text-2xl font-black text-emerald-700 mt-1 block font-mono">{summaryMetrics.sudahFasih}</span>
          </div>
          <div className="bg-orange-50 border-2 border-orange-400/80 p-4 rounded-xl shadow-xs">
            <span className="text-orange-900 text-[10px] font-black block uppercase tracking-wider animate-pulse">Belum Tindak Lanjut Fasih</span>
            <span className="text-3xl font-black text-orange-700 mt-1 block font-mono">{summaryMetrics.belumFasih}</span>
          </div>
        </div>

        {/* TABEL AGREGAT UTAMA */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-2xs overflow-hidden">
          <div className="p-4 bg-stone-50 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Rekap Anomali</h2>
            
            {/* AREA UTILITY: TOMBOL REFRESH & IMPOR EXCEL */}
            <div className="flex flex-wrap items-center gap-2">
              <label className={`cursor-pointer inline-flex items-center gap-1.5 bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs hover:bg-amber-600 shadow-3xs transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <span>{uploading ? '⏳ Memproses...' : '📁 Impor Excel'}</span>
                <input 
                  type="file" 
                  accept=".xlsx, .xls" 
                  onChange={handleUploadExcel} 
                  className="hidden" 
                  disabled={uploading}
                />
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
                                className={`text-xs border-b border-stone-100 transition-colors cursor-pointer select-none ${
                                  adaAntreanFasih ? 'bg-orange-50/40 hover:bg-orange-50' : 'hover:bg-stone-50/50 text-slate-500'
                                }`}
                              >
                                <td className="p-2.5 pl-20 font-medium truncate flex items-center gap-1.5">
                                  <span className="text-slate-300 font-bold">└</span>
                                  {adaAntreanFasih && (
                                    <span className="bg-orange-600 text-white font-black text-[8px] px-1.5 py-0.2 rounded-md animate-pulse tracking-wide shrink-0">BUTUH INPUT</span>
                                  )}
                                  <span className={adaAntreanFasih ? 'font-bold text-slate-900' : ''}>{DESKRIPSI_ANOMALI[item.kode] || item.kode}</span>
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

      {/* ==========================================================
          MODAL DETAIL RUMAH TANGGA & SINKRONISASI FASIH
          ========================================================== */}
      {modalDetailObj && (
        <div className="fixed inset-0 bg-slate-950/60 z-30 flex items-center justify-center p-6 animate-fade-in backdrop-blur-xs">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] border border-stone-200 animate-scale-up">
            
            <div className="p-5 bg-gradient-to-r from-stone-900 to-stone-800 text-stone-100 rounded-t-2xl flex justify-between items-center shadow-xs">
              <div className="space-y-0.5">
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Detail Status Anomali</span>
                <h3 className="text-base font-extrabold text-white">Kecamatan {modalDetailObj.namaKec} • PML: {modalDetailObj.namaPml}</h3>
                <p className="text-xs text-stone-300">
                  Jenis Anomali: <span className="bg-amber-500/20 text-amber-300 font-mono font-bold px-1.5 py-0.2 rounded border border-amber-500/30">[{modalDetailObj.kode}] {DESKRIPSI_ANOMALI[modalDetailObj.kode]}</span>
                </p>
              </div>
              <button 
                onClick={() => setModalDetailObj(null)} 
                className="bg-white/10 hover:bg-white/20 text-stone-300 hover:text-white font-black text-sm p-2 rounded-full w-9 h-9 flex items-center justify-center transition-all"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto bg-stone-50/50 space-y-3 flex-1">
              {modalDetailObj.daftarSampel.length === 0 ? (
                <div className="text-center py-12 text-stone-400 font-medium">Tidak ada sampel data di bawah kombinasi wilayah ini.</div>
              ) : (
                modalDetailObj.daftarSampel.map(sampel => {
                  const lpgBelumSelesai = sampel.status_konfirmasi === 'Belum Tindak Lanjut';
                  const fasihSelesai = sampel.status_fasih === 'Sudah Tindak Lanjut FASIH';
                  
                  return (
                    <div 
                      key={sampel.anomali_id} 
                      className={`bg-white rounded-xl border border-stone-200 p-4 shadow-3xs flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 transition-all ${
                        !fasihSelesai && !lpgBelumSelesai ? 'border-l-4 border-l-orange-500 bg-orange-50/20' : 'border-l-4 border-l-stone-300'
                      }`}
                    >
                      <div className="space-y-2 max-w-2xl flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-black text-slate-900 text-sm sm:text-base">🧑 {sampel.nama_subjek}</h4>
                          <span className="text-[10px] bg-stone-100 font-mono text-slate-500 px-2 py-0.5 rounded border">ID: {sampel.assignment_id}</span>
                        </div>
                        
                        <div className="text-xs text-slate-500 font-medium flex flex-wrap gap-x-4 gap-y-1">
                          <p>SLS: <span className="text-slate-700 font-bold">{sampel.nmsls}</span></p>
                          <p>Desa: <span className="text-slate-700 font-bold">{sampel.nmdesa}</span></p>
                          <p>Pencacah (PCL): <span className="text-slate-700 font-bold">{sampel.nama_pcl || sampel.pcl_email}</span></p>
                        </div>
                        
                        {sampel.catatan_lapangan ? (
                          <div className="p-3 bg-stone-50 border border-stone-200/80 rounded-lg text-xs text-slate-600 font-medium leading-relaxed">
                            <span className="font-extrabold text-amber-900 text-[9px] block mb-1 uppercase tracking-wider">Hasil Konfirmasi Lapangan PCL/PML:</span>
                            "{sampel.catatan_lapangan}"
                          </div>
                        ) : (
                          <p className="text-[11px] text-red-500 font-semibold italic">⚠️ Petugas lapangan belum memberikan konfirmasi di aplikasi mobile.</p>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-row lg:flex-col items-center lg:items-end gap-3 justify-between pt-3 lg:pt-0 border-t lg:border-t-0 border-stone-100">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            lpgBelumSelesai ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}>
                            Konfirmasi Petugas: {lpgBelumSelesai ? 'Belum' : 'Sudah'}
                          </span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${
                            fasihSelesai ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-orange-100 text-orange-800 border-orange-200'
                          }`}>
                            Status FASIH: {fasihSelesai ? 'KONFIRMASI' : 'BELUM'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {sampel.link_fasih && (
                            <a 
                              href={sampel.link_fasih} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="bg-stone-800 hover:bg-stone-900 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs shadow-3xs transition-colors flex items-center"
                            >
                              Buka FASIH ↗
                            </a>
                          )}
                          
                          {!fasihSelesai && !lpgBelumSelesai && (
                            <button
                              type="button"
                              disabled={updatingId === sampel.anomali_id}
                              onClick={() => {
                                const yakin = window.confirm(`Apakah Anda yakin data FASIH untuk "${sampel.nama_subjek}" sudah diedit/sesuai dan ingin menandainya sebagai Selesai?`);
                                if (yakin) {
                                  handleDirectSimpanFasih(sampel.anomali_id, sampel.catatan_lapangan, sampel.status_konfirmasi);
                                }
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3.5 py-1.5 rounded-lg text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                              {updatingId === sampel.anomali_id ? 'Proses...' : '✔ Selesai FASIH'}
                            </button>
                          )}
                        </div>
                      </div>

                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 bg-stone-100 border-t border-stone-200 rounded-b-2xl flex justify-end">
              <button 
                onClick={() => setModalDetailObj(null)} 
                className="bg-white border border-stone-300 hover:bg-stone-50 text-slate-700 font-bold px-5 py-2 rounded-xl text-xs shadow-3xs transition-colors"
              >
                Tutup Jendela
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}