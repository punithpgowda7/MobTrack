import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  { auth: { persistSession: false } }
);

/**
 * DELETE /api/photo/delete
 * Uses device_session cookie for auth.
 */
export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies();
  const deviceId = cookieStore.get('device_session')?.value;

  if (!deviceId) {
    return NextResponse.json({ error: 'Missing deviceId / Not logged in' }, { status: 401 });
  }

  let filePaths: string[];
  try {
    const body = await req.json();
    filePaths = body.filePaths;
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json({ error: 'filePaths must be a non-empty array' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Security: every path must belong to this device's folder
  const forbidden = filePaths.filter((p) => !p.startsWith(`${deviceId}/`));
  if (forbidden.length > 0) {
    return NextResponse.json({ error: 'Forbidden: paths outside your device folder' }, { status: 403 });
  }

  // 1. Delete from Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('device_media')
    .remove(filePaths);

  if (storageError) {
    return NextResponse.json({ error: `Storage delete failed: ${storageError.message}` }, { status: 500 });
  }

  // 2. Delete rows from photo_captures table
  const { error: dbError } = await supabase
    .from('photo_captures')
    .delete()
    .in('file_path', filePaths)
    .eq('device_id', deviceId);

  if (dbError) {
    return NextResponse.json({ error: `DB delete failed: ${dbError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted: filePaths.length });
}
