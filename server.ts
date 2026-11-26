import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { initPostgres, isPostgresEnabled, kvGet, kvSet } from './server/db.ts';
import { initAgencyStore, loadAgencyState, resetAgencyState, saveAgencyState } from './server/store.ts';
import {
  deleteMemberPassword,
  hasMemberPassword,
  initCredentialsStore,
  setMemberPassword,
  verifyMemberPassword,
} from './server/credentials.ts';
import type {
  AgencyAppointment,
  AgencyState,
  ClientProject,
  FinanceEntry,
  KanbanTask,
  Prospect,
  TeamMember,
  ThirdPartyProviderStatus,
} from './src/types.ts';
import {
  evaluateProjectLegalCompliance,
  generateLegalNoticeText,
  normalizeProject,
} from './src/lib/legalCompliance.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'awj_sid';
const AUTH_COOKIE = 'omnix_auth';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? (JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8')) as { apiKey?: string; projectId?: string })
  : {};

const SESSION_SECRET_KV_KEY = 'session_secret';
let cachedCookieSecret: string | null = null;

async function initSessionSecret(): Promise<void> {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    cachedCookieSecret = process.env.SESSION_SECRET;
    return;
  }

  const dataDir = path.resolve(process.cwd(), '.data');
  const secretPath = path.join(dataDir, '.session-secret');
  let localSecret = '';
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf-8').trim();
      if (existing.length >= 32) {
        localSecret = existing;
      }
    }
  } catch {
    localSecret = '';
  }

  if (isPostgresEnabled()) {
    const stored = await kvGet<string>(SESSION_SECRET_KV_KEY);
    if (typeof stored === 'string' && stored.length >= 32) {
      cachedCookieSecret = stored;
      return;
    }
    const secret = localSecret || crypto.randomBytes(32).toString('hex');
    await kvSet(SESSION_SECRET_KV_KEY, secret);
    cachedCookieSecret = secret;
    return;
  }

  if (localSecret) {
    cachedCookieSecret = localSecret;
    return;
  }

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, generated, { encoding: 'utf-8', mode: 0o600 });
    cachedCookieSecret = generated;
  } catch {
    cachedCookieSecret = crypto.randomBytes(32).toString('hex');
  }
}

function getAuthCookieSecret(): string {
  if (cachedCookieSecret) return cachedCookieSecret;
  cachedCookieSecret = crypto.randomBytes(32).toString('hex');
  return cachedCookieSecret;
}

