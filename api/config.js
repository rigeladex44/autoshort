// Vercel Serverless Function: Public Configuration
// Exposes public Supabase connection details (safe for frontend)

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const customDomain = process.env.CUSTOM_DOMAIN || 'rigeel.id';

  res.status(200).json({
    configured: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    customDomain: customDomain
  });
}
