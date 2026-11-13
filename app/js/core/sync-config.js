// Public Supabase project for optional phone ↔ computer sync.
// The URL and publishable key are designed to be public (they are the
// browser-safe credentials). There is no service/secret key here.
// Row Level Security is what keeps one person's items from another.

export const SUPABASE_URL = "https://novwnajwmsrrdgarvbry.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_s9SLLBrSi2OzDjlq9ynqAA_xVyZw-B8";
export const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
export const PHOTOS_BUCKET = "photos";
export const SYNC_CLOUD_EDGE = 1600;
export const SYNC_JPEG_QUALITY = 0.84;

// Email 6-digit OTP is implemented but hidden. The free plan cannot
// edit the Auth email template without custom SMTP, so sign-in is a
// pairing code. Set this to true only after a domain and a template
// that shows {{ .Token }} (and no magic-link URL) are in place.
export const EMAIL_SYNC_ENABLED = false;
