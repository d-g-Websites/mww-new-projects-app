import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { engine } from 'express-handlebars';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

// Views — express-handlebars with the default partials/layouts layout.
app.engine('handlebars', engine({
  defaultLayout: 'main',
  layoutsDir: join(__dirname, 'views', 'layouts'),
  partialsDir: join(__dirname, 'views', 'partials'),
  helpers: {
    // Sub-expression helpers used by the service-specific form partials.
    eq:  (a, b) => a === b,
    concat: function () {
      // Last arg is the Handlebars options object — drop it.
      return Array.prototype.slice.call(arguments, 0, -1).join('');
    },
    // Accept either an array (multi-checkbox) or a single string
    // (re-submitted single checkbox value) so the form re-renders
    // correctly on collision.
    includes: (haystack, needle) => {
      if (!haystack) return false;
      if (Array.isArray(haystack)) return haystack.includes(needle);
      return haystack === needle;
    },
  },
}));
app.set('view engine', 'handlebars');
app.set('views', join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  name: 'mww.sid',
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12, // 12h — a full crew day
  },
}));

app.use('/', authRouter);
app.use('/', projectsRouter);

// Global error handler — surfaces stack only in non-prod.
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message,
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`MWW dashboard listening on http://localhost:${port}`);
});
