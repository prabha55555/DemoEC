// One command to run the whole store locally against the fake backend:
//   node tools/devstack/run.mjs            (from the project root)
//
// Starts (1) the fake Supabase + API host (real Postgres via PGlite, the project's real api/*.js, a fake
// Razorpay) loaded with schema.sql + the demo catalogue, and (2) the React dev server pointed at it.
//   Store  http://localhost:3002     API host http://localhost:3100     "Supabase" http://localhost:54321
//   Admin login:  admin@example.test / admin-pass-1     Customer:  shopper@example.test / shopper-pass-1
// Nothing here talks to a real Supabase, Razorpay, Brevo or WhatsApp account.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PORT = process.env.PORT || '3002';

const backend = spawn(process.execPath, [path.join(HERE, 'server.mjs'),
  '--sql', path.join(ROOT, 'supabase/schema.sql'), '--seed', path.join(ROOT, 'supabase/demo-seed.sql'), '--accounts'], { stdio: 'inherit', cwd: HERE });

const bin = path.join(ROOT, 'node_modules/react-scripts/bin/react-scripts.js');
const store = spawn(process.execPath, [bin, 'start'], {
  cwd: ROOT, stdio: 'inherit',
  env: {
    ...process.env, PORT, BROWSER: 'none',
    REACT_APP_SUPABASE_URL: 'http://localhost:54321',
    REACT_APP_SUPABASE_ANON_KEY: 'dev-anon-key',
    REACT_APP_ADMIN_EMAIL: 'admin@example.test',
    DEV_API_PROXY: 'http://localhost:3100',
  },
});
const stop = () => { backend.kill(); store.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
backend.on('exit', () => store.kill());
store.on('exit', () => backend.kill());