function signAuthCookie(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), iat: Date.now() })).toString(
    'base64url'
  );
  const sig = crypto.createHmac('sha256', getAuthCookieSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAuthCookie(token?: string): { email: string } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getAuthCookieSecret()).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { email?: string };
    if (!parsed.email) return null;
    return { email: parsed.email.toLowerCase() };
  } catch {
    return null;
  }
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ email: string; name: string; photoUrl: string }> {
  if (!firebaseConfig.apiKey) {
    throw new Error('Configuration Firebase manquante sur le serveur.');
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  const data = (await resp.json()) as any;
  const user = data?.users?.[0];
  if (!resp.ok || !user?.email) {
    throw new Error('Jeton Google invalide ou expiré.');
  }
  return {
    email: String(user.email).trim().toLowerCase(),
    name: String(user.displayName || '').trim(),
    photoUrl: String(user.photoUrl || '').trim(),
  };
}

function getCookieOptions(req: Request, maxAge?: number) {
  const isHttps =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim() === 'https';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

function setAuthCookie(req: Request, res: Response, email: string): void {
  const signed = signAuthCookie(email);
  res.cookie(AUTH_COOKIE, signed, getCookieOptions(req, 30 * 24 * 60 * 60 * 1000));
}

function clearAuthCookie(req: Request, res: Response): void {
  res.clearCookie(AUTH_COOKIE, getCookieOptions(req));
}

function ensureMemberInState(
  state: AgencyState,
  opts: { email: string; name?: string; photoUrl?: string; preferredRole?: TeamMember['role'] }
): { member: TeamMember; changed: boolean } {
  const cleanEmail = opts.email.trim().toLowerCase();
  let member = state.members.find(
    (m) => m.email && m.email.trim().toLowerCase() === cleanEmail
  );
  let changed = false;

  if (!member) {
    const roleFallback: TeamMember['role'] =
      state.members.length === 0 ? 'Chef de projet' : 'Développeur';
    member = {
      id: `mem-${Date.now()}`,
      name: (opts.name || '').trim() || cleanEmail.split('@')[0],
      email: cleanEmail,
      photoUrl: opts.photoUrl,
      role: opts.preferredRole || roleFallback,
      weeklyHours: 0,
      maxWeeklyHours: 5,
      parentApproved: false,
      parentName: 'À renseigner',
      schoolPriorityOk: true,
    };
    state.members.push(member);
    changed = true;
  } else {
    if (opts.name && opts.name.trim() && member.name !== opts.name.trim()) {
      member.name = opts.name.trim();
      changed = true;
    }
    if (opts.photoUrl && member.photoUrl !== opts.photoUrl) {
      member.photoUrl = opts.photoUrl;
      changed = true;
    }
  }

  return { member, changed };
}

function buildAccessList(state: AgencyState) {
  return state.settings.allowedEmails.map((email) => ({
    email,
    isAdmin: state.settings.adminEmails.includes(email),
    hasPassword: hasMemberPassword(email),
  }));
}

type ProviderName = 'github' | 'discord' | 'figma' | 'netlify';

interface ProviderToken {
  accessToken: string;
  accountName: string;
  accountHandle: string;
  avatarUrl?: string;
}

const sessionStore = new Map<string, Partial<Record<ProviderName, ProviderToken>>>();
const pendingStates = new Map<string, { sid: string; provider: ProviderName; createdAt: number }>();

function getAppBaseUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function getOrCreateSessionId(req: Request, res: Response): string {
  let sid = req.cookies?.[SESSION_COOKIE];
  if (!sid || typeof sid !== 'string') {
    sid = crypto.randomBytes(24).toString('hex');
    res.cookie(SESSION_COOKIE, sid, getCookieOptions(req, 30 * 24 * 60 * 60 * 1000));
  }
  if (!sessionStore.has(sid)) {
    sessionStore.set(sid, {});
  }
  return sid;
}

function getProviderConfig(provider: ProviderName) {
  switch (provider) {
    case 'github':
      return {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scope: 'repo read:user',
      };
    case 'discord':
      return {
        clientId: process.env.DISCORD_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        authUrl: 'https://discord.com/api/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        scope: 'identify guilds',
      };
    case 'figma':
      return {
        clientId: process.env.FIGMA_CLIENT_ID || '',
        clientSecret: process.env.FIGMA_CLIENT_SECRET || '',
        authUrl: 'https://www.figma.com/oauth',
        tokenUrl: 'https://api.figma.com/v1/oauth/token',
        scope: 'file_read',
      };
    case 'netlify':
      return {
        clientId: process.env.NETLIFY_CLIENT_ID || '',
        clientSecret: process.env.NETLIFY_CLIENT_SECRET || '',
        authUrl: 'https://app.netlify.com/authorize',
        tokenUrl: 'https://api.netlify.com/oauth/token',
        scope: '',
      };
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('La clé GEMINI_API_KEY est absente ou non configurée dans les secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractHtmlDocument(rawText: string): string {
  const fenced = rawText.match(/```html\s*([\s\S]*?)```/i) || rawText.match(/```\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : rawText).trim();
  return candidate;
}

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

async function startServer() {
  const postgresReady = await initPostgres();
  await initSessionSecret();
  await initAgencyStore();
  await initCredentialsStore();
  console.log(
    postgresReady
      ? 'Omnix persistence: PostgreSQL (DATABASE_URL) actif.'
      : 'Omnix persistence: stockage local (.data/*.json). Configurez DATABASE_URL pour persister sur Render.'
  );

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  // --- Access Gate & Auth Session Endpoints (publicly reachable) ---
  app.get('/api/auth/gate', (req, res) => {
    const state = loadAgencyState();
    const verifiedCookie = verifyAuthCookie(req.cookies?.[AUTH_COOKIE]);
    const email = verifiedCookie?.email || null;
    const isAllowed = Boolean(email && state.settings.allowedEmails.includes(email));
    const isAdmin = Boolean(email && state.settings.adminEmails.includes(email));
    const hasPasswordAdmin = state.settings.allowedEmails.some((e) => hasMemberPassword(e));

    res.json({
      lockEnabled: state.settings.lockEnabled,
      agencyName: state.settings.agencyName,
      hasAdmin: state.settings.allowedEmails.length > 0 && hasPasswordAdmin,
      authenticated: Boolean(email),
      authorized: state.settings.lockEnabled ? isAllowed : true,
      email,
      isAdmin,
      hasPassword: email ? hasMemberPassword(email) : false,
    });
  });

  app.post('/api/auth/register-admin', asyncRoute(async (req, res) => {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Veuillez saisir une adresse e-mail valide.' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
      return;
    }

    const state = loadAgencyState();
    const hasPasswordAdmin = state.settings.allowedEmails.some((e) => hasMemberPassword(e));
    if (state.settings.allowedEmails.length > 0 && hasPasswordAdmin) {
      res.status(403).json({
        error: 'Un administrateur existe déjà. Connectez-vous avec votre e-mail et votre mot de passe.',
      });
      return;
    }

    await setMemberPassword(cleanEmail, password);
    state.settings.allowedEmails = [cleanEmail];
    state.settings.adminEmails = [cleanEmail];
    ensureMemberInState(state, {
      email: cleanEmail,
      name: name?.trim() || cleanEmail.split('@')[0],
      preferredRole: 'Chef de projet',
    });
    await saveAgencyState(state);

    setAuthCookie(req, res, cleanEmail);
    res.json({
      authorized: true,
      email: cleanEmail,
      isAdmin: true,
    });
  }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !password) {
      res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
      return;
    }

    const state = loadAgencyState();
    if (state.settings.allowedEmails.length === 0) {
      res.status(400).json({
        error: 'Aucun compte administrateur créé pour l’instant. Initialisez le premier accès ci-dessus.',
      });
      return;
    }

    if (state.settings.lockEnabled && !state.settings.allowedEmails.includes(cleanEmail)) {
      clearAuthCookie(req, res);
      res.status(403).json({
        error: `Accès refusé pour ${cleanEmail}. Cet e-mail n’est pas dans la liste autorisée d’${state.settings.agencyName}.`,
        code: 'NOT_ALLOWLISTED',
      });
      return;
    }

    if (!hasMemberPassword(cleanEmail)) {
      res.status(401).json({
        error: 'Aucun mot de passe n’est défini pour cet e-mail. Connectez-vous avec Google ou demandez à un administrateur de définir votre mot de passe dans Équipe & Caisse.',
        code: 'PASSWORD_NOT_SET',
      });
      return;
    }

    if (!verifyMemberPassword(cleanEmail, password)) {
      res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
      return;
    }

    const { changed } = ensureMemberInState(state, { email: cleanEmail });
    if (changed) {
      await saveAgencyState(state);
    }

    setAuthCookie(req, res, cleanEmail);
    res.json({
      authorized: true,
      email: cleanEmail,
      isAdmin: state.settings.adminEmails.includes(cleanEmail),
    });
  }));

  app.post('/api/auth/session', async (req, res) => {
    try {
      const { idToken } = req.body as { idToken?: string };
      if (!idToken) {
        res.status(400).json({ error: 'Jeton d’authentification Google requis.' });
        return;
      }

      const verified = await verifyFirebaseIdToken(idToken);
      const state = loadAgencyState();

      // First-ever user initializes admin & allowlist automatically
      if (state.settings.allowedEmails.length === 0) {
        state.settings.allowedEmails = [verified.email];
        state.settings.adminEmails = [verified.email];
        await saveAgencyState(state);
      }

      if (state.settings.lockEnabled && !state.settings.allowedEmails.includes(verified.email)) {
        clearAuthCookie(req, res);
        res.status(403).json({
          error: `Accès refusé pour ${verified.email}. Cet e-mail n’est pas dans la liste autorisée d’${state.settings.agencyName}.`,
          code: 'NOT_ALLOWLISTED',
          email: verified.email,
        });
        return;
      }

      setAuthCookie(req, res, verified.email);

      res.json({
        authorized: true,
        email: verified.email,
        isAdmin: state.settings.adminEmails.includes(verified.email),
      });
    } catch (err: any) {
      res.status(401).json({ error: err?.message || 'Impossible de vérifier votre compte Google.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(req, res);
    res.json({ ok: true });
  });

  // --- Protect all other /api routes when lockEnabled is active ---
  app.use('/api', (req, res, next) => {
    const state = loadAgencyState();
    const verifiedCookie = verifyAuthCookie(req.cookies?.[AUTH_COOKIE]);
    if (!state.settings.lockEnabled) {
      if (verifiedCookie) {
        (req as any).authEmail = verifiedCookie.email;
      }
      next();
      return;
    }
    if (!verifiedCookie) {
      res.status(401).json({ error: 'Connexion requise pour accéder à Omnix.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!state.settings.allowedEmails.includes(verifiedCookie.email)) {
      res.status(403).json({
        error: `Accès refusé pour ${verifiedCookie.email}.`,
        code: 'NOT_ALLOWLISTED',
        email: verifiedCookie.email,
      });
      return;
    }
    (req as any).authEmail = verifiedCookie.email;
    next();
  });

  // --- Password & Access Management (authenticated) ---
  app.post('/api/auth/change-password', asyncRoute(async (req, res) => {
    const authEmail = ((req as any).authEmail as string | undefined)?.toLowerCase();
    const { newPassword, email } = req.body as { newPassword?: string; email?: string };
    const targetEmail = authEmail || (email || '').trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      res.status(400).json({ error: 'Session utilisateur requise.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
      return;
    }
    await setMemberPassword(targetEmail, newPassword);
    res.json({ ok: true, email: targetEmail });
  }));

  app.get('/api/agency/access/status', (_req, res) => {
    const state = loadAgencyState();
    res.json({ members: buildAccessList(state) });
  });

  app.post('/api/agency/access/member', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const authEmail = ((req as any).authEmail as string | undefined)?.toLowerCase();
    if (
      state.settings.lockEnabled &&
      state.settings.adminEmails.length > 0 &&
      (!authEmail || !state.settings.adminEmails.includes(authEmail))
    ) {
      res.status(403).json({ error: 'Seul un administrateur Omnix peut gérer les accès.' });
      return;
    }

    const { email, password, isAdmin, name } = req.body as {
      email?: string;
      password?: string;
      isAdmin?: boolean;
      name?: string;
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Adresse e-mail invalide.' });
      return;
    }

    if (password !== undefined && password !== '') {
      if (password.length < 6) {
        res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
        return;
      }
      await setMemberPassword(cleanEmail, password);
    }

    if (!state.settings.allowedEmails.includes(cleanEmail)) {
      state.settings.allowedEmails = [...state.settings.allowedEmails, cleanEmail];
    }

    if (typeof isAdmin === 'boolean') {
      if (isAdmin) {
        if (!state.settings.adminEmails.includes(cleanEmail)) {
          state.settings.adminEmails = [...state.settings.adminEmails, cleanEmail];
        }
      } else {
        const remainingAdmins = state.settings.adminEmails.filter((a) => a !== cleanEmail);
        if (remainingAdmins.length === 0) {
          res.status(400).json({ error: 'Au moins un administrateur doit rester actif.' });
          return;
        }
        state.settings.adminEmails = remainingAdmins;
      }
    }

    if (name && name.trim()) {
      ensureMemberInState(state, { email: cleanEmail, name: name.trim() });
    }

    await saveAgencyState(state);
    res.json({ state, accessMembers: buildAccessList(state) });
  }));

  app.delete('/api/agency/access/member', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const authEmail = ((req as any).authEmail as string | undefined)?.toLowerCase();
    if (
      state.settings.lockEnabled &&
      state.settings.adminEmails.length > 0 &&
      (!authEmail || !state.settings.adminEmails.includes(authEmail))
    ) {
      res.status(403).json({ error: 'Seul un administrateur Omnix peut retirer un accès.' });
      return;
    }

    const emailParam = (req.body?.email || req.query?.email || '') as string;
    const cleanEmail = emailParam.trim().toLowerCase();
    if (!cleanEmail) {
      res.status(400).json({ error: 'E-mail requis.' });
      return;
    }

    const nextAdmins = state.settings.adminEmails.filter((a) => a !== cleanEmail);
    const nextAllowed = state.settings.allowedEmails.filter((e) => e !== cleanEmail);
    if (state.settings.lockEnabled && nextAdmins.length === 0) {
      res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur.' });
      return;
    }

    state.settings.allowedEmails = nextAllowed;
    state.settings.adminEmails = nextAdmins;
    await deleteMemberPassword(cleanEmail);
    await saveAgencyState(state);
    res.json({ state, accessMembers: buildAccessList(state) });
  }));

  // --- Agency Shared State API ---
  app.get('/api/agency/state', (_req, res) => {
    const state = loadAgencyState();
    res.json(state);
  });

  app.post('/api/agency/import', asyncRoute(async (req, res) => {
    const current = loadAgencyState();
    const authEmail = ((req as any).authEmail as string | undefined)?.toLowerCase();
    if (
      current.settings.lockEnabled &&
      current.settings.adminEmails.length > 0 &&
      (!authEmail || !current.settings.adminEmails.includes(authEmail))
    ) {
      res.status(403).json({ error: 'Seul un administrateur peut importer une sauvegarde.' });
      return;
    }

    const incoming = req.body as Partial<AgencyState>;
    if (!incoming || !incoming.settings || !Array.isArray(incoming.projects)) {
      res.status(400).json({ error: 'Fichier de sauvegarde Omnix invalide.' });
      return;
    }

    const merged: AgencyState = {
      ...current,
      ...incoming,
      settings: {
        ...current.settings,
        ...incoming.settings,
        allowedEmails:
          Array.isArray(incoming.settings.allowedEmails) && incoming.settings.allowedEmails.length > 0
            ? incoming.settings.allowedEmails
            : current.settings.allowedEmails,
        adminEmails:
          Array.isArray(incoming.settings.adminEmails) && incoming.settings.adminEmails.length > 0
            ? incoming.settings.adminEmails
            : current.settings.adminEmails,
      },
      members: Array.isArray(incoming.members) ? incoming.members : current.members,
      projects: Array.isArray(incoming.projects) ? incoming.projects : current.projects,
      tasks: Array.isArray(incoming.tasks) ? incoming.tasks : current.tasks,
      appointments: Array.isArray(incoming.appointments) ? incoming.appointments : current.appointments,
      prospects: Array.isArray(incoming.prospects) ? incoming.prospects : current.prospects,
      finances: Array.isArray(incoming.finances) ? incoming.finances : current.finances,
      preSaleChecklist: Array.isArray(incoming.preSaleChecklist)
        ? incoming.preSaleChecklist
        : current.preSaleChecklist,
      roadmap: Array.isArray(incoming.roadmap) ? incoming.roadmap : current.roadmap,
    };

    await saveAgencyState(merged);
    res.json({ state: merged });
  }));

  app.post('/api/agency/reset', asyncRoute(async (req, res) => {
    const current = loadAgencyState();
    const authEmail = ((req as any).authEmail as string | undefined)?.toLowerCase();
    if (
      current.settings.lockEnabled &&
      current.settings.adminEmails.length > 0 &&
      (!authEmail || !current.settings.adminEmails.includes(authEmail))
    ) {
      res.status(403).json({ error: 'Seul un administrateur peut réinitialiser l’espace.' });
      return;
    }
    const fresh = await resetAgencyState();
    res.json(fresh);
  }));

  app.post('/api/agency/team/register', asyncRoute(async (req, res) => {
    const { email, name, photoUrl, preferredRole } = req.body as {
      email?: string;
      name?: string;
      photoUrl?: string;
      preferredRole?: TeamMember['role'];
    };
    if (!email) {
      res.status(400).json({ error: 'E-mail requis.' });
      return;
    }
    const state = loadAgencyState();
    const { member, changed } = ensureMemberInState(state, {
      email,
      name,
      photoUrl,
      preferredRole,
    });
    if (changed) {
      await saveAgencyState(state);
    }
    res.json({ member, state });
  }));

  app.put('/api/agency/members/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const idx = state.members.findIndex((m) => m.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Membre introuvable.' });
      return;
    }
    state.members[idx] = { ...state.members[idx], ...req.body, id: req.params.id };
    await saveAgencyState(state);
    res.json(state);
  }));

  app.post('/api/agency/members', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const member: TeamMember = {
      id: `mem-${Date.now()}`,
      name: req.body.name || 'Nouveau coéquipier',
      email: req.body.email || '',
      role: req.body.role || 'Rédacteur',
      weeklyHours: Number(req.body.weeklyHours) || 0,
      maxWeeklyHours: 5,
      parentApproved: Boolean(req.body.parentApproved),
      parentName: req.body.parentName || 'À renseigner',
      schoolPriorityOk: true,
    };
    state.members.push(member);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.delete('/api/agency/members/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    state.members = state.members.filter((m) => m.id !== req.params.id);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.post('/api/agency/projects', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const body = req.body as Partial<ClientProject>;
    const project = normalizeProject({
      ...body,
      id: `proj-${Date.now()}`,
      ownerMemberId: body.ownerMemberId || state.members[0]?.id || '',
      commercialMemberId: body.commercialMemberId || state.members[0]?.id || '',
      updatedAt: new Date().toISOString(),
    });
    state.projects.unshift(project);
    await saveAgencyState(state);
    res.json({ project, state });
  }));

  app.put('/api/agency/projects/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const idx = state.projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Projet introuvable.' });
      return;
    }
    const existing = normalizeProject(state.projects[idx]);
    const body = req.body as Partial<ClientProject>;
    state.projects[idx] = normalizeProject({
      ...existing,
      ...body,
      brief: body.brief ? { ...existing.brief, ...body.brief } : existing.brief,
      legal: body.legal ? { ...existing.legal, ...body.legal } : existing.legal,
      qualityChecks: body.qualityChecks
        ? { ...existing.qualityChecks, ...body.qualityChecks }
        : existing.qualityChecks,
      integrations: body.integrations
        ? { ...existing.integrations, ...body.integrations }
        : existing.integrations,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    });
    await saveAgencyState(state);
    res.json({ project: state.projects[idx], state });
  }));

  app.delete('/api/agency/projects/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    state.projects = state.projects.filter((p) => p.id !== req.params.id);
    state.tasks = state.tasks.filter((t) => t.projectId !== req.params.id);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.post('/api/agency/tasks', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const task: KanbanTask = {
      id: `task-${Date.now()}`,
      projectId: req.body.projectId || state.projects[0]?.id || '',
      title: req.body.title || 'Nouvelle tâche',
      column: req.body.column || 'À faire',
      assigneeMemberId: req.body.assigneeMemberId || state.members[0]?.id || '',
      dueDate: req.body.dueDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    };
    state.tasks.unshift(task);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.put('/api/agency/tasks/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const idx = state.tasks.findIndex((t) => t.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Tâche introuvable.' });
      return;
    }
    state.tasks[idx] = { ...state.tasks[idx], ...req.body, id: req.params.id };
    await saveAgencyState(state);
    res.json(state);
  }));

  app.delete('/api/agency/tasks/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    state.tasks = state.tasks.filter((t) => t.id !== req.params.id);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.post('/api/agency/appointments', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const appt: AgencyAppointment = {
      id: `appt-${Date.now()}`,
      title: req.body.title || 'Nouveau rendez-vous',
      type: req.body.type || 'Client (20 min)',
      dateIso: req.body.dateIso || new Date().toISOString(),
      durationMin: Number(req.body.durationMin) || 20,
      projectId: req.body.projectId || undefined,
      attendeeIds: Array.isArray(req.body.attendeeIds) ? req.body.attendeeIds : [],
      notes: req.body.notes || '',
      googleCalendarEventId: req.body.googleCalendarEventId,
    };
    state.appointments.push(appt);
    await saveAgencyState(state);
    res.json({ appointment: appt, state });
  }));

  app.delete('/api/agency/appointments/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    state.appointments = state.appointments.filter((a) => a.id !== req.params.id);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.post('/api/agency/prospects', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const prospect: Prospect = {
      id: `pros-${Date.now()}`,
      businessName: req.body.businessName || 'Nouveau prospect',
      category: req.body.category || 'Commerce',
      cityArea: req.body.cityArea || state.settings.city,
      currentSiteStatus: req.body.currentSiteStatus || 'Aucun site',
      contactChannel: req.body.contactChannel || 'Sur place',
      contactEmail: req.body.contactEmail || '',
      phone: req.body.phone || '',
      status: req.body.status || 'À contacter',
      lastContactDate: req.body.lastContactDate || new Date().toISOString().slice(0, 10),
      assignedMemberId: req.body.assignedMemberId || state.members[0]?.id || 'mem-1',
      notes: req.body.notes || '',
    };
    state.prospects.unshift(prospect);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.put('/api/agency/prospects/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const idx = state.prospects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Prospect introuvable.' });
      return;
    }
    state.prospects[idx] = { ...state.prospects[idx], ...req.body, id: req.params.id };
    await saveAgencyState(state);
    res.json(state);
  }));

  app.delete('/api/agency/prospects/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    state.prospects = state.prospects.filter((p) => p.id !== req.params.id);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.post('/api/agency/finances', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const entry: FinanceEntry = {
      id: `fin-${Date.now()}`,
      projectId: req.body.projectId || '',
      clientName: req.body.clientName || 'Client',
      label: req.body.label || 'Facturation',
      amountEur: Number(req.body.amountEur) || 0,
      type: req.body.type || 'Acompte 30 %',
      status: req.body.status || 'Payé',
      invoiceRef: req.body.invoiceRef || `DEV-${Date.now().toString().slice(-4)}`,
      billingParentOrEntity: req.body.billingParentOrEntity || state.settings.billingFramework,
      commercialMemberId: req.body.commercialMemberId,
      date: req.body.date || new Date().toISOString().slice(0, 10),
    };
    state.finances.unshift(entry);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.put('/api/agency/finances/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const idx = state.finances.findIndex((f) => f.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Écriture introuvable.' });
      return;
    }
    state.finances[idx] = { ...state.finances[idx], ...req.body, id: req.params.id };
    await saveAgencyState(state);
    res.json(state);
  }));

  app.delete('/api/agency/finances/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    state.finances = state.finances.filter((f) => f.id !== req.params.id);
    await saveAgencyState(state);
    res.json(state);
  }));

  app.put('/api/agency/checklist/:id', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const item = state.preSaleChecklist.find((c) => c.id === req.params.id);
    if (item) {
      item.completed = Boolean(req.body.completed);
      await saveAgencyState(state);
    }
    res.json(state);
  }));

  app.put('/api/agency/roadmap/:weekId/tasks/:taskId', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const week = state.roadmap.find((w) => w.id === req.params.weekId);
    const task = week?.tasks.find((t) => t.id === req.params.taskId);
    if (task) {
      task.completed = Boolean(req.body.completed);
      await saveAgencyState(state);
    }
    res.json(state);
  }));

  app.put('/api/agency/settings', asyncRoute(async (req, res) => {
    const state = loadAgencyState();
    const body = req.body as Partial<AgencyState['settings']>;
    const authEmail = ((req as any).authEmail as string | undefined)?.toLowerCase();

    const touchesAccessControl =
      body.allowedEmails !== undefined ||
      body.adminEmails !== undefined ||
      body.lockEnabled !== undefined;

    if (
      touchesAccessControl &&
      state.settings.lockEnabled &&
      state.settings.adminEmails.length > 0 &&
      (!authEmail || !state.settings.adminEmails.includes(authEmail))
    ) {
      res.status(403).json({
        error: 'Seul un administrateur Omnix peut modifier la liste des accès autorisés.',
      });
      return;
    }

    const nextAllowed = Array.isArray(body.allowedEmails)
      ? Array.from(new Set(body.allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)))
      : state.settings.allowedEmails;

    let nextAdmins = Array.isArray(body.adminEmails)
      ? Array.from(
          new Set(
            body.adminEmails
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e && nextAllowed.includes(e))
          )
        )
      : state.settings.adminEmails.filter((e) => nextAllowed.includes(e));

    const nextLock =
      typeof body.lockEnabled === 'boolean' ? body.lockEnabled : state.settings.lockEnabled;

    if (nextLock && nextAdmins.length === 0 && authEmail && nextAllowed.includes(authEmail)) {
      nextAdmins = [authEmail];
    }

    if (nextLock && nextAllowed.length === 0) {
      res.status(400).json({
        error: 'Au moins un e-mail autorisé doit rester présent tant que le verrouillage est actif.',
      });
      return;
    }

    state.settings = {
      ...state.settings,
      ...body,
      allowedEmails: nextAllowed,
      adminEmails: nextAdmins,
      lockEnabled: nextLock,
    };
    await saveAgencyState(state);
    res.json(state);
  }));

  // --- Google AI Studio (Gemini) Integrated Endpoints ---
  app.post('/api/ai/generate-site', async (req, res) => {
    try {
      const { prompt, project, palette, fontPair } = req.body as {
        prompt?: string;
        project?: ClientProject;
        palette?: { primary: string; background: string; text: string };
        fontPair?: string;
      };

      const ai = getAiClient();
      const normalizedProject = project ? normalizeProject(project) : null;
      const legalNoticeBlock = normalizedProject
        ? generateLegalNoticeText(normalizedProject)
        : '';

      const briefContext = normalizedProject
        ? `
Client : ${normalizedProject.clientName} (${normalizedProject.sector})
Type : ${normalizedProject.isDemo ? 'Site démo portfolio' : 'Site client réel'}
Formule : ${normalizedProject.offerTier}
Résumé d'activité : ${normalizedProject.brief.activitySummary}
Public cible : ${normalizedProject.brief.targetClients}
Pages / sections souhaitées : ${normalizedProject.brief.desiredPages}
Horaires, adresse et téléphone exacts : ${normalizedProject.brief.hoursAddressPhone}
Action principale demandée au visiteur : ${normalizedProject.brief.primaryVisitorAction}
Email de contact : ${normalizedProject.contactEmail}
Téléphone : ${normalizedProject.contactPhone}
Domaine cible : ${normalizedProject.legal.customDomain || 'À définir'}

DONNÉES LÉGALES OFFICIELLES DU PATRON À INTÉGRER DANS LES MENTIONS LÉGALES & CONFIDENTIALITÉ :
${legalNoticeBlock}
`
        : '';

      const designContext = `
Palette demandée : Fond=${palette?.background || '#ffffff'}, Texte=${palette?.text || '#0f172a'}, Accent=${palette?.primary || '#2563eb'}
Typographie souhaitée : ${fontPair || 'Plus Jakarta Sans + DM Sans'}
`;

      const fullPrompt = `Tu es le moteur de création web intégré de Google AI Studio pour une jeune agence web française.
Génère un fichier HTML5 complet, autonome et responsive (mobile-first) avec CSS intégré dans une balise <style> (aucune dépendance externe cassée).
Exigences strictes (Conformité loi française LCEN / RGPD / Code de la consommation + Guide SEO local) :
1. Rédige tout le contenu en français naturel, clair et professionnel.
2. Respecte scrupuleusement les horaires, adresses, téléphones et informations fournies sans rien inventer de trompeur (NAP identique partout).
3. SEO local obligatoire : une balise <title> <= 60 caractères, une <meta name="description"> <= 150 caractères, un seul <h1> dans la page, et un script JSON-LD <script type="application/ld+json"> de type LocalBusiness cohérent.
4. Inclus un header épuré, une section héros avec un bouton d'action clair (${normalizedProject?.brief.primaryVisitorAction || 'Contacter / Appeler'}), les sections de services/horaires/adresse, et un formulaire de contact prêt pour Formspree/Tally avec mention RGPD obligatoire sous le formulaire (finalité, durée de conservation, droits d'accès/suppression et e-mail de contact).
5. Pied de page & Conformité légale obligatoire : intègre une section complète et accessible "Mentions légales & Confidentialité" (avec ancre #mentions-legales ou modal/accordéon propre) reprenant EXACTEMENT toutes les informations légales officielles fournies ci-dessous (Raison sociale/Nom EI, Forme juridique, Capital social si société, SIREN/SIRET, RCS/RNE/RNA, TVA ou mention art. 293 B CGI, Directeur de publication, Adresse, Hébergeur complet avec adresse et contact, Médiateur de la consommation si B2C, Politique de confidentialité RGPD et gestion des cookies sans traceurs publicitaires).
6. Assure une excellente lisibilité sur téléphone (viewport meta, grille CSS responsive, contrastes élevés).
7. Réponds UNIQUEMENT avec le code HTML complet commençant par <!DOCTYPE html>.

${briefContext}
${designContext}
Instructions complémentaires de l'équipe :
${prompt || 'Crée un site vitrine moderne, chaleureux, rassurant et 100 % conforme à la loi française pour ce commerce local.'}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: fullPrompt,
      });

      const html = extractHtmlDocument(response.text || '');
      if (!html || !html.toLowerCase().includes('<html')) {
        res.status(502).json({ error: 'Réponse HTML incomplète générée par Gemini.' });
        return;
      }

      res.json({ html });
    } catch (error: any) {
      console.error('AI generate-site error:', error);
      res.status(500).json({ error: error?.message || 'Erreur lors de la génération avec Google AI Studio.' });
    }
  });

  app.post('/api/ai/refine-site', async (req, res) => {
    try {
      const { currentHtml, instruction } = req.body as {
        currentHtml?: string;
        instruction?: string;
      };
      if (!currentHtml || !instruction) {
        res.status(400).json({ error: 'HTML actuel et instruction requis.' });
        return;
      }
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Voici le code HTML/CSS complet d'un site client :\n\n${currentHtml}\n\nApplique exactement cette modification demandée par le développeur de l'équipe :\n"${instruction}"\n\nConserve la structure responsive mobile, le SEO local, les mentions légales LCEN et la politique de confidentialité RGPD, et réponds UNIQUEMENT avec le code HTML complet mis à jour (<!DOCTYPE html> ... </html>).`,
      });
      const html = extractHtmlDocument(response.text || '');
      res.json({ html });
    } catch (error: any) {
      console.error('AI refine-site error:', error);
      res.status(500).json({ error: error?.message || 'Erreur lors de la retouche IA.' });
    }
  });

  app.post('/api/ai/review-site', async (req, res) => {
    try {
      const { html, project } = req.body as { html?: string; project?: ClientProject };
      if (!html) {
        res.status(400).json({ error: 'Code HTML requis pour l’audit.' });
        return;
      }
      const normalizedProject = project ? normalizeProject(project) : null;
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Audite ce code HTML selon les 7 points de contrôle qualité et de conformité légale française (LCEN, RGPD/CNIL, Code de la consommation, Guide SEO local) :
1. Cohérence des textes & NAP (horaires, prix, noms, téléphone : référence = "${normalizedProject?.brief.hoursAddressPhone || 'non précisé'}").
2. Adaptation téléphone (viewport meta, media queries ou grilles flex/grid responsives).
3. Images (pas de liens cassés ou protégés non vérifiés).
4. Mentions légales LCEN complètes : identité/forme juridique (${normalizedProject?.legal.legalForm || 'à vérifier'}), SIREN/SIRET (${normalizedProject?.legal.siret || normalizedProject?.legal.siren || 'à vérifier'}), RCS/RNE/capital, directeur de publication (${normalizedProject?.legal.publicationDirector || 'à vérifier'}), adresse et hébergeur complet (${normalizedProject?.legal.hostingProviderName || 'à vérifier'}).
5. RGPD & Formulaire de contact : si un formulaire existe, présence d'une politique de confidentialité (finalité, durée de conservation, droits accès/suppression, e-mail RGPD, référence CNIL).
6. Médiateur de la consommation B2C (si commerce avec particuliers) : présence des coordonnées d'un médiateur conso (Art. L.616-1) ou note si B2B.
7. Cookies & SEO local : pas de traceurs sans consentement CNIL, présence de <title>, <meta description>, un seul <h1> et idéalement JSON-LD LocalBusiness.

Code HTML à vérifier :
${html.slice(0, 22000)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'Résumé court en français.' },
              checks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    passed: { type: Type.BOOLEAN },
                    advice: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });
      const parsed = JSON.parse(response.text || '{}');
      res.json(parsed);
    } catch (error: any) {
      console.error('AI review-site error:', error);
      res.status(500).json({ error: error?.message || 'Erreur lors de l’audit qualité & conformité IA.' });
    }
  });

  app.post('/api/ai/draft-message', async (req, res) => {
    try {
      const { prospectName, category, channel, goal, demoUrl } = req.body as {
        prospectName?: string;
        category?: string;
        channel?: string;
        goal?: string;
        demoUrl?: string;
      };
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Rédige un court message en français poli, honnête et direct au nom d'une équipe de lycéens qui crée des sites web pour les commerces et associations de la ville.
Destinataire : ${prospectName || 'commerce local'} (${category || 'commerce'})
Canal : ${channel || 'E-mail'}
Objectif : ${goal || 'Premier contact pour proposer un rendez-vous de 15 minutes et montrer une maquette gratuite'}
Lien exemple portfolio : ${demoUrl || 'https://exemple-portfolio.netlify.app'}
Garde un ton authentique, concis (5 à 7 lignes max), sans jargon marketing exagéré.`,
      });
      res.json({ message: (response.text || '').trim() });
    } catch (error: any) {
      console.error('AI draft-message error:', error);
      res.status(500).json({ error: error?.message || 'Erreur lors de la rédaction IA.' });
    }
  });

  app.post('/api/ai/jarvis', async (req, res) => {
    try {
      const { messages, workspaceUserName, workspaceUserEmail } = req.body as {
        messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
        workspaceUserName?: string;
        workspaceUserEmail?: string;
      };

      const cleanMessages = (messages || []).filter(
        (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()
      );
      if (cleanMessages.length === 0) {
        res.status(400).json({ error: 'Posez une question à Jarvis.' });
        return;
      }

      const state = loadAgencyState();
      const sid = getOrCreateSessionId(req, res);
      const session = sessionStore.get(sid) || {};

      // Compute exact financial metrics from agency state
      const paidEntries = state.finances.filter(
        (f) => f.status === 'Payé' && f.type !== 'Dépense caisse commune'
      );
      const paidRevenueEur = Math.round(paidEntries.reduce((acc, f) => acc + f.amountEur, 0) * 100) / 100;
      const pendingQuotesEur =
        Math.round(
          state.finances
            .filter((f) => f.status !== 'Payé' && f.type !== 'Dépense caisse commune')
            .reduce((acc, f) => acc + f.amountEur, 0) * 100
        ) / 100;
      const expensesEur =
        Math.round(
          state.finances
            .filter((f) => f.type === 'Dépense caisse commune')
            .reduce((acc, f) => acc + f.amountEur, 0) * 100
        ) / 100;

      const poolHours70Eur = Math.round(paidRevenueEur * 0.7 * 100) / 100;
      const reserveGross20Eur = Math.round(paidRevenueEur * 0.2 * 100) / 100;
      const reserveNetAvailableEur = Math.max(
        0,
        Math.round((paidRevenueEur * 0.2 - expensesEur) * 100) / 100
      );
      const commercialBonus10Eur = Math.round(paidRevenueEur * 0.1 * 100) / 100;

      const projectPaidTotalEur =
        Math.round(
          state.projects.reduce((acc, p) => acc + (p.depositPaidEur || 0) + (p.balancePaidEur || 0), 0) * 100
        ) / 100;

      // Observe connected 3P accounts live (with short timeouts so Jarvis stays fast)
      const connectedProviders: Record<string, any> = {
        github: { connected: Boolean(session.github?.accessToken), account: session.github?.accountHandle || session.github?.accountName || null },
        discord: {
          connected: Boolean(session.discord?.accessToken),
          account: session.discord?.accountHandle || session.discord?.accountName || null,
          webhookConfigured: Boolean(state.settings.discordWebhookUrl),
        },
        figma: { connected: Boolean(session.figma?.accessToken), account: session.figma?.accountName || null },
        netlify: { connected: Boolean(session.netlify?.accessToken), account: session.netlify?.accountName || null },
      };

      const thirdPartyFetches: Array<Promise<void>> = [];

      if (session.github?.accessToken) {
        thirdPartyFetches.push(
          (async () => {
            try {
              const r = await fetch('https://api.github.com/user/repos?sort=updated&per_page=8', {
                headers: { Authorization: `Bearer ${session.github!.accessToken}`, 'User-Agent': 'Omnix' },
                signal: AbortSignal.timeout(3000),
              });
              if (r.ok) {
                const repos = (await r.json()) as any[];
                connectedProviders.github.recentRepos = repos.slice(0, 8).map((repo) => ({
                  full_name: repo.full_name,
                  private: repo.private,
                  updated_at: repo.updated_at,
                }));
              }
            } catch {
              connectedProviders.github.fetchNote = 'Impossible de lire les dépôts récents';
            }
          })()
        );
      }

      if (session.discord?.accessToken) {
        thirdPartyFetches.push(
          (async () => {
            try {
              const r = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${session.discord!.accessToken}` },
                signal: AbortSignal.timeout(3000),
              });
              if (r.ok) {
                const guilds = (await r.json()) as any[];
                connectedProviders.discord.guilds = guilds.slice(0, 8).map((g) => g.name);
              }
            } catch {
              connectedProviders.discord.fetchNote = 'Impossible de lire les serveurs Discord';
            }
          })()
        );
      }

      if (session.netlify?.accessToken) {
        thirdPartyFetches.push(
          (async () => {
            try {
              const r = await fetch('https://api.netlify.com/api/v1/sites?per_page=8', {
                headers: { Authorization: `Bearer ${session.netlify!.accessToken}` },
                signal: AbortSignal.timeout(3000),
              });
              if (r.ok) {
                const sites = (await r.json()) as any[];
                connectedProviders.netlify.sites = sites.slice(0, 8).map((s) => ({
                  name: s.name,
                  url: s.ssl_url || s.url,
                }));
              }
            } catch {
              connectedProviders.netlify.fetchNote = 'Impossible de lire les sites Netlify';
            }
          })()
        );
      }

      // Observe live Google Workspace data if Bearer token provided
      const authHeader = req.headers.authorization || '';
      const workspaceToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const googleWorkspace: Record<string, any> = {
        connected: Boolean(workspaceToken),
        user: workspaceUserName || workspaceUserEmail ? { name: workspaceUserName, email: workspaceUserEmail } : null,
      };

      if (workspaceToken) {
        thirdPartyFetches.push(
          (async () => {
            const nowIso = new Date().toISOString();
            const [calRes, driveRes, gmailRes] = await Promise.allSettled([
              fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(nowIso)}&maxResults=8&singleEvents=true&orderBy=startTime`,
                {
                  headers: { Authorization: `Bearer ${workspaceToken}` },
                  signal: AbortSignal.timeout(3500),
                }
              ),
              fetch(
                `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent('trashed = false')}&pageSize=10&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime)`,
                {
                  headers: { Authorization: `Bearer ${workspaceToken}` },
                  signal: AbortSignal.timeout(3500),
                }
              ),
              fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5', {
                headers: { Authorization: `Bearer ${workspaceToken}` },
                signal: AbortSignal.timeout(3500),
              }),
            ]);

            if (calRes.status === 'fulfilled' && calRes.value.ok) {
              const calData = (await calRes.value.json()) as any;
              googleWorkspace.upcomingCalendarEvents = (calData.items || []).map((ev: any) => ({
                summary: ev.summary || '(Sans titre)',
                start: ev.start?.dateTime || ev.start?.date,
                end: ev.end?.dateTime || ev.end?.date,
              }));
            }

            if (driveRes.status === 'fulfilled' && driveRes.value.ok) {
              const driveData = (await driveRes.value.json()) as any;
              googleWorkspace.recentDriveFiles = (driveData.files || []).map((f: any) => ({
                name: f.name,
                mimeType: f.mimeType,
                modifiedTime: f.modifiedTime,
              }));
            }

            if (gmailRes.status === 'fulfilled' && gmailRes.value.ok) {
              const listData = (await gmailRes.value.json()) as any;
              const msgIds: string[] = (listData.messages || []).slice(0, 5).map((m: any) => m.id);
              const details = await Promise.allSettled(
                msgIds.map(async (id) => {
                  const r = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                    {
                      headers: { Authorization: `Bearer ${workspaceToken}` },
                      signal: AbortSignal.timeout(2500),
                    }
                  );
                  if (!r.ok) return null;
                  const m = (await r.json()) as any;
                  const headers = m.payload?.headers || [];
                  const getH = (name: string) =>
                    headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
                  return {
                    subject: getH('Subject') || '(Sans objet)',
                    from: getH('From'),
                    date: getH('Date'),
                    snippet: m.snippet || '',
                  };
                })
              );
              googleWorkspace.recentEmails = details
                .filter((d): d is PromiseFulfilledResult<any> => d.status === 'fulfilled' && Boolean(d.value))
                .map((d) => d.value);
            }
          })()
        );
      }

      await Promise.allSettled(thirdPartyFetches);

      const totalChecklist = state.preSaleChecklist.length;
      const doneChecklist = state.preSaleChecklist.filter((c) => c.completed).length;
      const roadmapAllTasks = state.roadmap.flatMap((w) => w.tasks);
      const doneRoadmapTasks = roadmapAllTasks.filter((t) => t.completed).length;

      const snapshot = {
        observedAt: new Date().toISOString(),
        agency: {
          name: state.settings.agencyName,
          city: state.settings.city,
          currentMonthLabel: state.settings.currentMonthLabel,
          billingFramework: state.settings.billingFramework,
          teamRulesAccepted: state.settings.teamRulesAccepted,
          revenueSplitWritten: state.settings.revenueSplitWritten,
          defaultGoogleFormIdConfigured: Boolean(state.settings.defaultGoogleFormId),
          defaultDriveFolderIdConfigured: Boolean(state.settings.defaultDriveFolderId),
        },
        financesSummary: {
          chiffreAffairesEncaisseEur: paidRevenueEur,
          devisEnAttenteEur: pendingQuotesEur,
          depensesCaisseCommuneEur: expensesEur,
          partEquipe70PctEur: poolHours70Eur,
          reserveCaisseCommuneBrute20PctEur: reserveGross20Eur,
          reserveCaisseCommuneDisponibleEur: reserveNetAvailableEur,
          bonusCommercial10PctEur: commercialBonus10Eur,
          totalEncaisseSurFichesProjetsEur: projectPaidTotalEur,
          entriesCount: state.finances.length,
          entries: state.finances,
        },
        team: {
          count: state.members.length,
          totalWeeklyHours: state.members.reduce((acc, m) => acc + m.weeklyHours, 0),
          members: state.members.map((m) => ({
            name: m.name,
            email: m.email,
            role: m.role,
            weeklyHours: m.weeklyHours,
            maxWeeklyHours: m.maxWeeklyHours,
            parentApproved: m.parentApproved,
            schoolPriorityOk: m.schoolPriorityOk,
          })),
        },
        projects: {
          count: state.projects.length,
          list: state.projects.map((p) => {
            const legalReport = evaluateProjectLegalCompliance(p);
            return {
              clientName: p.clientName,
              sector: p.sector,
              isDemo: p.isDemo,
              step: `${p.step}/7`,
              offerTier: p.offerTier,
              totalPriceEur: p.totalPriceEur,
              depositPaidEur: p.depositPaidEur,
              balancePaidEur: p.balancePaidEur,
              deliveryTargetDate: p.deliveryTargetDate,
              qualityChecksPassed: Object.values(p.qualityChecks).filter(Boolean).length,
              legalCompliance: `${legalReport.score}/${legalReport.total} (${legalReport.percent}%)`,
              legalMissing: legalReport.missingLabels,
              siren: p.legal?.siren || '',
              siret: p.legal?.siret || '',
              legalForm: p.legal?.legalForm || '',
              hostingProvider: p.legal?.hostingProvider || '',
              hasGeneratedHtml: Boolean(p.generatedHtml),
              integrations: p.integrations,
            };
          }),
        },
        tasks: {
          count: state.tasks.length,
          byColumn: {
            aFaire: state.tasks.filter((t) => t.column === 'À faire').length,
            enCours: state.tasks.filter((t) => t.column === 'En cours').length,
            aValider: state.tasks.filter((t) => t.column === 'À valider').length,
            termine: state.tasks.filter((t) => t.column === 'Terminé').length,
          },
          list: state.tasks,
        },
        appointments: {
          count: state.appointments.length,
          list: state.appointments,
        },
        prospects: {
          count: state.prospects.length,
          followUpDueCount: state.prospects.filter((p) => p.status === 'Relance J+5 à faire').length,
          list: state.prospects,
        },
        launchReadiness: {
          preSaleChecklistDone: `${doneChecklist}/${totalChecklist}`,
          pendingPreSaleItems: state.preSaleChecklist.filter((c) => !c.completed).map((c) => c.label),
          roadmapDone: `${doneRoadmapTasks}/${roadmapAllTasks.length}`,
        },
        connectedAccounts: {
          googleWorkspace,
          thirdParty: connectedProviders,
        },
      };

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: cleanMessages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }],
        })),
        config: {
          systemInstruction: `Tu es Jarvis, l'assistant intelligent et analytique de l'agence "${state.settings.agencyName}".
Tu observes en temps réel l'intégralité de l'application (finances, caisse 70/20/10, projets, tâches, rendez-vous, prospection, équipe, checklist de lancement) ainsi que les comptes connectés (Google Workspace : Calendar, Drive, Gmail ; et outils externes : GitHub, Discord, Figma, Netlify).

Règles strictes :
1. Réponds en français naturel, clair, précis et direct (comme un vrai copilote d'entreprise).
2. Base-toi EXCLUSIVEMENT sur les données réelles observées ci-dessous. N'invente jamais un chiffre, un client, un mail, un événement ou un solde.
3. Si une donnée vaut 0 € ou est vide (ex. aucun projet, aucun membre, ou un compte non connecté), dis-le franchement avec exactitude et propose la prochaine action concrète dans l'app.
4. Pour les questions financières, précise toujours les montants exacts en € : Chiffre d'affaires encaissé, Devis en attente, Dépenses, et la répartition 70 % Équipe / 20 % Réserve (caisse commune disponible après dépenses) / 10 % Bonus commercial.
5. Reste concis (listes courtes ou paragraphes nets, pas de blabla inutile).

INSTANTANÉ LIVE OBSERVÉ DANS OMNIX :
${JSON.stringify(snapshot, null, 2)}`,
        },
      });

      res.json({
        reply: (response.text || '').trim(),
        observedSources: {
          appState: true,
          googleWorkspace: Boolean(workspaceToken),
          github: Boolean(session.github?.accessToken),
          discord: Boolean(session.discord?.accessToken),
          figma: Boolean(session.figma?.accessToken),
          netlify: Boolean(session.netlify?.accessToken),
        },
        snapshotMeta: {
          paidRevenueEur,
          reserveNetAvailableEur,
          projectsCount: state.projects.length,
          appointmentsCount: state.appointments.length,
        },
      });
    } catch (error: any) {
      console.error('AI jarvis error:', error);
      res.status(500).json({ error: error?.message || 'Erreur lors de la réponse de Jarvis.' });
    }
  });

  // --- Third-Party OAuth Endpoints (GitHub, Discord, Figma, Netlify) ---
  app.get('/api/oauth/status', (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const session = sessionStore.get(sid) || {};
    const providers: ProviderName[] = ['github', 'discord', 'figma', 'netlify'];
    const devBase = (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL')
      ? process.env.APP_URL.replace(/\/+$/, '')
      : getAppBaseUrl(req);
    const sharedBase = devBase.replace('ais-dev-', 'ais-pre-');

    const statuses: ThirdPartyProviderStatus[] = providers.map((provider) => {
      const cfg = getProviderConfig(provider);
      const token = session[provider];
      return {
        provider,
        configured: Boolean(cfg.clientId && cfg.clientSecret),
        connected: Boolean(token?.accessToken),
        accountName: token?.accountName,
        accountHandle: token?.accountHandle,
        avatarUrl: token?.avatarUrl,
        callbackUrlDev: `${devBase}/auth/${provider}/callback`,
        callbackUrlShared: `${sharedBase}/auth/${provider}/callback`,
      };
    });

    res.json({ statuses });
  });

  app.get('/api/oauth/:provider/url', (req, res) => {
    const provider = req.params.provider as ProviderName;
    if (!['github', 'discord', 'figma', 'netlify'].includes(provider)) {
      res.status(400).json({ error: 'Fournisseur inconnu.' });
      return;
    }
    const cfg = getProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(400).json({
        error: `Variables ${provider.toUpperCase()}_CLIENT_ID et ${provider.toUpperCase()}_CLIENT_SECRET manquantes dans les secrets.`,
      });
      return;
    }

    const sid = getOrCreateSessionId(req, res);
    const stateToken = crypto.randomBytes(16).toString('hex');
    pendingStates.set(stateToken, { sid, provider, createdAt: Date.now() });

    const redirectUri = `${getAppBaseUrl(req)}/auth/${provider}/callback`;
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: stateToken,
    });
    if (cfg.scope) {
      params.set('scope', cfg.scope);
    }
    res.json({ url: `${cfg.authUrl}?${params.toString()}` });
  });

  app.post('/api/oauth/:provider/disconnect', (req, res) => {
    const provider = req.params.provider as ProviderName;
    const sid = getOrCreateSessionId(req, res);
    const session = sessionStore.get(sid);
    if (session && session[provider]) {
      delete session[provider];
    }
    res.json({ ok: true });
  });

  const handleOAuthCallback = async (req: Request, res: Response) => {
    const provider = req.params.provider as ProviderName;
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || !pendingStates.has(state)) {
      res.status(400).send('<p>Session OAuth invalide ou expirée.</p>');
      return;
    }
    const pending = pendingStates.get(state)!;
    pendingStates.delete(state);
    if (pending.provider !== provider) {
      res.status(400).send('<p>Fournisseur OAuth non concordant.</p>');
      return;
    }

    const cfg = getProviderConfig(provider);
    const redirectUri = `${getAppBaseUrl(req)}/auth/${provider}/callback`;

    try {
      let accessToken = '';
      if (provider === 'github') {
        const tokenRes = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        });
        const tokenJson = (await tokenRes.json()) as any;
        accessToken = tokenJson.access_token;
      } else {
        const body = new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });
        const tokenRes = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const tokenJson = (await tokenRes.json()) as any;
        accessToken = tokenJson.access_token;
      }

      if (!accessToken) {
        throw new Error('Jeton d’accès manquant.');
      }

      let accountName = provider.toUpperCase();
      let accountHandle = '';
      let avatarUrl: string | undefined;

      if (provider === 'github') {
        const uRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'AtelierWebJunior' },
        });
        const u = (await uRes.json()) as any;
        accountName = u.name || u.login || 'GitHub';
        accountHandle = u.login ? `@${u.login}` : '';
        avatarUrl = u.avatar_url;
      } else if (provider === 'discord') {
        const uRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const u = (await uRes.json()) as any;
        accountName = u.global_name || u.username || 'Discord';
        accountHandle = u.username ? `@${u.username}` : '';
        if (u.id && u.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`;
        }
      } else if (provider === 'figma') {
        const uRes = await fetch('https://api.figma.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const u = (await uRes.json()) as any;
        accountName = u.handle || u.email || 'Figma';
        accountHandle = u.email || '';
        avatarUrl = u.img_url;
      } else if (provider === 'netlify') {
        const uRes = await fetch('https://api.netlify.com/api/v1/user', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const u = (await uRes.json()) as any;
        accountName = u.full_name || u.email || 'Netlify';
        accountHandle = u.email || '';
        avatarUrl = u.avatar_url;
      }

      const session = sessionStore.get(pending.sid) || {};
      session[provider] = { accessToken, accountName, accountHandle, avatarUrl };
      sessionStore.set(pending.sid, session);

      res.send(`
        <html>
          <body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a;">
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: '${provider}' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Connexion ${provider} réussie. Cette fenêtre va se fermer automatiquement.</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error(`OAuth callback error (${provider}):`, err);
      res.status(500).send(`<p>Erreur lors de la connexion ${provider} : ${err?.message || 'inconnue'}</p>`);
    }
  };

  app.get(['/auth/:provider/callback', '/auth/:provider/callback/'], handleOAuthCallback);

  // --- Connected Third-Party Integration Proxies ---
  app.get('/api/integrations/github/repos', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.github?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte GitHub non connecté.' });
      return;
    }
    const ghRes = await fetch('https://api.github.com/user/repos?sort=updated&per_page=20', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AtelierWebJunior' },
    });
    const data = await ghRes.json();
    res.status(ghRes.status).json(data);
  });

  app.post('/api/integrations/github/create-repo', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.github?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte GitHub non connecté.' });
      return;
    }
    const { name, description } = req.body as { name: string; description?: string };
    const ghRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'AtelierWebJunior',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        description: description || 'Site client créé avec Omnix',
        private: false,
        auto_init: true,
      }),
    });
    const data = await ghRes.json();
    res.status(ghRes.status).json(data);
  });

  app.post('/api/integrations/github/push-site', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.github?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte GitHub non connecté.' });
      return;
    }
    const { fullRepoName, html, commitMessage } = req.body as {
      fullRepoName: string;
      html: string;
      commitMessage?: string;
    };
    if (!fullRepoName || !html) {
      res.status(400).json({ error: 'Dépôt GitHub et code HTML requis.' });
      return;
    }

    // Check existing index.html SHA if updating
    let existingSha: string | undefined;
    const checkRes = await fetch(
      `https://api.github.com/repos/${fullRepoName}/contents/index.html`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AtelierWebJunior' } }
    );
    if (checkRes.ok) {
      const existing = (await checkRes.json()) as any;
      existingSha = existing.sha;
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${fullRepoName}/contents/index.html`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'AtelierWebJunior',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage || 'Mise à jour index.html depuis Studio IA',
          content: Buffer.from(html, 'utf-8').toString('base64'),
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      }
    );
    const putData = await putRes.json();
    res.status(putRes.status).json(putData);
  });

  app.get('/api/integrations/discord/guilds', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.discord?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte Discord non connecté.' });
      return;
    }
    const dRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await dRes.json();
    res.status(dRes.status).json(data);
  });

  app.post('/api/integrations/discord/send-webhook', async (req, res) => {
    const { webhookUrl, content } = req.body as { webhookUrl?: string; content?: string };
    const state = loadAgencyState();
    const targetUrl = webhookUrl || state.settings.discordWebhookUrl;
    if (!targetUrl || !targetUrl.startsWith('https://discord.com/api/webhooks/')) {
      res.status(400).json({ error: 'URL de webhook Discord valide requise.' });
      return;
    }
    if (!content) {
      res.status(400).json({ error: 'Message requis.' });
      return;
    }
    const dRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.settings.agencyName || 'Omnix',
        content: content.slice(0, 1900),
      }),
    });
    if (!dRes.ok) {
      const txt = await dRes.text();
      res.status(dRes.status).json({ error: txt || 'Échec de l’envoi Discord.' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/integrations/figma/file', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.figma?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte Figma non connecté.' });
      return;
    }
    const fileKey = String(req.query.fileKey || '').trim();
    if (!fileKey) {
      res.status(400).json({ error: 'Clé de fichier Figma requise.' });
      return;
    }
    const fRes = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await fRes.json();
    res.status(fRes.status).json(data);
  });

  app.get('/api/integrations/netlify/sites', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.netlify?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte Netlify non connecté.' });
      return;
    }
    const nRes = await fetch('https://api.netlify.com/api/v1/sites?per_page=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await nRes.json();
    res.status(nRes.status).json(data);
  });

  app.post('/api/integrations/netlify/deploy', async (req, res) => {
    const sid = getOrCreateSessionId(req, res);
    const token = sessionStore.get(sid)?.netlify?.accessToken;
    if (!token) {
      res.status(401).json({ error: 'Compte Netlify non connecté.' });
      return;
    }
    const { siteId, html } = req.body as { siteId: string; html: string };
    if (!siteId || !html) {
      res.status(400).json({ error: 'Site ID Netlify et HTML requis.' });
      return;
    }
    const sha1 = crypto.createHash('sha1').update(html, 'utf-8').digest('hex');
    const createRes = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          '/index.html': sha1,
        },
      }),
    });
    const deploy = (await createRes.json()) as any;
    if (!createRes.ok) {
      res.status(createRes.status).json(deploy);
      return;
    }
    if (Array.isArray(deploy.required) && deploy.required.includes(sha1)) {
      await fetch(
        `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deploy.id)}/files/index.html`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: Buffer.from(html, 'utf-8'),
        }
      );
    }
    res.json(deploy);
  });

  // --- Vite Dev Middleware / Static Prod ---
  const distDir = path.resolve(process.cwd(), 'dist');
  const kService = process.env.K_SERVICE || '';
  const isProdRuntime =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' &&
      Boolean(kService) &&
      !kService.startsWith('ais-dev-') &&
      fs.existsSync(path.join(distDir, 'index.html')));

  if (!isProdRuntime) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build introuvable.');
      }
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Erreur serveur lors de la sauvegarde.' });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Omnix server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Omnix server:', err);
  process.exit(1);
});
