// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabaseAuth, supabaseData } from '../lib/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Ambil session aktif saat aplikasi pertama kali dimuat
    supabaseAuth.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        fetchUserProfile(session.user.email);
      } else {
        setLoading(false);
      }
    });

    // 2. Dengarkan perubahan status auth (Login / Logout)
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser(session.user);
        fetchUserProfile(session.user.email);
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fungsi Multitasking untuk mengambil detail dari app_users ATAU petugas secara lokal
  const fetchUserProfile = async (email) => {
    if (!email) {
      setLoading(false);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
      // Jalur A: Cari di tabel app_users (Pegawai Internal Kantor)
      const { data: kantorUser, error: kantorErr } = await supabaseData
        .from('app_users')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle(); // Aman dari crash 'Cannot coerce result to single JSON object'

      if (kantorErr) console.error("Log error app_users:", kantorErr.message);

      if (kantorUser) {
        setProfile({
          ...kantorUser,
          tipe_akun: 'KANTOR'
        });
        return; // Hentikan fungsi di sini jika sudah ketemu
      }

      // Jalur B: Jika tidak ditemukan di kantor, cari di tabel petugas (Mitra Lapangan PML/PCL)
      const { data: lapanganUser, error: lapanganErr } = await supabaseData
        .from('petugas')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (lapanganErr) console.error("Log error petugas:", lapanganErr.message);

      if (lapanganUser) {
        setProfile({
          ...lapanganUser,
          nama_pengguna: lapanganUser.nama_petugas, // Penyelarasan kunci agar tidak patah di navbar
          role: lapanganUser.posisi_tugas,          // Mengubah 'PML'/'PCL' menjadi dibaca sebagai 'role'
          tipe_akun: 'LAPANGAN'
        });
        return;
      }

      // Fallback jika email ada di Auth tetapi tidak ada di kedua tabel di atas
      setProfile(null);
    } catch (err) {
      console.error("Gagal mendeteksi profil pengguna secara relasional:", err.message);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    await supabaseAuth.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);