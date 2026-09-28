// Vercel Serverless Function: Public Configuration
// Exposes public Supabase connection details (safe for frontend)

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL || 'https://miipmgzjxpyokchrctdj.supabase.co';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paXBtZ3pqeHB5b2tjaHJjdGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjYyMjMsImV4cCI6MjEwNjE0MjIyM30.SfEbfXimbA7VTZrRYzgJLezH6fv64QWR6yYuHnbHUMQ';
  const customDomain = process.env.CUSTOM_DOMAIN || 'rigeel.id';

  res.status(200).json({
    configured: Boolean(supabaseUrl && supabaseAnonKey),
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    customDomain: customDomain
  });
}
