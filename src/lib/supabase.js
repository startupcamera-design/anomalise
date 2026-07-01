// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrlAuth = import.meta.env.VITE_SUPABASE_URL_AUTH;
const supabaseAnonKeyAuth = import.meta.env.VITE_SUPABASE_ANON_KEY_AUTH;

const supabaseUrlData = import.meta.env.VITE_SUPABASE_URL_DATA;
const supabaseAnonKeyData = import.meta.env.VITE_SUPABASE_ANON_KEY_DATA;

// Client 1: Khusus mengurusi Login, Logout, dan Session (Proyek Lama)
export const supabaseAuth = createClient(supabaseUrlAuth, supabaseAnonKeyAuth);

// Client 2: Khusus mengurusi Query Tabel Anomali, View, dan Tindak Lanjut (Proyek Baru)
export const supabaseData = createClient(supabaseUrlData, supabaseAnonKeyData);