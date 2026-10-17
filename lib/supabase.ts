import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { fetchWithClockSkewRetry } from './supabase-fetch';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.local.example to .env.local and fill it in.',
  );
}

export const supabase = createClient(url, publishableKey, {
  // Retry once on PGRST303 "JWT issued at future" (token iat vs PostgREST clock right after sign-in).
  global: { fetch: fetchWithClockSkewRetry },
  auth: {
    // On web, Supabase uses localStorage by default; AsyncStorage is native-only.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native apps have no URL to parse; web needs this for OAuth redirect callbacks
    // (email sign-in uses a typed code now, so it never redirects at all).
    detectSessionInUrl: Platform.OS === 'web',
  },
});
