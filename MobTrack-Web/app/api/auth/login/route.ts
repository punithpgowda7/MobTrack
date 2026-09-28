import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { verifyPassword, hashPassword } from '@/lib/auth-crypto';

export async function POST(req: NextRequest) {
  try {
    const { mobile_number, password } = await req.json();

    if (!mobile_number || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('devices')
      .select('id, password_hash')
      .eq('mobile_number', mobile_number)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Invalid Mobile Number' }, { status: 401 });
    }

    const isValid = await verifyPassword(password, data.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: 'Incorrect Password' }, { status: 401 });
    }

    // Transparent hash upgrade: if legacy plaintext was verified, upgrade to PBKDF2 hash
    if (data.password_hash && !data.password_hash.startsWith('pbkdf2:sha256:')) {
      try {
        const upgradedHash = await hashPassword(password);
        await supabase
          .from('devices')
          .update({ password_hash: upgradedHash })
          .eq('id', data.id);
      } catch {
        // Non-blocking opportunistic upgrade
      }
    }

    // Set secure HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set('device_session', data.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    return NextResponse.json({ success: true, deviceId: data.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
