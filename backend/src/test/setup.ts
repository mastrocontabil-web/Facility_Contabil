// Env falsas para os testes não dependerem de um .env real.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
// Com o secret setado, o middleware valida o JWT localmente (HS256) e os testes
// não tocam a rede.
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret-please-change';
process.env.PARSER_URL ??= 'http://localhost:8100';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
