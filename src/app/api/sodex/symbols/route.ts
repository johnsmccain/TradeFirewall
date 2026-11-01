import { NextResponse } from 'next/server';
import { sodexAPI } from '@/lib/sodex';

export async function GET() {
  try {
    const symbols = await sodexAPI.getSupportedSpotSymbols();
    return NextResponse.json({ network: sodexAPI.configuredNetwork, symbols });
  } catch (error) {
    console.error('SoDEX symbol lookup error:', error);
    return NextResponse.json(
      { error: 'Unable to load the SoDEX market list. Please try again.' },
      { status: 503 }
    );
  }
}
