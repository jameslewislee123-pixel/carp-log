// Compatibility shim — older imports `import { supabase } from '@/lib/supabase'`
// continue to resolve. Prefer `@/lib/supabase/client` (browser) or
// `@/lib/supabase/server` (server components / route handlers) for new code.
export { supabase, hasSupabase, createClient } from './supabase/client';
