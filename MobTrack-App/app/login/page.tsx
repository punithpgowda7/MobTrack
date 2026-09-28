'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { verifyPassword } from '@/lib/auth-crypto';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Login() {
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    // Query Supabase to find a device matching the mobile number
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('mobile_number', mobileNumber)
      .single();

    const isPasswordValid = await verifyPassword(password, data?.password_hash);
    setLoading(false);

    if (error || !data || !isPasswordValid) {
      setErrorMsg('Invalid mobile number or password. Please try again.');
    } else {
      // If login is successful, store the user ID locally and redirect to dashboard
      localStorage.setItem('loggedInDeviceId', data.id);
      router.push('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-2xl">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-500">
          OWNER LOGIN
        </h1>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1">Mobile Number</label>
            <input
              type="tel"
              required
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              className="w-full p-3 rounded bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
              placeholder="Enter registered number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Security Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 font-bold py-3 rounded transition duration-200"
          >
            {loading ? 'Authenticating...' : 'LOGIN'}
          </button>
        </form>

        {errorMsg && (
          <p className="mt-4 text-center text-sm font-medium text-red-500">
            {errorMsg}
          </p>
        )}

        <div className="mt-6 text-center">
          <Link href="/" className="text-gray-400 hover:text-white text-sm transition">
            ← Back to Main Menu
          </Link>
        </div>
      </div>
    </div>
  );
}