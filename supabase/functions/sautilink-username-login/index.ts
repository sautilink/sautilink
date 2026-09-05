import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const ALLOWED_ORIGINS = new Set([
  'https://sautilink.com',
  'https://www.sautilink.com',
  'https://test.sautilink.com',
]);
const GENERIC_LOGIN_ERROR = 'Incorrect email/username or password.';

function parseKeyMap(name: string) {
  const raw = Deno.env.get(name) || '';
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return Object.values(parsed).filter((value): value is string => typeof value === 'string' && Boolean(value));
    }
  } catch {
    if (raw.trim()) return [raw.trim()];
  }
  return [] as string[];
}

function firstKey(plural: string, legacy: string) {
  return parseKeyMap(plural)[0] || Deno.env.get(legacy) || '';
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://sautilink.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(request: Request, status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function invalidCredentials(request: Request) {
  return json(request, 401, {
    ok: false,
    error: { code: 'INVALID_CREDENTIALS', message: GENERIC_LOGIN_ERROR },
  });
}

function normalizeUsername(value: unknown) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, 403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This request is not allowed.' } });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') {
    return json(request, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for login.' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const publishableKeys = parseKeyMap('SUPABASE_PUBLISHABLE_KEYS');
  const publishableKey = publishableKeys[0] || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const secretKey = firstKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const suppliedApiKey = request.headers.get('apikey') || '';

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json(request, 503, { ok: false, error: { code: 'LOGIN_NOT_READY', message: 'Login is temporarily unavailable.' } });
  }
  if (!suppliedApiKey || ![...publishableKeys, publishableKey].includes(suppliedApiKey)) {
    return json(request, 401, { ok: false, error: { code: 'API_KEY_REQUIRED', message: 'This request is not authorized.' } });
  }

  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || '');
  if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(username) || !password || password.length > 1024) {
    return invalidCredentials(request);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: profile, error: profileError } = await admin
    .from('account_profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (profileError || !profile?.id) return invalidCredentials(request);

  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.id);
  const email = String(userResult?.user?.email || '').trim().toLowerCase();
  if (userError || !email) return invalidCredentials(request);

  const { data: login, error: loginError } = await authClient.auth.signInWithPassword({ email, password });
  if (loginError || !login.session?.access_token || !login.session?.refresh_token) {
    return invalidCredentials(request);
  }

  return json(request, 200, {
    ok: true,
    data: {
      session: {
        access_token: login.session.access_token,
        refresh_token: login.session.refresh_token,
        token_type: login.session.token_type,
        expires_in: login.session.expires_in,
        expires_at: login.session.expires_at,
      },
    },
  });
});
