// src/pages/DashboardLapangan.jsx
import React, { useState, useEffect } from 'react';
import { supabaseData } from '../lib/supabase'; 
import { useAuth } from '../context/AuthContext'; 

export default function DashboardLapangan() {
  const { profile: profilUser, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [showPanduanModal, setShowPanduanModal] = useState(true);

  // DATA REFERENSI ATURAN
  const [masterAnomali, setMasterAnomali] = useState([]);

  // Data Hirarki Lapangan
  const [daftarPclAgregat, setDaftarPclAgregat] = useState([]); 
  const [selectedPcl, setSelectedPcl] = useState(null);       
  const [daftarSls, setDaftarSls] = useState([]);              
  const [selectedSls, setSelectedSls] = useState(null);         
  const [daftarAnomaliRuta, setDaftarAnomaliRuta] = useState([]);

  // Form Input Modal Justifikasi
  const [editingAnomali, setEditingAnomali] = useState(null); 
  const [statusKonfirmasiForm, setStatusKonfirmasiForm] = useState('Sesuai Kondisi Lapangan');
  const [catatanLapanganForm, setCatatanLapanganForm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const formatTanggalIndo = (stringTanggal) => {
    if (!stringTanggal || stringTanggal === '0000-00-00') return "-";
    const opsi = { day: '2-digit', month: 'short' };
    return new Date(stringTanggal).toLocaleDateString('id-ID', opsi);
  };

  const getInfoAnomali = (kode, tipe = 'deskripsi') => {
    const target = masterAnomali.find(a => a.kode === kode);
    if (!target) return kode;
    return tipe === 'deskripsi' ? target.deskripsi : target.aturan_teknis;
  };

  const fetchMasterAnomali = async () => {
    try {
      const { data, error } = await supabaseData
        .from('master_anomali')
        .select('kode, deskripsi, aturan_teknis');
      if (error) throw error;
      setMasterAnomali(data || []);
    } catch (err) {
      console.error('Gagal memuat aturan master anomali:', err.message);
    }
  };

  // --- 1. AMBIL DAFTAR PCL AGREGAT (UNTUK PML) ---
  const loadDaftarPclAgregat = async (pmlEmail) => {
    setLoading(true);
    try {
      const { data: pclData, error: pclErr } = await supabaseData
        .from('petugas')
        .select('email, nama_petugas, posisi_tugas')
        .eq('id_pml_atasan', pmlEmail);

      if (pclErr) throw pclErr;
      if (!pclData || pclData.length === 0) {
        setDaftarPclAgregat([]);
        setLoading(false);
        return;
      }

      const listPclEmails = pclData.map(p => p.email);

      const { data: slsData } = await supabaseData
        .from('muatan_sls')
        .select('idsubsls, petugas_id')
        .in('petugas_id', listPclEmails);

      const { data: anomaliData } = await supabaseData
        .from('view_monitoring_anomali')
        .select('idsubsls, status_konfirmasi, pml_email, assignment_id, kode_anomali, tanggal_snapshot')
        .eq('pml_email', pmlEmail);

      const mappedPcl = pclData.map(pcl => {
        const slsOwns = slsData ? slsData.filter(s => s.petugas_id === pcl.email).map(s => s.idsubsls) : [];
        const anomaliOwns = anomaliData ? anomaliData.filter(a => slsOwns.includes(a.idsubsls)) : [];
        
        // UNIKKAN PENGHITUNGAN BEBAN: Hitung per kelompok masalah unik (assignment_id + kode) bukan total record snapshot
        const kunciUnikSet = new Set(anomaliOwns.map(a => `${a.assignment_id}_${a.kode_anomali}`));
        const totalMasalahUnik = kunciUnikSet.size;

        // Hitung yang belum tuntas dikonfirmasi pada kelompok masalah unik tersebut
        let belumSelesaiUnik = 0;
        kunciUnikSet.forEach(kunci => {
          const barisTerkait = anomaliOwns.filter(a => `${a.assignment_id}_${a.kode_anomali}` === kunci);
          const adaYangBelum = barisTerkait.some(b => b.status_konfirmasi === 'Belum Tindak Lanjut');
          if (adaYangBelum) belumSelesaiUnik++;
        });

        return {
          ...pcl,
          totalBeban: totalMasalahUnik,
          belumSelesai: belumSelesaiUnik,
          sudahSelesai: Math.max(0, totalMasalahUnik - belumSelesaiUnik),
          jumlahSls: slsOwns.length
        };
      });

      mappedPcl.sort((a, b) => b.belumSelesai - a.belumSelesai);
      setDaftarPclAgregat(mappedPcl);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // --- 2. LOAD DAFTAR SLS ---
  const loadDaftarSls = async (targetPclEmail) => {
    setLoading(true);
    try {
      const { data: slsData, error: slsErr } = await supabaseData
        .from('muatan_sls')
        .select('idsubsls, nmsls, nmdesa, nmkec')
        .eq('petugas_id', targetPclEmail);

      if (slsErr) throw slsErr;
      if (!slsData || slsData.length === 0) {
        setDaftarSls([]);
        setLoading(false);
        return;
      }

      const arrayIdSls = slsData.map(s => String(s.idsubsls).trim());
      const { data: anomaliSummary, error: anoErr } = await supabaseData
        .from('view_monitoring_anomali')
        .select('idsubsls, status_konfirmasi, assignment_id, kode_anomali')
        .in('idsubsls', arrayIdSls);

      if (anoErr) throw anoErr;

      const slsMapped = slsData.map(sls => {
        const itemAnomali = anomaliSummary ? anomaliSummary.filter(a => a.idsubsls === sls.idsubsls) : [];
        const kunciUnikSet = new Set(itemAnomali.map(a => `${a.assignment_id}_${a.kode_anomali}`));
        
        let belumSelesaiUnik = 0;
        kunciUnikSet.forEach(kunci => {
          const barisTerkait = itemAnomali.filter(a => `${a.assignment_id}_${a.kode_anomali}` === kunci);
          if (barisTerkait.some(b => b.status_konfirmasi === 'Belum Tindak Lanjut')) {
            belumSelesaiUnik++;
          }
        });

        return {
          ...sls,
          totalAnomali: kunciUnikSet.size,
          belumSelesai: belumSelesaiUnik
        };
      });

      slsMapped.sort((a, b) => b.belumSelesai - a.belumSelesai);
      setDaftarSls(slsMapped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // --- 3. LOAD DETAIL ANOMALI (MENGGABUNGKAN DATA SNAPSHOT KEMBAR KE SATU HIERARKI RUTA) ---
  const loadDetailAnomaliSls = async (slsObj) => {
    setSelectedSls(slsObj);
    setLoading(true);
    try {
      const { data, error } = await supabaseData
        .from('view_monitoring_anomali')
        .select('anomali_id, assignment_id, nama_subjek, kode_anomali, kategori_anomali, status_konfirmasi, catatan_lapangan, tanggal_snapshot')
        .eq('idsubsls', slsObj.idsubsls);

      if (error) throw error;

      const grupRuta = {};
      data.forEach(item => {
        if (!grupRuta[item.assignment_id]) {
          grupRuta[item.assignment_id] = {
            assignment_id: item.assignment_id,
            nama_keluarga_krt: '', 
            nama_unit_usaha: '',   
            fallback_nama: item.nama_subjek, 
            daftar_error_grup: {} 
          };
        }

        if (String(item.kode_anomali).startsWith('K')) {
          grupRuta[item.assignment_id].nama_keluarga_krt = item.nama_subjek;
        } else if (String(item.kode_anomali).startsWith('U')) {
          grupRuta[item.assignment_id].nama_unit_usaha = item.nama_subjek;
        }

        const compositeErrorKey = item.kode_anomali;

        if (!grupRuta[item.assignment_id].daftar_error_grup[compositeErrorKey]) {
          grupRuta[item.assignment_id].daftar_error_grup[compositeErrorKey] = {
            kode_anomali: item.kode_anomali,
            kategori: item.kategori_anomali,
            status_konfirmasi: item.status_konfirmasi || 'Belum Tindak Lanjut',
            catatan_lapangan: item.catatan_lapangan || '',
            snapshots: [] 
          };
        }

        grupRuta[item.assignment_id].daftar_error_grup[compositeErrorKey].snapshots.push({
          anomali_id: item.anomali_id,
          tanggal_snapshot: item.tanggal_snapshot,
          status_konfirmasi: item.status_konfirmasi || 'Belum Tindak Lanjut'
        });

        if (item.status_konfirmasi === 'Belum Tindak Lanjut') {
          grupRuta[item.assignment_id].daftar_error_grup[compositeErrorKey].status_konfirmasi = 'Belum Tindak Lanjut';
        }
      });

      const finalRutaFlattened = Object.values(grupRuta).map(ruta => ({
        ...ruta,
        daftar_error: Object.values(ruta.daftar_error_grup).map(errGrup => ({
          ...errGrup,
          snapshots: errGrup.snapshots.sort((a, b) => String(a.tanggal_snapshot).localeCompare(String(b.tanggal_snapshot)))
        }))
      }));

      setDaftarAnomaliRuta(finalRutaFlattened);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!profilUser?.email) return;

    const siapkanWorkspaceData = async () => {
      await fetchMasterAnomali();

      if (profilUser.role === 'PML') {
        await loadDaftarPclAgregat(profilUser.email);
      } else if (profilUser.role === 'PCL') {
        setSelectedPcl({ email: profilUser.email, nama_petugas: profilUser.nama_pengguna });
        await loadDaftarSls(profilUser.email);
      }
    };

    siapkanWorkspaceData();
  }, [profilUser?.email, profilUser?.role]);

  const handleOpenActionModal = (subAnomali, namaSubjek, assignmentId) => {
    setEditingAnomali({ ...subAnomali, nama_subjek: namaSubjek, assignment_id: assignmentId });
    setStatusKonfirmasiForm(subAnomali.status_konfirmasi === 'Belum Tindak Lanjut' ? 'Sesuai Kondisi Lapangan' : subAnomali.status_konfirmasi);
    setCatatanLapanganForm(subAnomali.catatan_lapangan);
  };

  // --- 4. SAVE TINDAK LANJUT DENGAN EFEK DOMINO OTOMATIS LINIMASA ---
  const handleSaveTindakLanjut = async () => {
    if (!catatanLapanganForm.trim()) return alert('Catatan lapangan/konfirmasi wajib diisi!');
    setSubmitting(true);
    try {
      const payloadMassal = editingAnomali.snapshots.map(snap => ({
        anomali_id: snap.anomali_id,
        status_konfirmasi: statusKonfirmasiForm,
        catatan_lapangan: catatanLapanganForm,
        dkonfirmasi_oleh_email: profilUser?.email,
        tanggal_konfirmasi: new Date().toISOString()
      }));

      const { error } = await supabaseData
        .from('tindak_lanjut_anomali')
        .upsert(payloadMassal, { onConflict: 'anomali_id' });

      if (error) throw error;

      const statusAwalKelompokBelumTuntas = editingAnomali.status_konfirmasi === 'Belum Tindak Lanjut';

      setDaftarAnomaliRuta(prevRuta => 
        prevRuta.map(ruta => {
          if (ruta.assignment_id !== editingAnomali.assignment_id) return ruta;
          return {
            ...ruta,
            daftar_error: ruta.daftar_error.map(err => {
              if (err.kode_anomali !== editingAnomali.kode_anomali) return err;
              return {
                ...err,
                status_konfirmasi: statusKonfirmasiForm,
                catatan_lapangan: catatanLapanganForm,
                snapshots: err.snapshots.map(s => ({ ...s, status_konfirmasi: statusKonfirmasiForm }))
              };
            })
          };
        })
      );

      setDaftarSls(prevSls => 
        prevSls.map(sls => 
          sls.idsubsls === selectedSls?.idsubsls 
            ? { ...sls, belumSelesai: Math.max(0, sls.belumSelesai - (statusAwalKelompokBelumTuntas ? 1 : 0)) }
            : sls
        )
      );

      if (profilUser.role === 'PML' && selectedPcl) {
        setDaftarPclAgregat(prevPcl => 
          prevPcl.map(p => 
            p.email === selectedPcl.email 
              ? { 
                  ...p, 
                  sudahSelesai: p.sudahSelesai + (statusAwalKelompokBelumTuntas ? 1 : 0),
                  belumSelesai: Math.max(0, p.belumSelesai - (statusAwalKelompokBelumTuntas ? 1 : 0))
                }
              : p
          )
        );
      }

      setEditingAnomali(null);
    } catch (err) {
      alert('Gagal menyimpan konfirmasi lapangan: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTombolKembali = () => {
    if (selectedSls) { setSelectedSls(null); setDaftarAnomaliRuta([]); }
    else if (selectedPcl && profilUser?.role === 'PML') { setSelectedPcl(null); setDaftarSls([]); }
  };

  if (loading && !selectedSls && daftarSls.length === 0 && daftarPclAgregat.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-orange-50/30 font-sans">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm font-bold text-amber-900/70 tracking-wide uppercase animate-pulse">Menyusun Workspace Lapangan...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-slate-700 font-sans antialiased selection:bg-amber-200">
      
      {/* GLOBAL NAVBAR */}
      <div className="bg-gradient-to-r from-amber-700 to-orange-800 text-white shadow-md sticky top-0 z-10 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">
          <div className="space-y-0.5">
            <h1 className="text-base sm:text-lg font-black tracking-tight text-amber-50">SIMALI</h1>
            <p className="text-[11px] text-amber-200/80 font-medium font-mono truncate max-w-[280px]">
              {selectedPcl ? `Petugas PCL: ${selectedPcl.nama_petugas}` : `Dashboard Lapangan • ${profilUser?.role}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(selectedSls || (selectedPcl && profilUser?.role === 'PML')) && (
              <button onClick={handleTombolKembali} className="bg-white/10 hover:bg-white/20 text-amber-50 font-bold px-3.5 py-1.5 rounded-lg border border-white/10 transition-all text-xs flex items-center gap-1">← Kembali</button>
            )}
            <button onClick={logout} className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-1.5 rounded-lg text-xs shadow-xs transition-colors">Keluar</button>
          </div>
        </div>
      </div>

      {/* MAIN CONTAINER LAYOUT */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-20">
        
        {/* LEVEL 0: AGREGAT PCL UNTUK PML */}
        {profilUser?.role === 'PML' && !selectedPcl && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4 max-w-xl">
              <h2 className="text-xs font-bold text-amber-800 uppercase tracking-wider">Konfirmasi Anomali Sensus Ekonomi</h2>
              <p className="text-xs text-amber-700/80 mt-1">Klik pada salah satu nama petugas PCL di bawah untuk melihat anomali di wilayah SLS tugasnya.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {daftarPclAgregat.map(pcl => (
                <div key={pcl.email} onClick={() => { setSelectedPcl(pcl); loadDaftarSls(pcl.email); }} className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs hover:shadow-md hover:border-amber-400 active:bg-stone-50 cursor-pointer transition-all flex flex-col justify-between group">
                  <div className="space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="text-sm font-bold text-slate-900 group-hover:text-amber-800 transition-colors">🧑 {pcl.nama_petugas}</h3>
                      <span className="bg-amber-50 text-amber-800 font-extrabold text-[10px] px-2 py-0.5 rounded border border-amber-100 shrink-0">{pcl.jumlahSls} SLS</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{pcl.email}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 text-center pt-4 mt-3 border-t border-stone-100 text-[11px]">
                    <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                      <span className="text-stone-400 text-[9px] font-bold block uppercase tracking-wide">Beban Unik</span>
                      <span className="font-extrabold text-slate-800">{pcl.totalBeban}</span>
                    </div>
                    <div className="bg-emerald-50/50 p-2 rounded-lg border border-emerald-100">
                      <span className="text-emerald-600 text-[9px] font-bold block uppercase tracking-wide">Sudah Konf</span>
                      <span className="font-extrabold text-emerald-700">{pcl.sudahSelesai}</span>
                    </div>
                    <div className={`p-2 rounded-lg border ${pcl.belumSelesai > 0 ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-stone-50 text-stone-400'}`}>
                      <span className="text-[9px] font-bold block uppercase tracking-wide">Belum Konf</span>
                      <span className="font-black">⚠️ {pcl.belumSelesai}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LEVEL 1: DAFTAR SLS TUGAS */}
        {selectedPcl && !selectedSls && (
          <div className="space-y-4">
            <div className="bg-stone-900 text-stone-100 p-4 rounded-xl flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 shadow-xs">
              <div>
                <span className="text-stone-400 text-[10px] block uppercase font-bold tracking-wide">Petugas Lapangan:</span>
                <p className="font-black text-amber-400 text-base">{selectedPcl.nama_petugas}</p>
              </div>
              <div className="bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-stone-300">
                Kecamatan Wilayah: <span className="text-amber-300 font-bold">Boyolali</span>
              </div>
            </div>

            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">Daftar Wilayah SLS Tugas Pendataan</h2>
            
            {daftarSls.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border border-stone-200 text-slate-400 font-medium shadow-3xs">Tidak ada beban muaman anomali terpetakan di wilayah kerja SLS ini.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {daftarSls.map(sls => (
                  <div key={sls.idsubsls} onClick={() => loadDetailAnomaliSls(sls)} className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs hover:shadow-md hover:border-amber-500 hover:shadow-md cursor-pointer transition-all flex justify-between items-center group">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-900 group-hover:text-amber-800 transition-colors leading-snug">{sls.nmsls}</h3>
                      <p className="text-xs text-slate-500 font-medium">Desa {sls.nmdesa}, Kec. {sls.nmkec}</p>
                      <span className="text-[10px] font-mono text-stone-400 block pt-1">{sls.idsubsls}</span>
                    </div>
                    <div className="shrink-0 ml-4">
                      {sls.belumSelesai > 0 ? (
                        <span className="bg-orange-50 text-orange-700 border border-orange-200 text-xs font-extrabold px-3 py-1 rounded-full whitespace-nowrap">⚠️ {sls.belumSelesai} Antrean</span>
                      ) : (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-extrabold px-3 py-1 rounded-full whitespace-nowrap">✅ Selesai</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LEVEL 2: DAFTAR DETAIL RUTA ANOMALI BERSARANG DENGAN TIMELINE SNAPSHOT */}
        {selectedSls && (
          <div className="space-y-4">
            <div className="bg-amber-950 text-amber-50 p-4 rounded-xl shadow-xs border border-amber-900/40">
              <span className="text-amber-300/70 text-[10px] block uppercase font-bold tracking-wider">Fokus Kendali SLS:</span>
              <h3 className="font-black text-sm sm:text-base text-amber-200">{selectedSls.nmsls}</h3>
              <p className="text-xs text-amber-100/70 font-medium mt-0.5">Desa {selectedSls.nmdesa} • Ditemukan {daftarAnomaliRuta.length} Kelompok Subjek Kuesioner</p>
            </div>

            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">Daftar Subjek Kuesioner Lapangan</h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {daftarAnomaliRuta.map(ruta => {
                const anomaliKeluarga = ruta.daftar_error.filter(err => String(err.kode_anomali).startsWith('K'));
                const anomaliUsaha = ruta.daftar_error.filter(err => String(err.kode_anomali).startsWith('U'));
                const modeBersarang = anomaliKeluarga.length > 0 && anomaliUsaha.length > 0;
                const teksHeaderUtama = ruta.nama_keluarga_krt || ruta.fallback_nama;

                return (
                  <div key={ruta.assignment_id} className="bg-white rounded-xl border border-stone-200 shadow-xs overflow-hidden hover:shadow-md transition-shadow">
                    <div className="p-4 bg-stone-50 border-b border-stone-100 flex justify-between items-start gap-3">
                      <div className="space-y-1 max-w-[70%]">
                        <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wide">Nama Subjek / Kepala RT</span>
                        <h4 className="font-extrabold text-slate-900 text-sm sm:text-base leading-tight">🧑 {teksHeaderUtama}</h4>
                        {ruta.nama_unit_usaha && (
                          <div className="pt-1">
                            <span className="text-[9px] font-bold text-amber-700/80 block uppercase tracking-wide">Nama Institusi/Usaha:</span>
                            <p className="text-xs font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80 inline-block mt-0.5">🏢 {ruta.nama_unit_usaha}</p>
                          </div>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono block pt-1">ID: {ruta.assignment_id}</span>
                      </div>
                      <div className="shrink-0">
                        {modeBersarang ? <span className="bg-orange-100 text-orange-800 font-black text-[9px] px-2.5 py-0.5 rounded uppercase tracking-wider border border-orange-200/60 shadow-3xs">Keluarga & Usaha</span> : anomaliUsaha.length > 0 ? <span className="bg-amber-100 text-amber-800 font-black text-[9px] px-2.5 py-0.5 rounded uppercase tracking-wider border border-amber-200/60 shadow-3xs">Usaha</span> : <span className="bg-stone-100 text-stone-700 font-black text-[9px] px-2.5 py-0.5 rounded uppercase tracking-wider border border-stone-200/60 shadow-3xs">Keluarga</span>}
                      </div>
                    </div>

                    <div className="p-3 space-y-3 divide-y divide-stone-100">
                      {ruta.daftar_error.map((err, i) => {
                        const isBelumTuntas = err.status_konfirmasi === 'Belum Tindak Lanjut';
                        const isUsha = String(err.kode_anomali).startsWith('U');
                        const teksKeterangan = getInfoAnomali(err.kode_anomali, 'deskripsi');
                        
                        // 🌟 DETEKSI OTOMATIS: Apakah anomali ini merupakan Variabel Kosong (Missing Value)
                        const isMissingValue = String(err.kode_anomali).startsWith('M') || 
                                               teksKeterangan.toLowerCase().includes('kosong') || 
                                               teksKeterangan.toLowerCase().includes('missing');

                        // 🌟 DISTINGUISHED STYLING: Warna latar belakang penarik perhatian
                        const warnaBarisBg = isBelumTuntas 
                          ? (isMissingValue ? 'bg-sky-50/70 border-sky-300 ring-1 ring-sky-300/30' : 'bg-red-50/70 border-amber-200/70') 
                          : 'bg-emerald-50/40 border-emerald-200/50';

                        return (
                          <div key={err.kode_anomali} className={`pt-3 pb-2 px-2.5 rounded-xl border transition-all ${warnaBarisBg} ${i === 0 ? 'mt-0' : 'mt-2'} space-y-2.5`}>
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex items-start gap-2.5">
                                {/* 🌟 ANIMATED BADGE KODE KHUSUS MISSING VALUE */}
                                <span className={`font-black px-2 py-0.5 rounded-md text-[10px] shrink-0 mt-0.5 shadow-3xs text-white ${
                                  isMissingValue ? 'bg-sky-600 animate-pulse' : isUsha ? 'bg-amber-600' : 'bg-stone-700'
                                }`}>
                                  {isMissingValue ? `🔍 ${err.kode_anomali}` : err.kode_anomali}
                                </span>
                                <div className="space-y-0.5">
                                  <span className="font-bold text-slate-900 block leading-snug text-xs sm:text-sm flex items-center gap-1.5">
                                    {teksKeterangan}
                                    {/* PITA IDENTIFIKASI DATA KOSONG */}
                                    {isMissingValue && isBelumTuntas && (
                                      <span className="bg-sky-200 text-sky-950 font-black text-[9px] px-1.5 py-0.2 rounded uppercase tracking-wider font-sans shadow-3xs">ISIAN KOSONG</span>
                                    )}
                                  </span>
                                  <span className="text-[11px] text-amber-900/80 bg-amber-50/60 font-medium block px-2 py-1 rounded-md border border-amber-100/70 mt-1 leading-normal">
                                    Pedoman Logika: {getInfoAnomali(err.kode_anomali, 'aturan_teknis')}
                                  </span>

                                  {/* PITA LINIMASA SNAPSHOT */}
                                  <div className="pt-2 flex flex-wrap items-center gap-1">
                                    <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider block mr-1">Tanggal Anomali:</span>
                                    {err.snapshots.map(snap => {
                                      const snapBelumSelesai = snap.status_konfirmasi === 'Belum Tindak Lanjut';
                                      return (
                                        <span 
                                          key={snap.anomali_id}
                                          className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border shadow-2xs ${
                                            snapBelumSelesai 
                                              ? (isMissingValue ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-amber-100 text-amber-800 border-amber-300') 
                                              : 'bg-emerald-100 text-emerald-800 border-emerald-300 line-through'
                                          }`}
                                        >
                                          📅 {formatTanggalIndo(snap.tanggal_snapshot)}
                                        </span>
                                      );
                                    })}
                                  </div>

                                </div>
                              </div>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-md shrink-0 uppercase tracking-wide border shadow-3xs ${
                                isBelumTuntas 
                                  ? (isMissingValue ? 'bg-sky-100 text-sky-900 border-sky-300' : 'bg-amber-100 text-amber-800 border-amber-300/60') 
                                  : 'bg-emerald-100 text-emerald-800 border-emerald-300/60'
                              }`}>
                                {isBelumTuntas ? (isMissingValue ? 'Belum Diisi' : 'Belum Tindak Lanjut') : 'Selesai'}
                              </span>
                            </div>

                            {err.catatan_lapangan && (
                              <div className="p-2.5 bg-white/80 border border-stone-200 border-dashed rounded-lg text-xs text-slate-600 font-medium leading-relaxed">
                                <span className="font-bold text-amber-900 text-[9px] block mb-0.5 uppercase tracking-wider">Konfirmasi Terkini Petugas:</span>"{err.catatan_lapangan}"
                              </div>
                            )}

                            {/* TEXT BUTTON DINAMIS SESUAI TIPE ANOMALI */}
                            <div className="flex justify-end pt-0.5">
                              <button 
                                onClick={() => handleOpenActionModal(err, isUsha ? `${ruta.nama_unit_usaha || teksHeaderUtama} (Usaha)` : teksHeaderUtama, ruta.assignment_id)} 
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs ${
                                  isBelumTuntas 
                                    ? (isMissingValue ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white') 
                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-stone-200'
                                }`}
                              >
                                {isBelumTuntas ? (isMissingValue ? '📝 Isi Data Kosong' : '✍️ Isi Konfirmasi') : '✏️ Perbaiki Konfirmasi'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* INPUT CONFIRMATION MODAL DENGAN PEMBERITAHUAN EFEK DOMINO LINIMASA */}
      {editingAnomali && (
        <div className="fixed inset-0 bg-slate-900/60 z-30 flex items-center justify-center p-4 animate-fade-in backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 shadow-xl space-y-4 border border-stone-200 animate-scale-up">
            <div className="flex justify-between items-center border-b border-stone-100 pb-3">
              <div className="space-y-0.5">
                <span className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Lembar Justifikasi Data</span>
                <h4 className="text-sm font-bold text-slate-900 leading-tight">{editingAnomali.nama_subjek}</h4>
                <div className="text-[11px] text-slate-500 font-medium bg-stone-100 px-2.5 py-1 rounded-md inline-block mt-1">
                  Anomali {editingAnomali.kode_anomali}: <span className="font-bold text-slate-700">{getInfoAnomali(editingAnomali.kode_anomali, 'deskripsi')}</span>
                </div>
              </div>
              <button onClick={() => setEditingAnomali(null)} className="text-slate-400 hover:text-slate-600 font-black text-base p-2 transition-colors">✕</button>
            </div>

            <div className="space-y-3.5">
              <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl text-[11px] leading-relaxed text-amber-950 font-medium">
                💡 <strong>Informasi Sinkronisasi Linimasa:</strong> Kelompok anomali ini terdeteksi sebanyak <span className="font-black underline">{editingAnomali.snapshots?.length || 1} kali</span> di server pusat. Mengisi konfirmasi di bawah akan otomatis melunasi antrean untuk semua tanggal snapshot terkait.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Status Verifikasi Lapangan</label>
                <select value={statusKonfirmasiForm} onChange={(e) => setStatusKonfirmasiForm(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-lg p-2.5 text-xs font-bold text-slate-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden transition-all">
                  <option value="Sesuai Kondisi Lapangan">✅ Sesuai Kondisi Nyata Lapangan</option>
                  <option value="Perlu Perbaikan Data">✏️ Perlu Perbaikan Data di Aplikasi Fasih</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Alasan / Hasil Konfirmasi Lapangan <span className="text-orange-500">*</span></label>
                <textarea rows="4" value={catatanLapanganForm} onChange={(e) => setCatatanLapanganForm(e.target.value)} placeholder="Tulis alasan logis hasil kroscek lapangan yang bisa menerangkan penyebab anomali rules validasi..." className="w-full bg-stone-50 border border-stone-200 rounded-lg p-2.5 text-xs font-medium text-slate-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden h-24 transition-all resize-none leading-relaxed"></textarea>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2 border-t border-stone-100">
              <button type="button" onClick={() => setEditingAnomali(null)} className="w-1/3 border border-stone-200 rounded-xl py-2 text-xs font-bold text-slate-500 hover:bg-stone-50 transition-colors">Batal</button>
              <button type="button" disabled={submitting} onClick={handleSaveTindakLaught || handleSaveTindakLanjut} className="w-2/3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-2 text-xs font-bold disabled:opacity-50 shadow-xs transition-colors">{submitting ? 'Menyimpan...' : 'Simpan Konfirmasi'}</button>
            </div>
          </div>
        </div>
      )}

      {/* KAMUS POPUP PANDUAN PETA LOGIKA ANOMALI */}
      {showPanduanModal && (
        <div className="fixed inset-0 bg-slate-900/70 z-40 flex items-center justify-center p-4 animate-fade-in backdrop-blur-xs">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-stone-200 flex flex-col max-h-[85vh] animate-scale-up">
            <div className="p-5 bg-gradient-to-r from-amber-800 to-orange-900 text-white rounded-t-2xl flex justify-between items-center shrink-0">
              <div className="space-y-0.5">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-amber-50">📢 Kamus Kode Anomali</h3>
                <p className="text-xs text-amber-200/80 font-medium">Sensus Ekonomi & Pendataan Karakteristik Keluarga</p>
              </div>
              <button onClick={() => setShowPanduanModal(false)} className="bg-white/10 hover:bg-white/20 text-white text-sm font-bold w-8 h-8 rounded-full flex items-center justify-center transition-colors">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 text-xs sm:text-sm leading-relaxed text-slate-700">
              <p className="text-stone-500 font-medium bg-amber-50 p-3 rounded-lg border border-amber-200/50">
                <strong>Perhatian Petugas:</strong> Definisikan hasil verifikasi Anda di lapangan berdasarkan aturan rules logika blok kuesioner sebelum melakukan pengisian konfirmasi.
              </p>

              {/* 🌟 SEKSI PRIORITAS UTAMA: VARIABEL KOSONG (MISSING VALUE) DI BAGIAN PALING ATAS KAMUS */}
              <div className="space-y-3">
                <h4 className="text-sm font-extrabold text-sky-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-sky-100 pb-1.5">🔍 Variabel Kosong (Missing Value)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {masterAnomali.filter(a => String(a.kode).startsWith('M') || a.deskripsi.toLowerCase().includes('kosong')).map(item => (
                    <div key={item.kode} className="bg-sky-50/50 p-3 rounded-xl border border-sky-200 space-y-1">
                      <span className="font-bold text-sky-950 block">M[{item.kode}]. {item.deskripsi}</span>
                      <p className="text-[11px] text-sky-900/90 leading-normal">{item.aturan_teknis}</p>
                    </div>
                  ))}
                  {masterAnomali.filter(a => String(a.kode).startsWith('M') || a.deskripsi.toLowerCase().includes('kosong')).length === 0 && (
                    <div className="text-[11px] text-slate-400 font-medium py-2 col-span-2">Tidak ditemukan aturan isian kosong pada referensi master.</div>
                  )}
                </div>
              </div>
              
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-extrabold text-amber-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-stone-100 pb-1.5">🏢 Anomali Usaha</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {masterAnomali.filter(a => String(a.kode).startsWith('U') && !a.deskripsi.toLowerCase().includes('kosong')).map(item => (
                    <div key={item.kode} className="bg-stone-50 p-3 rounded-xl border border-stone-200/60 space-y-1">
                      <span className="font-bold text-slate-900 block">{item.kode}. {item.deskripsi}</span>
                      <p className="text-[11px] text-slate-600">{item.aturan_teknis}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-extrabold text-stone-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-stone-100 pb-1.5">🧑 Anomali Keluarga</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {masterAnomali.filter(a => String(a.kode).startsWith('K') && !a.deskripsi.toLowerCase().includes('kosong')).map(item => (
                    <div key={item.kode} className="bg-stone-50 p-3 rounded-xl border border-stone-200/60 space-y-1">
                      <span className="font-bold text-slate-900 block">{item.kode}. {item.deskripsi}</span>
                      <p className="text-[11px] text-slate-600">{item.aturan_teknis}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-stone-50 border-t border-stone-100 flex justify-end shrink-0 rounded-b-2xl">
              <button onClick={() => setShowPanduanModal(false)} className="bg-amber-700 hover:bg-amber-800 text-white font-bold px-6 py-2 rounded-xl text-xs sm:text-sm shadow-md transition-all">Saya Mengerti, Buka Dashboard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}