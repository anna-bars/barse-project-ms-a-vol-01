import { createClient } from '@supabase/supabase-js';

// Serves ms_a.riv from a PRIVATE Supabase bucket.
// The secret key stays on the server (never NEXT_PUBLIC_), the bucket stays private.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = process.env.RIVE_BUCKET || 'rive-assets';
const FILE = process.env.RIVE_FILE || 'blazer_ms_a.riv';

export async function GET(request) {
  const h = request.headers;

  // Block opening the URL directly in the address bar / as a download link.
  const dest = h.get('sec-fetch-dest');
  const site = h.get('sec-fetch-site');
  if (dest === 'document' || dest === 'iframe' || dest === 'embed') {
    return new Response('Forbidden', { status: 403 });
  }
  // Block other websites hot-linking the file.
  if (site && site !== 'same-origin' && site !== 'same-site') {
    return new Response('Forbidden', { status: 403 });
  }
  const origin = h.get('origin') || h.get('referer');
  if (origin) {
    try {
      if (new URL(origin).host !== h.get('host')) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return new Response('Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY', { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.storage.from(BUCKET).download(FILE);
  if (error || !data) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
