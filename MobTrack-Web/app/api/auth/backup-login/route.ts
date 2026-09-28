import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { verifyBackupCode } from '@/lib/auth-crypto';

export async function POST(req: NextRequest) {
  try {
    const { mobile_number, ownerName, backupCode } = await req.json();

    if (!mobile_number || !backupCode) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('devices')
      .select('id, backup_codes_hash')
      .eq('mobile_number', mobile_number)
      .ilike('full_name', ownerName || '')
      .single();

    const isCodeValid = await verifyBackupCode(backupCode, data?.backup_codes_hash);
    if (error || !data || !isCodeValid) {
      return NextResponse.json({ error: 'Invalid Name, Mobile Number, or Backup Code' }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set('device_session', data.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    });

    return NextResponse.json({ success: true, deviceId: data.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
