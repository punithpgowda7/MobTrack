'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { hashPassword, hashBackupCodes } from '@/lib/auth-crypto';
import Link from 'next/link';

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  
  const [mobileNumber, setMobileNumber] = useState('');
  const [isMobileVerified, setIsMobileVerified] = useState(false);
  
  const [trustees, setTrustees] = useState([
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
  ]);

  // Changed to strings to strictly control the UI
  const [volUp, setVolUp] = useState("0");
  const [volDown, setVolDown] = useState("0");
  const [power, setPower] = useState("0");

  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [verifyingType, setVerifyingType] = useState<'owner' | 'trustee' | null>(null);
  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  const handleSendOtp = async (type: 'owner' | 'trustee', index?: number) => {
    const rawNumber = type === 'owner' ? mobileNumber : trustees[index!].number;
    if (rawNumber.length !== 10) { alert('Mobile number must be exactly 10 digits.'); return; }
    const e164Number = '+91' + rawNumber;

    if (type === 'owner') {
      const { data } = await supabase.from('devices').select('id').eq('mobile_number', rawNumber).single();
      if (data) { alert('ERROR: This mobile number is already registered!'); return; }
    }

    setOtpLoading(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({ phone: e164Number });
    setOtpLoading(false);

    if (sendError) { alert(`Failed to send OTP: ${sendError.message}`); return; }
    
    setVerifyingType(type);
    setVerifyingIndex(index ?? null);
    setOtpInput('');
  };

  const handleConfirmOtp = async () => {
    if (otpInput.length !== 6) { alert('OTP must be exactly 6 digits.'); return; }
    const rawNumber = verifyingType === 'owner' ? mobileNumber : trustees[verifyingIndex!].number;
    const e164Number = '+91' + rawNumber;

    setOtpLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: e164Number, token: otpInput, type: 'sms' });
    setOtpLoading(false);

    if (verifyError) {
      alert(`Invalid OTP: ${verifyError.message}`);
    } else {
      if (verifyingType === 'owner') setIsMobileVerified(true);
      if (verifyingType === 'trustee' && verifyingIndex !== null) {
        const newTrustees = [...trustees];
        newTrustees[verifyingIndex].verified = true;
        setTrustees(newTrustees);
      }
      setVerifyingType(null);
      setVerifyingIndex(null);
      setOtpInput('');
    }
  };

  const updateTrusteeNumber = (index: number, value: string) => {
    const newTrustees = [...trustees];
    newTrustees[index].number = value;
    newTrustees[index].verified = false; 
    setTrustees(newTrustees);
    if (verifyingType === 'trustee' && verifyingIndex === index) {
      setVerifyingType(null);
      setVerifyingIndex(null);
    }
  };

  const generateBackupCodes = () => {
    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
    }
    return codes;
  };

  // NEW: Strict string formatter to instantly kill leading zeros
  const handleSequenceInput = (val: string, setter: (val: string) => void) => {
    const numericString = val.replace(/\D/g, ''); // Strip non-numbers
    if (numericString === '') {
      setter("0");
    } else {
      setter(parseInt(numericString, 10).toString()); // Parses "08" to "8" instantly
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    if (!isMobileVerified) { alert('Please verify your primary mobile number first.'); setLoading(false); return; }
    if (!trustees[0].verified) { alert('You must add and verify at least ONE Trustee device.'); setLoading(false); return; }

    const vUp = parseInt(volUp, 10);
    const vDown = parseInt(volDown, 10);
    const pwr = parseInt(power, 10);

    const activeActions = (vUp > 0 ? 1 : 0) + (vDown > 0 ? 1 : 0) + (pwr > 0 ? 1 : 0);
    if (activeActions < 2) {
      alert('Please enable at least two action buttons for the shutdown sequence.');
      setLoading(false); return;
    }

    const verifiedTrusteesList = trustees.filter(t => t.verified && t.number).map(t => t.number);
    const backupCodes = generateBackupCodes();

    const hashedPassword = await hashPassword(password);
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    const { error } = await supabase.from('devices').insert([{
      full_name: fullName,
      mobile_number: mobileNumber,
      password_hash: hashedPassword,
      backup_codes_hash: hashedBackupCodes,
      trusted_contacts: verifiedTrusteesList,
      shutdown_sequence: { volUp: vUp, volDown: vDown, power: pwr }
    }]);

    setLoading(false);
    if (error) { setMessage(`Error: ${error.message}`); } else { setGeneratedCodes(backupCodes); }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-2xl">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-500">CREATE ACCOUNT</h1>

        {generatedCodes.length === 0 ? (
          <form onSubmit={handleRegister} className="space-y-6">
            
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-4 text-blue-400">1. Owner Details</h2>
              <div className="space-y-4">
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder="Official Full Name" />
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                  <input type="tel" required disabled={isMobileVerified || verifyingType === 'owner'} value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder="10-digit Mobile Number" />
                  {!isMobileVerified ? (
                    verifyingType === 'owner' ? (
                      <div className="flex space-x-2">
                        <input type="text" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit OTP" maxLength={6} className="w-28 p-2 rounded bg-gray-900 border border-blue-500 text-white text-center font-bold tracking-widest" />
                        <button type="button" onClick={handleConfirmOtp} disabled={otpLoading} className="bg-blue-600 hover:bg-blue-700 px-4 rounded font-bold transition text-sm">{otpLoading ? '...' : 'CONFIRM'}</button>
                        <button type="button" onClick={() => setVerifyingType(null)} className="bg-red-600 hover:bg-red-700 px-3 rounded font-bold transition text-sm">X</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleSendOtp('owner')} disabled={otpLoading} className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 sm:py-0 rounded font-bold transition">{otpLoading ? 'SENDING...' : 'VERIFY'}</button>
                    )
                  ) : (<button type="button" disabled className="bg-green-600 px-4 py-2 sm:py-0 rounded font-bold">VERIFIED</button>)}
                </div>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder="Security Password" />
              </div>
            </div>

            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-2 text-blue-400">2. Trustee Devices (Max 5)</h2>
              <p className="text-xs text-gray-400 mb-4">Trustee 1 is mandatory. Must verify via OTP.</p>
              {trustees.map((trustee, index) => (
                <div key={index} className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 mb-2">
                  <span className="py-2 text-gray-400 w-6 hidden sm:block">{index + 1}.</span>
                  <input type="tel" disabled={trustee.verified || (verifyingType === 'trustee' && verifyingIndex === index)} value={trustee.number} onChange={(e) => updateTrusteeNumber(index, e.target.value)} className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder={index === 0 ? "Compulsory 10-digit number" : "Optional 10-digit number"} />
                  {trustee.number.length === 10 && !trustee.verified ? (
                    verifyingType === 'trustee' && verifyingIndex === index ? (
                      <div className="flex space-x-2">
                        <input type="text" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit OTP" maxLength={6} className="w-28 p-2 rounded bg-gray-900 border border-blue-500 text-white text-center font-bold tracking-widest" />
                        <button type="button" onClick={handleConfirmOtp} disabled={otpLoading} className="bg-blue-600 hover:bg-blue-700 px-4 rounded font-bold transition text-sm">{otpLoading ? '...' : 'OK'}</button>
                        <button type="button" onClick={() => setVerifyingType(null)} className="bg-red-600 hover:bg-red-700 px-3 rounded font-bold transition text-sm">X</button>
                      </div>
                    ) : (<button type="button" onClick={() => handleSendOtp('trustee', index)} disabled={otpLoading} className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 sm:py-0 rounded text-sm font-bold transition">{otpLoading ? 'SENDING...' : 'VERIFY'}</button>)
                  ) : trustee.verified ? (<button type="button" disabled className="bg-green-600 px-4 py-2 sm:py-0 rounded text-sm font-bold">VERIFIED</button>) : null}
                </div>
              ))}
            </div>

            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-2 text-blue-400">3. Fake Shutdown Sequence</h2>
              <p className="text-xs text-gray-400 mb-4">Set the exact hardware button combination required to trigger a real shutdown. Keep 0 if not used. Minimum TWO actions required.</p>
              
              <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0 text-sm">
                <div className="flex items-center">
                  <span>Volume Up:</span>
                  <input type="text" inputMode="numeric" value={volUp} onChange={(e) => handleSequenceInput(e.target.value, setVolUp)} className="w-16 mx-2 p-1 bg-gray-900 border-b-2 border-red-500 text-center focus:outline-none" />
                  <span>times</span>
                </div>
                <div className="flex items-center">
                  <span>Volume Down:</span>
                  <input type="text" inputMode="numeric" value={volDown} onChange={(e) => handleSequenceInput(e.target.value, setVolDown)} className="w-16 mx-2 p-1 bg-gray-900 border-b-2 border-red-500 text-center focus:outline-none" />
                  <span>times</span>
                </div>
                <div className="flex items-center">
                  <span>Power:</span>
                  <input type="text" inputMode="numeric" value={power} onChange={(e) => handleSequenceInput(e.target.value, setPower)} className="w-16 mx-2 p-1 bg-gray-900 border-b-2 border-red-500 text-center focus:outline-none" />
                  <span>times</span>
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 font-bold py-4 rounded transition duration-200">
              {loading ? 'Processing...' : 'COMPLETE REGISTRATION'}
            </button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <h2 className="text-2xl font-bold text-green-400">REGISTRATION COMPLETE</h2>
            <p className="text-gray-300">Save These 5 Emergency Backup Codes</p>
            <div className="bg-gray-800 p-6 rounded text-center font-mono text-xl space-y-3 text-yellow-400">
              {generatedCodes.map((code, index) => (<div key={index} className="font-bold tracking-widest">{code}</div>))}
            </div>
            <Link href="/login" className="block w-full bg-gray-700 hover:bg-gray-600 font-bold py-4 rounded transition mt-4">GO TO LOGIN</Link>
          </div>
        )}
        {message && <p className="mt-4 text-center text-sm font-medium text-yellow-300">{message}</p>}
      </div>
    </div>
  );
}