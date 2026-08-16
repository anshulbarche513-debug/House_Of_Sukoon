// House of Sukoon — Supabase browser configuration
// IMPORTANT: use the project root URL, not /rest/v1.
window.SUKOON_SUPABASE_URL = 'https://penkekgsqpgpjtupatag.supabase.co';
window.SUKOON_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxYmVvcXV6YXh3ZWV3bG92Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MDAzOTYsImV4cCI6MjEwMDM3NjM5Nn0.1RffIvgVCk4h8jXD1zXKnP27knmLxgodSIkY2-LPffo

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  console.error(
    'Supabase JS library is not loaded. Load @supabase/supabase-js before supabase-config.js.'
  );
} else {
  window.sukoonSupabase = window.supabase.createClient(
    window.SUKOON_SUPABASE_URL,
    window.SUKOON_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
}
