import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const { trusteeMobile, otpInput, deviceId } = await req.json();

    if (!trusteeMobile || !otpInput || !deviceId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const { error: verifyErr } = await supabase.auth.verifyOtp({ 
      phone: '+91' + trusteeMobile, 
      token: otpInput, 
      type: 'sms' 
    });

    if (verifyErr) {
      return NextResponse.json({ error: `Invalid OTP: ${verifyErr.message}` }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set('device_session', deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    });

    return NextResponse.json({ success: true, deviceId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
