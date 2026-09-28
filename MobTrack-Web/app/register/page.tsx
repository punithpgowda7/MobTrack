'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { hashPassword, hashBackupCodes } from '@/lib/auth-crypto';
import Link from 'next/link';
import Image from 'next/image';

// Valid button tokens for the unlock sequence
type ButtonToken = 'volUp' | 'volDown' | 'power';

const BUTTON_LABELS: Record<ButtonToken, string> = {
  volUp:   '🔊 VOL UP',
  volDown: '🔉 VOL DOWN',
  power:   '⏻ POWER',
};

export default function Register() {
  const [fullName, setFullName]   = useState('');
  const [password, setPassword]   = useState('');
  
  const [imei1, setImei1] = useState('');
  const [imei2, setImei2] = useState('');

  const [mobileNumber, setMobileNumber]       = useState('');
  const [isMobileVerified, setIsMobileVerified] = useState(false);

  const [trustees, setTrustees] = useState([
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
  ]);

  // ── Fake Shutdown state ───────────────────────────────────────────────────
  const [fakeShutdownEnabled, setFakeShutdownEnabled] = useState(false);
  const [sequence, setSequence] = useState<ButtonToken[]>([]);

  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [loading, setLoading]               = useState(false);
  const [message, setMessage]               = useState('');

  const [verifyingType, setVerifyingType]     = useState<'owner' | 'trustee' | null>(null);
  const [verifyingIndex, setVerifyingIndex]   = useState<number | null>(null);
  const [otpInput, setOtpInput]               = useState('');
  const [otpLoading, setOtpLoading]           = useState(false);

  // ── OTP helpers ───────────────────────────────────────────────────────────

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
    const rawNumber    = verifyingType === 'owner' ? mobileNumber : trustees[verifyingIndex!].number;
    const e164Number   = '+91' + rawNumber;

    setOtpLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: e164Number, token: otpInput, type: 'sms' });
    setOtpLoading(false);

    if (verifyError) {
      alert(`Invalid OTP: ${verifyError.message}`);
    } else {
      if (verifyingType === 'owner') setIsMobileVerified(true);
      if (verifyingType === 'trustee' && verifyingIndex !== null) {
        const updated = [...trustees];
        updated[verifyingIndex].verified = true;
        setTrustees(updated);
      }
      setVerifyingType(null);
      setVerifyingIndex(null);
      setOtpInput('');
    }
  };

  const updateTrusteeNumber = (index: number, value: string) => {
    const updated = [...trustees];
    updated[index].number   = value;
    updated[index].verified = false;
    setTrustees(updated);
    if (verifyingType === 'trustee' && verifyingIndex === index) {
      setVerifyingType(null);
      setVerifyingIndex(null);
    }
  };

  // ── Sequence builder helpers ──────────────────────────────────────────────

  const addStep    = (btn: ButtonToken) => setSequence(prev => [...prev, btn]);
  const removeStep = (i: number)        => setSequence(prev => prev.filter((_, j) => j !== i));

  // ── Registration ──────────────────────────────────────────────────────────

  const generateBackupCodes = () => {
    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
    }
    return codes;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    if (!imei1) { alert('You must enter at least IMEI 1 to create an account.'); setLoading(false); return; }
    if (imei1.length < 15) { alert('IMEI 1 must be 15 digits.'); setLoading(false); return; }
    if (imei2 && imei2.length < 15) { alert('IMEI 2 must be 15 digits.'); setLoading(false); return; }

    if (!isMobileVerified) { alert('Please verify your primary mobile number first.'); setLoading(false); return; }
    if (!trustees[0].verified) { alert('You must add and verify at least ONE Trustee device.'); setLoading(false); return; }

    if (fakeShutdownEnabled && sequence.length < 2) {
      alert('Please build a secret unlock sequence of at least 2 button presses for Fake Shutdown.');
      setLoading(false); return;
    }

    const verifiedList = trustees.filter(t => t.verified && t.number).map(t => t.number);
    const backupCodes  = generateBackupCodes();

    const hashedPassword = await hashPassword(password);
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    const { error } = await supabase.from('devices').insert([{
      full_name:             fullName,
      mobile_number:         mobileNumber,
      password_hash:         hashedPassword,
      backup_codes_hash:     hashedBackupCodes,
      trusted_contacts:      verifiedList,
      fake_shutdown_enabled: fakeShutdownEnabled,
      // Store as ordered array — matches the new format the app expects
      shutdown_sequence:     fakeShutdownEnabled ? sequence : [],
      imei1:                 imei1,
      imei2:                 imei2 || null,
    }]);

    setLoading(false);
    if (error) { setMessage(`Error: ${error.message}`); } else { setGeneratedCodes(backupCodes); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-2xl">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-500">CREATE ACCOUNT</h1>

        {generatedCodes.length === 0 ? (
          <form onSubmit={handleRegister} className="space-y-6">

            {/* Step 1 — Device IMEI */}
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-4 text-blue-400">1. Device IMEI (Mandatory)</h2>
              
              {/* IMEI Guide */}
              <div className="mb-6 bg-gray-900 p-4 rounded-lg border border-gray-600">
                <h3 className="text-sm font-semibold text-white mb-4 text-center">3 Ways to Find Your IMEI Number</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  
                  <div className="flex flex-col items-center text-center space-y-2">
                    <div className="relative w-full h-24 rounded overflow-hidden border border-gray-700">
                      <Image src="/images/imei_box.jpg" alt="IMEI on phone box" fill style={{ objectFit: 'cover' }} />
                    </div>
                    <p className="text-xs text-gray-300 mt-2"><strong>1. On the Box</strong><br/>Check the sticker on your phone&apos;s packaging.</p>
                  </div>
                  
                  <div className="flex flex-col items-center text-center space-y-2">
                    <div className="relative w-full h-24 rounded overflow-hidden border border-gray-700">
                      <Image src="/images/imei_dialer.jpg" alt="Dial *#06#" fill style={{ objectFit: 'cover' }} />
                    </div>
                    <p className="text-xs text-gray-300 mt-2"><strong>2. Dial *#06#</strong><br/>Open dialer and type *#06# to view on screen.</p>
                  </div>
                  
                  <div className="flex flex-col items-center text-center space-y-2">
                    <div className="relative w-full h-24 rounded overflow-hidden border border-gray-700">
                      <Image src="/images/imei_settings.jpg" alt="IMEI in Settings" fill style={{ objectFit: 'cover' }} />
                    </div>
                    <p className="text-xs text-gray-300 mt-2"><strong>3. Settings</strong><br/>Go to Settings &gt; About Phone &gt; IMEI.</p>
                  </div>

                </div>
              </div>

              {/* IMEI Inputs */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-4">
                  <label className="text-sm font-bold text-gray-300 w-16">IMEI 1:</label>
                  <input
                    type="text" value={imei1} onChange={(e) => setImei1(e.target.value.replace(/[^0-9]/g, '').slice(0, 15))}
                    className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white"
                    placeholder="15-digit IMEI Number (Compulsory)"
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-4">
                  <label className="text-sm font-bold text-gray-300 w-16">IMEI 2:</label>
                  <input
                    type="text" value={imei2} onChange={(e) => setImei2(e.target.value.replace(/[^0-9]/g, '').slice(0, 15))}
                    className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white"
                    placeholder="15-digit IMEI Number (Optional)"
                  />
                </div>
              </div>
            </div>

            {/* Step 2 — Owner Details */}
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-4 text-blue-400">2. Owner Details</h2>
              <div className="space-y-4">
                <input
                  type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
                  className="w-full p-2 rounded bg-gray-900 border border-gray-600 text-white"
                  placeholder="Official Full Name"
                />
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                  <input
                    type="tel" required
                    disabled={isMobileVerified || verifyingType === 'owner'}
                    value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)}
                    className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white"
                    placeholder="10-digit Mobile Number"
                  />
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
                  ) : (
                    <button type="button" disabled className="bg-green-600 px-4 py-2 sm:py-0 rounded font-bold">VERIFIED</button>
                  )}
                </div>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder="Security Password" />
              </div>
            </div>

            {/* Step 3 — Trustee Devices */}
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-2 text-blue-400">3. Trustee Devices (Max 5)</h2>
              <p className="text-xs text-gray-400 mb-4">Trustee 1 is mandatory. Must verify via OTP.</p>
              {trustees.map((trustee, index) => (
                <div key={index} className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 mb-2">
                  <span className="py-2 text-gray-400 w-6 hidden sm:block">{index + 1}.</span>
                  <input type="tel" disabled={trustee.verified || (verifyingType === 'trustee' && verifyingIndex === index)} value={trustee.number} onChange={(e) => updateTrusteeNumber(index, e.target.value)} className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder={index === 0 ? 'Compulsory 10-digit number' : 'Optional 10-digit number'} />
                  {trustee.number.length === 10 && !trustee.verified ? (
                    verifyingType === 'trustee' && verifyingIndex === index ? (
                      <div className="flex space-x-2">
                        <input type="text" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit OTP" maxLength={6} className="w-28 p-2 rounded bg-gray-900 border border-blue-500 text-white text-center font-bold tracking-widest" />
                        <button type="button" onClick={handleConfirmOtp} disabled={otpLoading} className="bg-blue-600 hover:bg-blue-700 px-4 rounded font-bold transition text-sm">{otpLoading ? '...' : 'OK'}</button>
                        <button type="button" onClick={() => setVerifyingType(null)} className="bg-red-600 hover:bg-red-700 px-3 rounded font-bold transition text-sm">X</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handleSendOtp('trustee', index)} disabled={otpLoading} className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 sm:py-0 rounded text-sm font-bold transition">{otpLoading ? 'SENDING...' : 'VERIFY'}</button>
                    )
                  ) : trustee.verified ? (
                    <button type="button" disabled className="bg-green-600 px-4 py-2 sm:py-0 rounded text-sm font-bold">VERIFIED</button>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Step 4 — Fake Shutdown */}
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
              <h2 className="text-lg font-bold mb-2 text-blue-400">4. Fake Shutdown</h2>
              <p className="text-xs text-gray-400 mb-4">
                When Power is pressed anywhere on the phone — home screen, any app, or lock screen — it shows a
                convincing fake shutdown animation. The phone keeps running invisibly in the background. Configure
                a secret button combo below to exit the fake screen.
              </p>

              {/* Enable / Disable toggle */}
              <div className="flex items-center justify-between mb-5">
                <span className="text-sm font-semibold">Enable Fake Shutdown</span>
                <button
                  type="button"
                  onClick={() => setFakeShutdownEnabled(prev => !prev)}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${
                    fakeShutdownEnabled ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      fakeShutdownEnabled ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Sequence builder */}
              {fakeShutdownEnabled && (
                <div>
                  <p className="text-sm font-semibold text-gray-200 mb-2">Secret Unlock Sequence</p>
                  <p className="text-xs text-gray-400 mb-3">
                    Tap buttons to add them in order. Press this exact combo while the fake shutdown screen is
                    showing to return to normal. Minimum 2 steps required.
                  </p>

                  {/* Add-step buttons */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(['volUp', 'volDown', 'power'] as ButtonToken[]).map(btn => (
                      <button
                        key={btn}
                        type="button"
                        onClick={() => addStep(btn)}
                        className="bg-gray-700 hover:bg-gray-600 border border-gray-500 px-3 py-1.5 rounded text-xs font-bold transition"
                      >
                        + {BUTTON_LABELS[btn]}
                      </button>
                    ))}
                  </div>

                  {/* Built sequence */}
                  <div className="min-h-12 bg-gray-900 border border-gray-600 rounded p-3 flex flex-wrap gap-2 items-center">
                    {sequence.length === 0 ? (
                      <span className="text-gray-500 text-xs">Tap the buttons above to build your secret sequence…</span>
                    ) : (
                      sequence.map((btn, i) => (
                        <div key={i} className="flex items-center gap-1 bg-gray-700 border border-gray-500 rounded px-2 py-1">
                          <span className="text-xs font-bold text-white">{BUTTON_LABELS[btn]}</span>
                          <button
                            type="button"
                            onClick={() => removeStep(i)}
                            className="text-red-400 hover:text-red-300 text-xs font-bold leading-none ml-1"
                            title="Remove this step"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {sequence.length > 0 && sequence.length < 2 && (
                    <p className="text-xs text-yellow-400 mt-2">⚠ Add at least one more step (minimum 2 required)</p>
                  )}
                  {sequence.length >= 2 && (
                    <p className="text-xs text-green-400 mt-2">
                      ✓ Sequence ready — {sequence.length} step{sequence.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}
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
              {generatedCodes.map((code, index) => (
                <div key={index} className="font-bold tracking-widest">{code}</div>
              ))}
            </div>
            <Link href="/login" className="block w-full bg-gray-700 hover:bg-gray-600 font-bold py-4 rounded transition mt-4">
              GO TO LOGIN
            </Link>
          </div>
        )}

        {message && <p className="mt-4 text-center text-sm font-medium text-yellow-300">{message}</p>}
      </div>
    </div>
  );
}