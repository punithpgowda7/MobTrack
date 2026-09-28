'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import JSZip from 'jszip';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const CyberBackground3D = dynamic(() => import('../components/CyberBackground3D'), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────────────

type PhotoCapture = {
  id: string;
  device_id: string;
  file_path: string;
  type: 'intruder' | 'on_demand';
  captured_at: string;
  uploaded_at: string;
  publicUrl: string;
};

const MAX_BULK_DOWNLOAD = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  }) + ' IST';
}

function getFilename(filePath: string) {
  return filePath.split('/').pop() ?? filePath;
}

function getPublicUrl(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  const cleanPath = filePath.startsWith('device_media/')
    ? filePath.replace('device_media/', '')
    : filePath;
  const { data } = supabase.storage.from('device_media').getPublicUrl(cleanPath);
  return data?.publicUrl || '';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PhotoGallery() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mobileNumber, setMobileNumber] = useState<string>('');
  const [photos, setPhotos] = useState<PhotoCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Lightbox state
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  // Select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  // ── Auth check & fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    let id = localStorage.getItem('loggedInDeviceId');
    
    // Require valid authenticated device session; redirect to tracking dashboard if not logged in
    if (!id) {
      router.push('/track');
      return;
    }

    setDeviceId(id);
    supabase
      .from('devices')
      .select('mobile_number')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          localStorage.removeItem('loggedInDeviceId');
          router.push('/track');
          return;
        }
        const mob = data?.mobile_number || '';
        setMobileNumber(mob);
        fetchPhotos(id, mob);
      });
  }, [router]);

  // ── Fetch photos list (Direct Storage Listing + DB Rows) ───────────────────
  const fetchPhotos = async (devId: string, mobNum?: string) => {
    setLoading(true);
    setError('');

    try {
      const itemsMap = new Map<string, PhotoCapture>();

      // 1. Direct Supabase Storage listing from user folder
      const folders = [devId];
      if (mobNum && mobNum !== devId) folders.push(mobNum);

      for (const folder of folders) {
        const { data: storageFiles } = await supabase
          .storage
          .from('device_media')
          .list(folder, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
          });

        if (storageFiles) {
          for (const file of storageFiles) {
            if (!file.name || file.name.startsWith('.')) continue;
            const fullPath = `${folder}/${file.name}`;
            const isIntruder = file.name.toLowerCase().includes('intruder');

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
              device_id: devId,
              file_path: fullPath,
              publicUrl: getPublicUrl(fullPath),
              type: isIntruder ? 'intruder' : 'on_demand',
              captured_at: capturedAt,
              uploaded_at: file.created_at || capturedAt,
            });
          }
        }
      }

      // 2. Query photo_captures table for additional database metadata
      const { data: dbRows } = await supabase
        .from('photo_captures')
        .select('*')
        .eq('device_id', devId)
        .order('captured_at', { ascending: false });

      if (dbRows) {
        for (const row of dbRows) {
          const fileName = row.file_path.split('/').pop() || row.file_path;
          const existing = itemsMap.get(fileName);

          if (existing) {
            existing.captured_at = row.captured_at || existing.captured_at;
            existing.uploaded_at = row.uploaded_at || existing.uploaded_at;
            existing.type = row.type || existing.type;
          } else {
            itemsMap.set(fileName, {
              id: row.id,
              device_id: devId,
              file_path: row.file_path,
              publicUrl: getPublicUrl(row.file_path),
              type: row.type || (fileName.includes('intruder') ? 'intruder' : 'on_demand'),
              captured_at: row.captured_at || new Date().toISOString(),
              uploaded_at: row.uploaded_at || row.captured_at || new Date().toISOString(),
            });
          }
        }
      }

      const sortedPhotos = Array.from(itemsMap.values()).sort((a, b) => {
        return new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime();
      });

      setPhotos(sortedPhotos);
    } catch (e: any) {
      setError('Failed to load photos: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Realtime sync for live intruder captures ──────────────────────────────
  useEffect(() => {
    if (!deviceId) return;

    const channel = supabase
      .channel(`photos-realtime-${deviceId}`)
      // Fallback: Listen to the photo_captures table if replication is enabled
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
      // Reliable: Listen to devices table which is definitely replicated
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'devices',
          filter: `id=eq.${deviceId}`,
        },
        (payload: any) => {
          if (payload.new && payload.new.latest_photo_url) {
             setPhotos(prev => {
                const isNew = !prev.some(p => p.file_path === payload.new.latest_photo_url);
                if (isNew) {
                   setTimeout(() => fetchPhotos(deviceId, mobileNumber), 500);
                }
                return prev;
             });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, mobileNumber]);

  // ── Lightbox controls ──────────────────────────────────────────────────────
  const openLightbox = (idx: number) => {
    if (selectMode) { toggleSelect(photos[idx].id); return; }
    setLightboxIdx(idx);
    setZoom(1);
  };

  const closeLightbox = () => { setLightboxIdx(null); setZoom(1); };

  const goNext = () => {
    if (lightboxIdx === null) return;
    setLightboxIdx((lightboxIdx + 1) % photos.length);
    setZoom(1);
  };

  const goPrev = () => {
    if (lightboxIdx === null) return;
    setLightboxIdx((lightboxIdx - 1 + photos.length) % photos.length);
    setZoom(1);
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (lightboxIdx === null) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === '+') setZoom(z => Math.min(z + 0.25, 4));
      if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.5));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx, photos.length]);

  // ── Select mode ────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === photos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(photos.map(p => p.id)));
    }
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  // ── Download single ────────────────────────────────────────────────────────
  const downloadSingle = async (photo: PhotoCapture) => {
    try {
      const res = await fetch(photo.publicUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = getFilename(photo.file_path);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError('Download failed: ' + e.message);
    }
  };

  // ── Download bulk (zip) ────────────────────────────────────────────────────
  const downloadSelected = async () => {
    const toDownload = photos.filter(p => selected.has(p.id));
    if (toDownload.length === 0) return;
    if (toDownload.length > MAX_BULK_DOWNLOAD) {
      setActionMsg(`⚠️ Maximum ${MAX_BULK_DOWNLOAD} photos at once. You selected ${toDownload.length}.`);
      return;
    }

    setActionLoading(true);
    setActionMsg(`Preparing ${toDownload.length} photos…`);

    try {
      const zip = new JSZip();
      await Promise.all(toDownload.map(async (photo) => {
        const res = await fetch(photo.publicUrl);
        const blob = await res.blob();
        zip.file(getFilename(photo.file_path), blob);
      }));

      setActionMsg('Building zip…');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `mobtrack_photos_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setActionMsg(`✅ Downloaded ${toDownload.length} photos`);
    } catch (e: any) {
      setActionMsg('❌ Download failed: ' + e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deletePhotos = async (filePaths: string[], ids: string[]) => {
    if (!confirm(`Permanently delete ${filePaths.length} photo${filePaths.length > 1 ? 's' : ''}? This cannot be undone.`)) return;

    setActionLoading(true);
    setActionMsg('Deleting…');

    try {
      const res = await fetch('/api/photo/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(`Delete failed: ${result.error || 'Unknown error'}`);

      // Remove from local state
      setPhotos(prev => prev.filter(p => !ids.includes(p.id)));
      setSelected(new Set());
      setActionMsg(`✅ Deleted ${filePaths.length} photo${filePaths.length > 1 ? 's' : ''}`);
      setTimeout(() => setActionMsg(''), 3000);
    } catch (e: any) {
      setActionMsg('❌ ' + e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const deleteSelected = () => {
    const toDelete = photos.filter(p => selected.has(p.id));
    deletePhotos(toDownloadPaths(toDelete), toDelete.map(p => p.id));
  };

  const toDownloadPaths = (list: PhotoCapture[]) => list.map(p => p.file_path);

  const currentPhoto = lightboxIdx !== null ? photos[lightboxIdx] : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen cyber-bg text-slate-100 flex flex-col relative">
      
      {/* Ambient background glow orb */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[80vw] max-w-[700px] h-[300px] bg-emerald-500/10 blur-[120px] rounded-full" />
      </div>

      {/* 3D Cyber Particle Mesh (Ultra-lightweight WebGL) */}
      <CyberBackground3D />

      {/* Top bar (Responsive & Never Swallowed) */}
      <header className="sticky top-0 z-30 bg-[#070a10]/85 backdrop-blur-[24px] border-b border-emerald-500/20 px-3.5 sm:px-6 py-3 sm:py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3 font-mono">
          <Link
            href="/track?restore=1"
            className="cyber-btn flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-emerald-500/30 active:scale-95"
          >
            <span>←</span>
            <span>BACK TO MAP</span>
          </Link>
          <div className="h-4 w-px bg-emerald-500/20 hidden sm:block" />
          <h1 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2 font-mono">
            <span>PHOTOS</span>
            {!loading && (
              <span className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                {photos.length} {photos.length === 1 ? 'PHOTO' : 'PHOTOS'}
              </span>
            )}
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap font-mono">
          {actionMsg && (
            <span className="text-xs text-amber-300 bg-amber-950/70 border border-amber-500/50 px-3 py-1 rounded shadow-sm">
              {actionMsg}
            </span>
          )}

          <button
            onClick={() => deviceId && fetchPhotos(deviceId, mobileNumber)}
            disabled={loading}
            className="cyber-btn text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-emerald-500/30 text-slate-200 transition active:scale-95 flex items-center gap-1"
            title="Refresh Photos"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
            <span className="hidden sm:inline">REFRESH</span>
          </button>

          {!selectMode ? (
            photos.length > 0 && (
              <button
                onClick={() => setSelectMode(true)}
                className="cyber-btn cyber-btn-emerald text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition active:scale-95"
              >
                SELECT
              </button>
            )
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap font-mono">
              <button
                onClick={toggleSelectAll}
                className="cyber-btn text-xs px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-emerald-500/30 transition"
              >
                {selected.size === photos.length ? 'DESELECT' : 'SELECT ALL'}
              </button>
              <button
                onClick={downloadSelected}
                disabled={selected.size === 0 || actionLoading}
                className="cyber-btn cyber-btn-emerald text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 text-white transition flex items-center gap-1 shadow-sm active:scale-95"
              >
                ⬇ DOWNLOAD ({selected.size})
              </button>
              <button
                onClick={deleteSelected}
                disabled={selected.size === 0 || actionLoading}
                className="cyber-btn cyber-btn-rose text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 text-white transition shadow-sm active:scale-95"
              >
                🗑 DELETE ({selected.size})
              </button>
              <button
                onClick={exitSelectMode}
                className="cyber-btn text-xs px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/10 transition"
              >
                CANCEL
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-3.5 sm:p-6 max-w-7xl mx-auto w-full relative z-10">
        {error && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-slate-400">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono tracking-wider uppercase">LOADING PHOTOS…</p>
          </div>
        ) : photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-slate-500 p-6 text-center">
            <span className="text-5xl opacity-40">📷</span>
            <p className="text-base font-bold text-slate-300">NO PHOTOS YET</p>
            <p className="text-xs text-slate-500 max-w-sm">
              Photos taken by your phone or when someone enters a wrong PIN will show here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {photos.map((photo, idx) => (
              <PhotoThumbnail
                key={photo.id}
                photo={photo}
                isSelected={selected.has(photo.id)}
                selectMode={selectMode}
                onClick={() => openLightbox(idx)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Fullscreen Lightbox ────────────────────────────────────────────── */}
      {currentPhoto && lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col select-none"
          onClick={closeLightbox}
        >
          {/* Lightbox header */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-[#070a10]/95 border-b border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-xs font-bold text-white font-mono">{getFilename(currentPhoto.file_path)}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                Captured: {formatDate(currentPhoto.captured_at)}
              </p>
              <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                currentPhoto.type === 'intruder'
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                  : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
              }`}>
                {currentPhoto.type === 'intruder' ? '🚨 WRONG PIN PHOTO' : '📸 PHONE PHOTO'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => setZoom(z => Math.min(z + 0.5, 4))}
                className="text-xs px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/10 transition"
                title="Zoom in (+)"
              >
                🔍+
              </button>
              <button
                onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))}
                className="text-xs px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/10 transition"
                title="Zoom out (-)"
              >
                🔍-
              </button>
              <button
                onClick={() => downloadSingle(currentPhoto)}
                className="cyber-btn cyber-btn-emerald text-xs px-3 py-1.5 rounded-xl text-white font-bold transition flex items-center gap-1 shadow"
              >
                ⬇ DOWNLOAD
              </button>
              <button
                onClick={() => {
                  deletePhotos([currentPhoto.file_path], [currentPhoto.id]);
                  closeLightbox();
                }}
                className="text-xs px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold transition shadow"
              >
                🗑 DELETE
              </button>
              <button
                onClick={closeLightbox}
                className="text-slate-400 hover:text-white text-lg font-bold px-2.5 py-1 rounded-xl hover:bg-white/10"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Lightbox image area */}
          <div
            className="flex-1 relative flex items-center justify-center overflow-hidden p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Prev button */}
            <button
              onClick={goPrev}
              className="absolute left-3 z-10 w-11 h-11 bg-black/60 hover:bg-black/90 border border-white/10 rounded-full text-white text-2xl flex items-center justify-center transition shadow-lg active:scale-95"
            >
              ‹
            </button>

            {currentPhoto.publicUrl ? (
              <div className="overflow-auto max-w-full max-h-full flex items-center justify-center">
                <img
                  src={currentPhoto.publicUrl}
                  alt={getFilename(currentPhoto.file_path)}
                  style={{
                    transform: `scale(${zoom})`,
                    transition: 'transform 0.2s',
                    transformOrigin: 'center center',
                    maxWidth: '100%',
                    maxHeight: '82vh',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 15px 30px rgba(0,0,0,0.8))'
                  }}
                  onWheel={(e) => {
                    e.preventDefault();
                    setZoom(z => Math.min(Math.max(z - e.deltaY * 0.001, 0.5), 4));
                  }}
                />
              </div>
            ) : (
              <p className="text-slate-500">Failed to render image</p>
            )}

            {/* Next button */}
            <button
              onClick={goNext}
              className="absolute right-3 z-10 w-11 h-11 bg-black/60 hover:bg-black/90 border border-white/10 rounded-full text-white text-2xl flex items-center justify-center transition shadow-lg active:scale-95"
            >
              ›
            </button>
          </div>

          {/* Lightbox footer */}
          <div className="px-4 py-2 text-center text-xs text-slate-500 border-t border-white/10 font-mono bg-[#000814]/80">
            {lightboxIdx + 1} / {photos.length} · Scroll to zoom · ‹ › to navigate · Esc to close
          </div>
        </div>
      )}
    </div>
  );
}

