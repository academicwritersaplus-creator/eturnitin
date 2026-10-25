'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);

const config = require('./config');
const { pool } = require('./db');
const migrate = require('./migrate');
const worker = require('./worker');
const { requireAppHeader } = require('./middleware');

const app = express();
if (config.isProd) app.set('trust proxy', 1);   // behind Render / Railway / Nginx HTTPS proxy

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
}));
app.use(express.json({ limit: '100kb' }));

const sessionMiddleware = () => session({
  name: 'timcheck.sid',
  store: new PgStore({ pool, tableName: 'user_sessions', createTableIfMissing: false, pruneSessionInterval: 3600 }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 7 * 24 * 3600 * 1000 },
});
let sessionHandler = null;
app.use((req, res, next) => sessionHandler(req, res, next));

app.use('/api', requireAppHeader);
app.use('/api/auth', require('./routes-auth'));
app.use('/api/documents', require('./routes-documents'));
app.use('/api/admin', require('./routes-admin'));
app.use('/api', require('./routes-public'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// All files live in one folder, so only these four are ever sent to browsers.
// Code files, settings and uploads are never served.
const PUBLIC_FILES = { '/styles.css': 'styles.css', '/app.js': 'app.js', '/favicon.svg': 'favicon.svg' };
for (const [route, file] of Object.entries(PUBLIC_FILES)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file), { maxAge: config.isProd ? '1h' : 0 }));
}
app.get('/{*any}', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

// Uses SESSION_SECRET if set. Otherwise creates a random secret once and keeps
// it in the database, so logins survive restarts with no extra setup.
async function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const fresh = require('crypto').randomBytes(48).toString('hex');
  await pool.query(`INSERT INTO app_settings (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`, [fresh]);
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'session_secret'`);
  return rows[0].value;
}

async function main() {
  await migrate();
  config.sessionSecret = await getSessionSecret();
  sessionHandler = sessionMiddleware();
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM sources');
  if (!rows[0].n) {
    console.log('[setup] Loading the sample collection for the first time...');
    await require('./seed').seedSamples();
  }
  if (config.runWorkerInWeb) worker.start();
  app.listen(config.port, () => console.log(`TimCheck running at ${config.appUrl} (port ${config.port})`));
}

if (require.main === module) {
  main().catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
}

module.exports = app;
