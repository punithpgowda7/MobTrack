'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Valid button tokens for the unlock sequence
type ButtonToken = 'volUp' | 'volDown' | 'power';

const BUTTON_LABELS: Record<ButtonToken, string> = {
  volUp:   '🔊 VOL UP',
  volDown: '🔉 VOL DOWN',
  power:   '⏻ POWER',
};

function getPhotoUrl(filePathOrUrl?: string | null): string {
  if (!filePathOrUrl) return '';
  if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://') || filePathOrUrl.startsWith('data:')) {
    return filePathOrUrl;
  }
  const cleanPath = filePathOrUrl.startsWith('device_media/')
    ? filePathOrUrl.replace('device_media/', '')
    : filePathOrUrl;
  const { data } = supabase.storage.from('device_media').getPublicUrl(cleanPath);
  return data?.publicUrl || '';
}

export default function Dashboard() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [latestPhotoUrl, setLatestPhotoUrl] = useState<string | null>(null);

  const [trustees, setTrustees] = useState([
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
  ]);

  // Last Gasp state
  const [lastGaspLimit, setLastGaspLimit] = useState<number>(5);

  // ── Fake Shutdown state ───────────────────────────────────────────────────
  const [fakeShutdownEnabled, setFakeShutdownEnabled] = useState(false);
  // shutdown_sequence stored as ordered string[] e.g. ["volUp","volUp","power"]
  const [sequence, setSequence] = useState<ButtonToken[]>([]);

  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);
  const [otpInput, setOtpInput]             = useState('');
  const [otpLoading, setOtpLoading]         = useState(false);

  useEffect(() => {
    const id = localStorage.getItem('loggedInDeviceId');
    if (!id) { router.push('/track'); return; }
    setDeviceId(id);
    fetchUserData(id);
  }, [router]);

  const fetchUserData = async (id: string) => {
    const { data } = await supabase
      .from('devices')
      .select('trusted_contacts, fake_shutdown_enabled, shutdown_sequence, last_gasp_limit, latest_photo_url')
      .eq('id', id)
      .single();

    if (data) {
      if (data.latest_photo_url) {
        setLatestPhotoUrl(data.latest_photo_url);
      }
      if (data.trusted_contacts) {
        const loaded = [
          { number: '', verified: false },
          { number: '', verified: false },
          { number: '', verified: false },
          { number: '', verified: false },
          { number: '', verified: false },
        ];
        data.trusted_contacts.forEach((num: string, i: number) => {
          if (i < 5) loaded[i] = { number: num, verified: true };
        });
        setTrustees(loaded);
      }
      setFakeShutdownEnabled(data.fake_shutdown_enabled ?? false);
      if (data.last_gasp_limit !== undefined) {
        setLastGaspLimit(data.last_gasp_limit);
      }
      // shutdown_sequence is now a string[] (ordered array)
      if (Array.isArray(data.shutdown_sequence)) {
        setSequence(data.shutdown_sequence as ButtonToken[]);
      }
    }
    setLoading(false);
  };

  // ── Trustee OTP helpers ───────────────────────────────────────────────────

  const handleSendOtp = async (index: number) => {
    const rawNumber = trustees[index].number;
    if (rawNumber.length !== 10) { alert('Phone number must be exactly 10 digits.'); return; }
    setOtpLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: '+91' + rawNumber });
    setOtpLoading(false);
    if (error) { alert(`Could not send code: ${error.message}`); return; }
    setVerifyingIndex(index);
    setOtpInput('');
  };

  const handleConfirmOtp = async () => {
    if (otpInput.length !== 6) { alert('Code must be exactly 6 digits.'); return; }
    setOtpLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: '+91' + trustees[verifyingIndex!].number,
      token: otpInput,
      type: 'sms',
    });
    setOtpLoading(false);
    if (error) {
      alert(`Wrong code: ${error.message}`);
    } else {
      const updated = [...trustees];
      updated[verifyingIndex!].verified = true;
      setTrustees(updated);
      setVerifyingIndex(null);
      setOtpInput('');
    }
  };

  const updateTrusteeNumber = (index: number, value: string) => {
    const updated = [...trustees];
    updated[index].number   = value;
    updated[index].verified = false;
    setTrustees(updated);
    if (verifyingIndex === index) setVerifyingIndex(null);
  };

  // ── Sequence builder helpers ──────────────────────────────────────────────

  const addStep = (btn: ButtonToken) => setSequence(prev => [...prev, btn]);

  const removeStep = (index: number) =>
    setSequence(prev => prev.filter((_, i) => i !== index));

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    if (!trustees[0].verified) {
      alert('Helper 1 is required and must be verified.');
      setSaving(false); return;
    }

    if (fakeShutdownEnabled && sequence.length < 2) {
      alert('Please pick at least 2 buttons for your secret combo.');
      setSaving(false); return;
    }

    const verifiedList = trustees
      .filter(t => t.verified && t.number)
      .map(t => t.number);

    const { error } = await supabase.from('devices').update({
      trusted_contacts:      verifiedList,
      fake_shutdown_enabled: fakeShutdownEnabled,
      // Store as ordered array; empty array when disabled so the app knows to stop
      shutdown_sequence:     fakeShutdownEnabled ? sequence : [],
      last_gasp_limit:       lastGaspLimit,
    }).eq('id', deviceId);

    setSaving(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
    } else {
      alert('Settings saved successfully!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen cyber-bg text-slate-100 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-mono tracking-wider uppercase text-slate-400">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen cyber-bg text-slate-100 p-3.5 sm:p-6 flex flex-col relative pb-12">
      
      {/* Ambient background glow orb */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[85vw] max-w-[700px] h-[320px] bg-emerald-500/10 blur-[130px] rounded-full" />
      </div>

      <div className="max-w-4xl mx-auto w-full bg-[#070a10]/85 backdrop-blur-[24px] p-5 sm:p-8 rounded-3xl border border-emerald-500/20 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.05)_inset] mt-2 sm:mt-6 relative z-10 space-y-6">

        {/* Header (Responsive: Never Swallowed) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-500/20 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/track?restore=1"
                className="text-xs font-semibold text-slate-400 hover:text-white transition py-1 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center gap-1 active:scale-95 font-mono"
              >
                <span>←</span>
                <span>BACK TO MAP</span>
              </Link>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 uppercase">
                SETTINGS
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-emerald-400 bg-clip-text text-transparent uppercase">
              PHONE SETTINGS
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap font-mono">
            <Link
              href="/photos"
              className="cyber-btn cyber-btn-emerald flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold text-white transition flex items-center justify-center gap-1.5 shadow active:scale-95 whitespace-nowrap"
            >
              <span>📷</span>
              <span>PHOTOS</span>
            </Link>
            <button
              onClick={() => { localStorage.removeItem('loggedInDeviceId'); router.push('/'); }}
              className="cyber-btn cyber-btn-rose flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold text-rose-200 transition active:scale-95 whitespace-nowrap"
            >
              LOG OUT
            </button>
          </div>
        </div>

        {/* ── Latest Photo / Intruder Alert Preview Card ───────────────────────── */}
        {latestPhotoUrl && (
          <div className="bg-gradient-to-r from-rose-950/40 via-[#000814] to-[#000814] border border-rose-500/40 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-black flex-shrink-0 border border-white/10 shadow">
                <img
                  src={getPhotoUrl(latestPhotoUrl)}
                  alt="Latest Capture"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-rose-600 text-white text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full shadow">
                    📸 LATEST PHOTO
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Latest photo taken by your phone.
                </p>
              </div>
            </div>
            <Link
              href="/photos"
              className="bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-emerald-300 text-xs font-bold px-4 py-2 rounded-xl transition whitespace-nowrap shadow active:scale-95"
            >
              See All Photos ↗
            </Link>
          </div>
        )}

        <form onSubmit={handleUpdate} className="space-y-5">

          {/* ── Trustee Devices ─────────────────────────────────────────── */}
          <div className="bg-white/[0.02] p-4 sm:p-5 rounded-3xl border border-white/10 space-y-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <span>👥</span> REGISTERED TRUSTEE DEVICES (MAX 5)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Helper 1 is required for emergency text messages and location alerts. Verify each number with SMS code.
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              {trustees.map((trustee, index) => (
                <div key={index} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <span className="text-slate-500 font-mono text-xs w-6 hidden sm:block">{index + 1}.</span>
                  <input
                    type="tel"
                    disabled={trustee.verified || verifyingIndex === index}
                    value={trustee.number}
                    onChange={(e) => updateTrusteeNumber(index, e.target.value)}
                    className={`flex-1 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border text-white font-mono text-sm transition ${
                      trustee.verified
                        ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/10'
                        : 'border-white/10 focus:border-emerald-500 focus:outline-none'
                    }`}
                    placeholder={index === 0 ? 'Required 10-digit number' : 'Optional 10-digit number'}
                  />

                  {trustee.number.length === 10 && !trustee.verified ? (
                    verifyingIndex === index ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={otpInput}
                          onChange={(e) => setOtpInput(e.target.value)}
                          placeholder="6-digit code"
                          maxLength={6}
                          className="w-28 px-2 py-2 rounded-xl bg-white/[0.03] border border-emerald-500 text-white text-center font-mono font-bold tracking-widest text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleConfirmOtp}
                          disabled={otpLoading}
                          className="bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 rounded-xl font-bold transition text-xs text-white"
                        >
                          {otpLoading ? '…' : 'OK'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVerifyingIndex(null)}
                          className="bg-rose-900/60 hover:bg-rose-800 px-3 py-2 rounded-xl font-bold transition text-xs text-rose-200"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendOtp(index)}
                        disabled={otpLoading}
                        className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition active:scale-95 whitespace-nowrap"
                      >
                        {otpLoading ? 'SENDING…' : 'VERIFY'}
                      </button>
                    )
                  ) : trustee.verified ? (
                    <button
                      type="button"
                      onClick={() => updateTrusteeNumber(index, '')}
                      className="bg-emerald-950/60 hover:bg-rose-950/80 border border-emerald-700/60 hover:border-rose-700/60 text-emerald-300 hover:text-rose-300 px-3.5 py-2.5 rounded-xl text-xs font-mono font-bold transition-all whitespace-nowrap flex items-center justify-center gap-1.5"
                      title="Click to remove"
                    >
                      <span>✓ VERIFIED</span>
                      <span className="text-[10px] opacity-60">(REMOVE)</span>
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* ── Last Gasp Trigger ───────────────────────────────────────────────────────── */}
          <div className="bg-white/[0.02] p-4 sm:p-5 rounded-3xl border border-white/10 space-y-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <span>🔋</span> LOW BATTERY ALERT
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                When the battery drops below this number, your phone sends its location and a help message to Helper 1 before it shuts off.
              </p>
            </div>

            <div className="flex items-center space-x-4 bg-white/[0.02] p-3 rounded-2xl border border-white/5">
              <input
                type="range"
                min="5"
                max="100"
                value={lastGaspLimit}
                onChange={(e) => setLastGaspLimit(parseInt(e.target.value, 10))}
                className="flex-1 accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              />
              <span className={`text-xl font-mono font-extrabold w-16 text-center ${
                lastGaspLimit < 20 ? 'text-rose-400' : lastGaspLimit < 50 ? 'text-amber-400' : 'text-emerald-400'
              }`}>
                {lastGaspLimit}%
              </span>
            </div>
          </div>

          {/* ── Fake Shutdown & SIM Alarm ───────────────────────────────────────────────────────── */}
          <div className="bg-white/[0.02] p-4 sm:p-5 rounded-3xl border border-white/10 space-y-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <span>🛡️</span> FAKE SHUTDOWN & SIM REMOVAL ALARM
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Shows a convincing fake shutdown animation when power button is pressed, keeping tracking running secretly in background. If the SIM is removed, an unstoppable alarm triggers.
              </p>
            </div>

            {/* Enable / Disable toggle */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-white/5">
              <span className="text-xs sm:text-sm font-semibold text-slate-200">
                Enable Fake Shutdown & SIM Guard
              </span>
              <button
                type="button"
                onClick={() => setFakeShutdownEnabled(prev => !prev)}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${
                  fakeShutdownEnabled ? 'bg-emerald-600' : 'bg-slate-800'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    fakeShutdownEnabled ? 'translate-x-8' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Sequence builder — only shown when enabled */}
            {fakeShutdownEnabled && (
              <div className="space-y-3 pt-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Secret Hardware Unlock Sequence</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Press these buttons to turn off the fake screen. Pick at least 2 button presses.
                  </p>
                </div>

                {/* Add-step buttons */}
                <div className="flex flex-wrap gap-2">
                  {(['volUp', 'volDown', 'power'] as ButtonToken[]).map(btn => (
                    <button
                      key={btn}
                      type="button"
                      onClick={() => addStep(btn)}
                      className="bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl text-xs font-bold transition text-slate-200 active:scale-95"
                    >
                      + {BUTTON_LABELS[btn]}
                    </button>
                  ))}
                </div>

                {/* Built sequence display */}
                <div className="min-h-14 bg-black/50 border border-white/10 rounded-2xl p-3 flex flex-wrap gap-2 items-center">
                  {sequence.length === 0 ? (
                    <span className="text-slate-500 text-xs font-mono">Tap buttons above to make your secret combo…</span>
                  ) : (
                    sequence.map((btn, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-slate-900 border border-white/15 rounded-xl px-2.5 py-1 text-xs">
                        <span className="font-mono font-bold text-white">{BUTTON_LABELS[btn]}</span>
                        <button
                          type="button"
                          onClick={() => removeStep(i)}
                          className="text-rose-400 hover:text-rose-300 text-sm font-bold leading-none ml-1 p-0.5"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {sequence.length > 0 && sequence.length < 2 && (
                  <p className="text-xs text-amber-400 font-medium">⚠️ Add at least one more button (minimum 2 needed)</p>
                )}
                {sequence.length >= 2 && (
                  <p className="text-xs text-emerald-400 font-medium">
                    ✓ Secret combo saved — {sequence.length} buttons chosen
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full cyber-btn cyber-btn-emerald bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-sm uppercase tracking-wider transition-all duration-300 shadow-lg shadow-emerald-900/40 active:scale-[0.99]"
          >
            {saving ? 'SAVING…' : 'SAVE SETTINGS'}
          </button>
        </form>
      </div>
    </div>
  );
}