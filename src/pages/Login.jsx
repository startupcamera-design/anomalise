// src/pages/Login.jsx
import { useState } from 'react';
import { supabaseAuth, supabaseData } from '../lib/supabase'; // Pastikan kedua client di-import
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // Panggil konteks jika diperlukan trigger manual

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(false); // Biarkan state tracking berjalan

    console.log("=== AWAL PROSES LOGIN ===");
    console.log("Input Email:", email);

    try {
      // 1. Autentikasi Utama lewat Supabase Auth Proyek Lama
      console.log("Mengirim request ke supabaseAuth.auth.signInWithPassword...");
      const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        console.error("❌ Error Supabase Auth:", authError.message);
        throw authError;
      }
      
      console.log("✅ Supabase Auth Sukses! Data User Auth:", authData?.user);

      const cleanEmail = email.trim().toLowerCase();
      console.log("Email setelah dibersihkan (lowercase & trim):", cleanEmail);

      // 2. Cek ke tabel app_users
      console.log("Mencari di tabel public.app_users...");
      const { data: kantorUser, error: kantorErr } = await supabaseData
        .from('app_users')
        .select('email, role')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (kantorErr) {
        console.error("❌ Error saat query tabel app_users:", kantorErr.message);
      }
      console.log("Hasil query app_users:", kantorUser);

      // 3. Cek ke tabel petugas
      console.log("Mencari di tabel public.petugas...");
      const { data: lapanganUser, error: lapanganErr } = await supabaseData
        .from('petugas')
        .select('email, posisi_tugas')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (lapanganErr) {
        console.error("❌ Error saat query tabel petugas:", lapanganErr.message);
      }
      console.log("Hasil query petugas:", lapanganUser);

      // 4. Evaluasi Hasil Akhir
      if (!kantorUser && !lapanganUser) {
        console.warn("⚠️ Akun ditemukan di Auth, tetapi TIDAK terdaftar di kedua tabel lokal (app_users / petugas). Melakukan signOut...");
        await supabaseAuth.auth.signOut();
        throw new Error('Akun Anda aktif, tetapi tidak terdaftar sebagai Pegawai Kantor maupun Mitra Lapangan di aplikasi ini.');
      }

      console.log("🚀 Lolos screening! Mengalihkan ke halaman utama (/)");
      navigate('/');
      
    } catch (err) {
      console.error("=== PROSES LOGIN GAGAL ===", err);
      setErrorMsg(err.message || 'Email atau password salah.');
    } finally {
      setLoading(false);
      console.log("=== AKHIR PROSES LOGIN ===");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-6 sm:p-8 shadow-md border border-slate-200">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">SIMANOMALI</h2>
          <p className="text-xs text-slate-500 font-medium">Sistem Monitoring Anomali Kegiatan Lapangan</p>
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-600 border border-rose-200 font-medium leading-relaxed">
            ⚠️ {errorMsg}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleLogin}>
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Email Resmi Petugas</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-xs sm:text-sm text-slate-900 shadow-3xs focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 bg-slate-50 font-medium"
              placeholder="nama@bps.go.id atau mitra@gmail.com"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Kata Sandi</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-xs sm:text-sm text-slate-900 shadow-3xs focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 bg-slate-50 font-medium"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2.5 px-4 rounded-xl shadow-2xs text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all mt-6"
          >
            {loading ? 'Memverifikasi Hak Akses...' : 'Masuk Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}