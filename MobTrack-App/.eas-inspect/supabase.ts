import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = 'https://bmqmdykqrnocjyqjjtzb.supabase.co'; // Paste your URL here
const supabaseAnonKey = 'sb_publishable_43VlpJVrEI8fzut89x0Isg_kq6G32CU'; // Paste your Key here

// This prevents the "window is not defined" crash if accidentally opened on PC
const customStorage = {
  getItem: (key: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return Promise.resolve(null);
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return Promise.resolve();
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return Promise.resolve();
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});