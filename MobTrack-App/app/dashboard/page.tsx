'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export type PhotoItem = {
  id: string;
  name: string;
  filePath: string;
  publicUrl: string;
  type: 'intruder' | 'on_demand' | 'remote_capture';
  capturedAt: string;
  uploadedAt: string;
  size?: number;
};

/**
 * Format any timestamp or ISO string into Indian Standard Time (IST).
 */
export function formatIST(dateInput?: string | number | Date | null): string {
  if (!dateInput) return 'N/A';
  const d = typeof dateInput === 'number' && dateInput < 10000000000 ? new Date(dateInput * 1000) : new Date(dateInput);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' IST';
}

export default function Dashboard() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mobileNumber, setMobileNumber] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'photos' | 'settings'>('photos');

  // Photo Gallery State
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);

  const [trustees, setTrustees] = useState([
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
    { number: '', verified: false },
  ]);

  // Use strings to control input rendering
  const [volUp, setVolUp] = useState("0");
  const [volDown, setVolDown] = useState("0");
  const [power, setPower] = useState("0");

  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  // ── Fetch Photos directly from Supabase Storage + Database ─────────────────
  const fetchPhotos = useCallback(async (devId: string, mobNum?: string) => {
    setPhotosLoading(true);
    try {
      const itemsMap = new Map<string, PhotoItem>();

      // 1. Direct Storage bucket listing (Fast & 100% reliable)
      const folderCandidates = [devId];
      if (mobNum && mobNum !== devId) folderCandidates.push(mobNum);

      for (const folder of folderCandidates) {
        const { data: storageFiles, error: storageErr } = await supabase
          .storage
          .from('device_media')
          .list(folder, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
          });

        if (!storageErr && storageFiles) {
          for (const file of storageFiles) {
            if (!file.name || file.name.startsWith('.')) continue;
            const fullPath = `${folder}/${file.name}`;
            const { data: urlData } = supabase.storage.from('device_media').getPublicUrl(fullPath);
            const isIntruder = file.name.toLowerCase().includes('intruder');

            // Parse timestamp from filename if available (e.g. intruder_2026-09-03_19-21-58_test.jpg)
            let capturedAt = file.created_at || file.updated_at || new Date().toISOString();
            const match = file.name.match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
            if (match) {
              const datePart = match[1];
              const timePart = match[2].replace(/-/g, ':');
              const parsedDate = new Date(`${datePart}T${timePart}`);
              if (!isNaN(parsedDate.getTime())) {
                capturedAt = parsedDate.toISOString();
              }
            }

            itemsMap.set(file.name, {
              id: file.id || fullPath,
              name: file.name,
              filePath: fullPath,
              publicUrl: urlData.publicUrl,
              type: isIntruder ? 'intruder' : 'on_demand',
              capturedAt,
              uploadedAt: file.created_at || capturedAt,
              size: file.metadata?.size,
            });
          }
        }
      }

      // 2. Query photo_captures table for additional metadata
      const { data: dbRows } = await supabase
        .from('photo_captures')
        .select('*')
        .eq('device_id', devId)
        .order('captured_at', { ascending: false });

      if (dbRows) {
        for (const row of dbRows) {
          const fileName = row.file_path.split('/').pop() || row.file_path;
          const { data: urlData } = supabase.storage.from('device_media').getPublicUrl(row.file_path);
          const existing = itemsMap.get(fileName);

          if (existing) {
            existing.capturedAt = row.captured_at || existing.capturedAt;
            existing.uploadedAt = row.uploaded_at || existing.uploadedAt;
            existing.type = row.type || existing.type;
          } else {
            itemsMap.set(fileName, {
              id: row.id,
              name: fileName,
              filePath: row.file_path,
              publicUrl: urlData.publicUrl,
              type: row.type || (fileName.includes('intruder') ? 'intruder' : 'on_demand'),
              capturedAt: row.captured_at || new Date().toISOString(),
              uploadedAt: row.uploaded_at || row.captured_at || new Date().toISOString(),
            });
          }
        }
      }

      // Sort newest first
      const sortedPhotos = Array.from(itemsMap.values()).sort((a, b) => {
        return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
      });

      setPhotos(sortedPhotos);
    } catch (err) {
      console.warn('Error fetching photos:', err);
    } finally {
      setPhotosLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = localStorage.getItem('loggedInDeviceId');
    if (!id) { router.push('/login'); return; }
    setDeviceId(id);
    fetchUserData(id);
  }, [router]);

  const fetchUserData = async (id: string) => {
    const { data } = await supabase
      .from('devices')
      .select('mobile_number, full_name, trusted_contacts, shutdown_sequence')
      .eq('id', id)
      .single();
    
    if (data) {
      setMobileNumber(data.mobile_number || '');
      setFullName(data.full_name || '');

      if (data.trusted_contacts) {
        const loadedTrustees = [...trustees];
        data.trusted_contacts.forEach((num: string, index: number) => {
          if (index < 5) loadedTrustees[index] = { number: num, verified: true };
        });
        setTrustees(loadedTrustees);
      }
      if (data.shutdown_sequence) {
        setVolUp((data.shutdown_sequence.volUp || 0).toString());
        setVolDown((data.shutdown_sequence.volDown || 0).toString());
        setPower((data.shutdown_sequence.power || 0).toString());
      }

      // Fetch photos immediately for this device
      fetchPhotos(id, data.mobile_number);
    }
    setLoading(false);
  };

  // Realtime subscription for instant updates when photos are captured
  useEffect(() => {
    if (!deviceId) return;

    const channel = supabase
      .channel(`dashboard-photos-${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'photo_captures',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          fetchPhotos(deviceId, mobileNumber);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, mobileNumber, fetchPhotos]);

  const handleSendOtp = async (index: number) => {
    const rawNumber = trustees[index].number;
    if (rawNumber.length !== 10) { alert('Must be exactly 10 digits.'); return; }
    
    setOtpLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: '+91' + rawNumber });
    setOtpLoading(false);

    if (error) { alert(`Failed to send OTP: ${error.message}`); return; }
    setVerifyingIndex(index);
    setOtpInput('');
  };

  const handleConfirmOtp = async () => {
    if (otpInput.length !== 6) { alert('OTP must be exactly 6 digits.'); return; }
    
    setOtpLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: '+91' + trustees[verifyingIndex!].number,
      token: otpInput,
      type: 'sms',
    });
    setOtpLoading(false);

    if (error) {
      alert(`Invalid OTP: ${error.message}`);
    } else {
      const newTrustees = [...trustees];
      newTrustees[verifyingIndex!].verified = true;
      setTrustees(newTrustees);
      setVerifyingIndex(null);
      setOtpInput('');
    }
  };

  const updateTrusteeNumber = (index: number, value: string) => {
    const newTrustees = [...trustees];
    newTrustees[index].number = value;
    newTrustees[index].verified = false;
    setTrustees(newTrustees);
    if (verifyingIndex === index) setVerifyingIndex(null);
  };

  const handleSequenceInput = (val: string, setter: (val: string) => void) => {
    const numericString = val.replace(/\D/g, '');
    if (numericString === '') {
      setter("0");
    } else {
      setter(parseInt(numericString, 10).toString());
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    if (!trustees[0].verified) { alert('Trustee 1 is mandatory and must be verified.'); setSaving(false); return; }

    const vUp = parseInt(volUp, 10);
    const vDown = parseInt(volDown, 10);
    const pwr = parseInt(power, 10);

    if ((vUp > 0 ? 1 : 0) + (vDown > 0 ? 1 : 0) + (pwr > 0 ? 1 : 0) < 2) {
      alert('Please enable at least two action buttons for the shutdown sequence.');
      setSaving(false); return;
    }

    const verifiedTrusteesList = trustees.filter(t => t.verified && t.number).map(t => t.number);
    
    await supabase.from('devices').update({
      trusted_contacts: verifiedTrusteesList,
      shutdown_sequence: { volUp: vUp, volDown: vDown, power: pwr }
    }).eq('id', deviceId);

    setSaving(false);
    alert('Security Settings Updated Successfully!');
  };

  if (loading) return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading Data...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6 mt-4">
        
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-900 p-5 rounded-lg border border-gray-800 gap-4 shadow-xl">
          <div>
            <h1 className="text-2xl font-bold text-blue-500 flex items-center gap-2">
              <span>MOBTRACK DASHBOARD</span>
            </h1>
            <p className="text-xs text-gray-400 mt-1 font-mono">
              Owner: <span className="text-white font-semibold">{fullName || 'Device Owner'}</span> · Mobile: <span className="text-white font-semibold">{mobileNumber}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/track"
              className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-xs font-bold transition flex items-center gap-1.5 shadow"
            >
              <span>🚨</span>
              <span>LIVE TRACKING & CAM</span>
            </Link>
            <button
              onClick={() => { localStorage.removeItem('loggedInDeviceId'); router.push('/'); }}
              className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded text-xs font-bold text-gray-300 hover:text-white transition border border-gray-700"
            >
              LOGOUT
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setActiveTab('photos')}
            className={`px-6 py-3 font-bold text-sm border-b-2 transition flex items-center gap-2 ${
              activeTab === 'photos'
                ? 'border-blue-500 text-blue-400 bg-gray-900/50'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <span>📸 Security Photos & Intruder Selfies</span>
            <span className="bg-blue-600/30 text-blue-300 text-xs px-2 py-0.5 rounded-full border border-blue-500/40">
              {photos.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-3 font-bold text-sm border-b-2 transition flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'border-blue-500 text-blue-400 bg-gray-900/50'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <span>⚙️ Security Settings & Trustees</span>
          </button>
        </div>

        {/* ════════════════════ PHOTO GALLERY TAB ════════════════════ */}
        {activeTab === 'photos' && (
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 space-y-4">
            <div className="flex justify-between items-center border-b border-gray-800 pb-3">
              <div>
                <h2 className="text-lg font-bold text-white">Your Captured Security Photos</h2>
                <p className="text-xs text-gray-400">
                  Photos captured automatically upon incorrect PIN attempts on your phone.
                </p>
              </div>
              <button
                onClick={() => deviceId && fetchPhotos(deviceId, mobileNumber)}
                disabled={photosLoading}
                className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-gray-300 hover:text-white font-medium transition flex items-center gap-1.5 border border-gray-700"
              >
                <span>🔄</span>
                <span>{photosLoading ? 'Refreshing…' : 'Refresh Photos'}</span>
              </button>
            </div>

            {photosLoading && photos.length === 0 ? (
              <div className="py-16 text-center text-gray-400 animate-pulse">
                <p className="text-3xl mb-2">⏳</p>
                <p className="text-sm">Loading your photos from secure storage…</p>
              </div>
            ) : photos.length === 0 ? (
              <div className="py-16 text-center text-gray-500 bg-gray-950/40 rounded-lg border border-dashed border-gray-800 p-8">
                <p className="text-4xl mb-2">🛡️</p>
                <p className="text-base font-semibold text-gray-300">No Security Photos Found</p>
                <p className="text-xs text-gray-500 max-w-md mx-auto mt-1">
                  Intruder selfies captured on incorrect PIN entry (or snapshots requested from Live Tracking) will appear here instantly.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-2">
                {photos.map((photo, index) => {
                  const isIntruder = photo.type === 'intruder';
                  return (
                    <div
                      key={photo.id || index}
                      className="bg-gray-950/80 rounded-lg border border-gray-800 overflow-hidden hover:border-gray-600 transition flex flex-col group shadow-lg"
                    >
                      {/* Image Thumbnail */}
                      <div
                        className="relative aspect-video bg-black cursor-pointer overflow-hidden flex items-center justify-center"
                        onClick={() => setSelectedPhoto(photo)}
                      >
                        <img
                          src={photo.publicUrl}
                          alt={`Photo ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          loading="lazy"
                        />
                        <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded shadow ${
                          isIntruder ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                        }`}>
                          {isIntruder ? '🚨 INTRUDER SELFIE' : '📸 CAPTURE'}
                        </span>
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                          <span className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-full border border-white/20 font-medium">
                            🔍 Expand
                          </span>
                        </div>
                      </div>

                      {/* Card Metadata */}
                      <div className="p-3 flex-1 flex flex-col justify-between space-y-2 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-gray-400 font-medium">Captured:</span>
                            <span className="text-white font-semibold text-right">
                              {formatIST(photo.capturedAt)}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-1 text-[11px] text-gray-400">
                            <span>Uploaded:</span>
                            <span className="text-gray-300 text-right">
                              {formatIST(photo.uploadedAt)}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-800/80">
                          <button
                            onClick={() => setSelectedPhoto(photo)}
                            className="text-blue-400 hover:text-blue-300 font-medium text-[11px]"
                          >
                            View Full ↗
                          </button>
                          <a
                            href={photo.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            download
                            className="text-gray-400 hover:text-white text-[11px] bg-gray-800 hover:bg-gray-700 px-2 py-0.5 rounded transition"
                          >
                            ⬇ Download
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════ SECURITY SETTINGS TAB ════════════════════ */}
        {activeTab === 'settings' && (
          <div className="bg-gray-900 p-8 rounded-lg border border-gray-800 shadow-2xl">
            <h2 className="text-xl font-bold text-blue-500 mb-6 pb-3 border-b border-gray-800">
              EDIT SECURITY SETTINGS
            </h2>

            <form onSubmit={handleUpdate} className="space-y-6">
              <div className="bg-gray-800 p-5 rounded border border-gray-700">
                <h3 className="text-lg font-bold mb-4">Edit Trustee Devices (Max 5)</h3>
                {trustees.map((trustee, index) => (
                  <div key={index} className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 mb-2">
                    <span className="py-2 text-gray-400 w-6 hidden sm:block">{index + 1}.</span>
                    <input type="tel" disabled={trustee.verified || verifyingIndex === index} value={trustee.number} onChange={(e) => updateTrusteeNumber(index, e.target.value)} className="flex-1 p-2 rounded bg-gray-900 border border-gray-600 text-white" placeholder={index === 0 ? "Compulsory 10-digit number" : "Optional 10-digit number"} />
                    {trustee.number.length === 10 && !trustee.verified ? (
                      verifyingIndex === index ? (
                        <div className="flex space-x-2">
                          <input type="text" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit OTP" maxLength={6} className="w-28 p-2 rounded bg-gray-900 border border-blue-500 text-white text-center font-bold tracking-widest" />
                          <button type="button" onClick={handleConfirmOtp} disabled={otpLoading} className="bg-blue-600 hover:bg-blue-700 px-4 rounded font-bold transition text-sm">{otpLoading ? '...' : 'OK'}</button>
                          <button type="button" onClick={() => setVerifyingIndex(null)} className="bg-red-600 hover:bg-red-700 px-3 rounded font-bold transition text-sm">X</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => handleSendOtp(index)} disabled={otpLoading} className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 sm:py-0 rounded text-sm font-bold transition">{otpLoading ? 'SENDING...' : 'VERIFY'}</button>
                      )
                    ) : trustee.verified ? (
                      <button type="button" onClick={() => updateTrusteeNumber(index, '')} className="bg-green-600 hover:bg-red-600 px-4 py-2 sm:py-0 rounded text-sm font-bold transition-colors">VERIFIED (CLICK TO REMOVE)</button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="bg-gray-800 p-5 rounded border border-gray-700">
                <h3 className="text-lg font-bold mb-4">Edit Shutdown Sequence</h3>
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

              <button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-700 font-bold py-4 rounded text-lg">{saving ? 'Saving...' : 'SAVE ALL CHANGES'}</button>
            </form>
          </div>
        )}

        {/* ════════════════════ IMAGE PREVIEW MODAL ════════════════════ */}
        {selectedPhoto && (
          <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedPhoto(null)}
          >
            <div
              className="bg-gray-900 border border-gray-700 rounded-xl max-w-3xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center p-4 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded ${
                    selectedPhoto.type === 'intruder' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                  }`}>
                    {selectedPhoto.type === 'intruder' ? '🚨 INTRUDER ATTEMPT' : '📸 CAPTURE'}
                  </span>
                  <span className="text-sm text-gray-300 font-mono">
                    {formatIST(selectedPhoto.capturedAt)}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedPhoto(null)}
                  className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 p-2 rounded-full text-sm font-bold w-8 h-8 flex items-center justify-center transition"
                >
                  ✕
                </button>
              </div>

              <div className="max-h-[70vh] bg-black flex items-center justify-center p-2 overflow-hidden">
                <img
                  src={selectedPhoto.publicUrl}
                  alt="Security photo detail"
                  className="max-h-[68vh] w-auto object-contain rounded"
                />
              </div>

              <div className="p-4 bg-gray-950 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs border-t border-gray-800">
                <div className="text-gray-400 space-y-0.5 text-center sm:text-left">
                  <p><span className="text-gray-500">Captured:</span> {formatIST(selectedPhoto.capturedAt)}</p>
                  <p><span className="text-gray-500">Uploaded:</span> {formatIST(selectedPhoto.uploadedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={selectedPhoto.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold transition flex items-center gap-1.5"
                  >
                    <span>Open In New Tab</span>
                    <span>↗</span>
                  </a>
                  <a
                    href={selectedPhoto.publicUrl}
                    download
                    className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded font-bold transition flex items-center gap-1.5 border border-gray-700"
                  >
                    <span>⬇ Download</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}