// ── PhotoThumbnail sub-component ─────────────────────────────────────────────

type ThumbProps = {
  photo: PhotoCapture;
  isSelected: boolean;
  selectMode: boolean;
  onClick: () => void;
};

function PhotoThumbnail({ photo, isSelected, selectMode, onClick }: ThumbProps) {
  const [thumbError, setThumbError] = useState(false);

  return (
    <div
      onClick={onClick}
      className={`bracket-box relative aspect-square rounded-xl overflow-hidden cursor-pointer group border transition-all duration-300 ${
        isSelected
          ? 'border-emerald-400 ring-2 ring-emerald-400/50 scale-95 shadow-lg shadow-emerald-950/50'
          : 'border-emerald-500/20 hover:border-emerald-400/60 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] bg-[#070a10]'
      }`}
    >
      {/* Thumbnail image */}
      {!thumbError && photo.publicUrl ? (
        <img
          src={photo.publicUrl}
          alt={photo.file_path}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          onError={() => setThumbError(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-slate-950 flex items-center justify-center text-slate-600 text-sm font-mono p-2 text-center">
          ⚠️ NOT AVAILABLE
        </div>
      )}

      {/* Type badge */}
      <div className={`absolute top-2 left-2 text-[9px] font-mono font-bold px-2 py-0.5 rounded shadow-md backdrop-blur ${
        photo.type === 'intruder'
          ? 'bg-rose-600/90 text-white border border-rose-400/40'
          : 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
      }`}>
        {photo.type === 'intruder' ? '🚨 WRONG PIN' : '📸 PHOTO'}
      </div>

      {/* Select checkbox */}
      {selectMode && (
        <div className={`absolute top-2 right-2 w-5 h-5 rounded border flex items-center justify-center transition shadow ${
          isSelected ? 'bg-emerald-500 border-emerald-400 text-black' : 'bg-black/60 border-emerald-500/40'
        }`}>
          {isSelected && <span className="text-[10px] font-mono font-black">✓</span>}
        </div>
      )}

      {/* Hover overlay with timestamp */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5 font-mono">
        <p className="text-[10px] text-white font-semibold leading-tight">
          {formatDate(photo.captured_at)}
        </p>
        <span className="text-[9px] text-emerald-400 mt-0.5">VIEW PHOTO →</span>
      </div>
    </div>
  );
}


