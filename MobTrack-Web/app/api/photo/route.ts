import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  { auth: { persistSession: false } }
);

/**
 * GET /api/photo?filePath=<path>
 * Uses device_session cookie for auth.
 */
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get('filePath');
  const cookieStore = await cookies();
  const deviceId = cookieStore.get('device_session')?.value;

  if (!filePath || !deviceId) {
    return NextResponse.json({ error: 'Missing filePath or not logged in' }, { status: 400 });
  }

  // Security check: can only access own device's folder
  if (!filePath.startsWith(`${deviceId}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase.storage
    .from('device_media')
    .createSignedUrl(filePath, 300); // 5-minute expiry

  if (error || !data?.signedUrl) {
    console.error('[/api/photo] createSignedUrl error:', error?.message, 'filePath:', filePath);
    return NextResponse.json({ error: error?.message ?? 'Failed to generate URL' }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
