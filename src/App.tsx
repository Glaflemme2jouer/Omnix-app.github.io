import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { Sidebar, type NavSection } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { JarvisDrawer } from './components/JarvisDrawer';
import { OverviewView } from './components/views/OverviewView';
import { AiStudioView } from './components/views/AiStudioView';
import { ProjectsView } from './components/views/ProjectsView';
import { CalendarView } from './components/views/CalendarView';
import { ProspectsOutreachView } from './components/views/ProspectsOutreachView';
import { IntegrationsHubView } from './components/views/IntegrationsHubView';
import { TeamFinanceView } from './components/views/TeamFinanceView';
import { ShieldCheck, LogOut, Eye, EyeOff, KeyRound, AlertCircle, X } from 'lucide-react';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { googleSignIn, initAuth, logoutGoogle } from './lib/firebaseAuth';
import { createDefaultLegalInfo } from './lib/legalCompliance';
import type {
  AgencyAppointment,
  AgencyState,
  ClientProject,
  FinanceEntry,
  KanbanTask,
  Prospect,
  TeamMember,
  ThirdPartyProviderStatus,
} from './types';

interface GateState {
  checked: boolean;
  lockEnabled: boolean;
  agencyName: string;
  hasAdmin: boolean;
  authorized: boolean;
  email: string | null;
  isAdmin: boolean;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [jarvisOpen, setJarvisOpen] = useState(false);

  const [gate, setGate] = useState<GateState>({
    checked: false,
    lockEnabled: true,
    agencyName: 'Omnix',
    hasAdmin: false,
    authorized: false,
    email: null,
    isAdmin: false,
  });
  const [gateError, setGateError] = useState('');

  const [state, setState] = useState<AgencyState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [openNewProjectNonce, setOpenNewProjectNonce] = useState(0);

  const [user, setUser] = useState<User | null>(null);
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<ThirdPartyProviderStatus[]>([]);

  const [loginName, setLoginName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const gateCheckedRef = useRef(false);
  const gateAuthorizedRef = useRef(false);
  gateCheckedRef.current = gate.checked;
  gateAuthorizedRef.current = gate.authorized;

  const fetchAgencyState = useCallback(async () => {
    try {
      const res = await fetch('/api/agency/state');
      if (res.status === 401 || res.status === 403) {
        setGate((prev) => ({ ...prev, checked: true, authorized: false }));
        setState(null);
        return;
      }
      if (!res.ok) throw new Error('Impossible de charger les données de l’agence.');
      const data = (await res.json()) as AgencyState;
      setState(data);
      setLoadError('');
    } catch (err: any) {
      setLoadError(err.message);
    } finally {
      setLoadingState(false);
    }
  }, []);

  const fetchOAuthStatuses = useCallback(async () => {
    try {
      const res = await fetch('/api/oauth/status');
      if (!res.ok) return;
      const data = (await res.json()) as { statuses: ThirdPartyProviderStatus[] };
      setProviderStatuses(data.statuses || []);
    } catch {
      // Non-blocking status check
    }
  }, []);

  const refreshGateAndData = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/gate');
      if (!res.ok) throw new Error('Impossible de vérifier l’accès.');
      const data = await res.json();
      setGate({
        checked: true,
        lockEnabled: Boolean(data.lockEnabled),
        agencyName: data.agencyName || 'Omnix',
        hasAdmin: Boolean(data.hasAdmin),
        authorized: Boolean(data.authorized),
        email: data.email || null,
        isAdmin: Boolean(data.isAdmin),
      });
      if (data.authorized) {
        await Promise.all([fetchAgencyState(), fetchOAuthStatuses()]);
      } else {
        setLoadingState(false);
      }
    } catch (err: any) {
      setLoadError(err.message || 'Erreur réseau.');
      setLoadingState(false);
    }
  }, [fetchAgencyState, fetchOAuthStatuses]);

  useEffect(() => {
    refreshGateAndData();
  }, [refreshGateAndData]);

  const establishServerSession = useCallback(
    async (firebaseUser: User) => {
      const idToken = await firebaseUser.getIdToken();
      const sessionRes = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok) {
        setGate((prev) => ({
          ...prev,
          checked: true,
          authorized: false,
          email: firebaseUser.email || null,
        }));
        setGateError(
          sessionData.error || 'Votre compte Google n’est pas autorisé à accéder à Omnix.'
        );
        setLoadingState(false);
        return false;
      }

      setGateError('');
      setGate((prev) => ({
        ...prev,
        checked: true,
        authorized: true,
        hasAdmin: true,
        email: sessionData.email || firebaseUser.email || null,
        isAdmin: Boolean(sessionData.isAdmin),
      }));

      if (firebaseUser.email) {
        try {
          const regRes = await fetch('/api/agency/team/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: firebaseUser.email,
              name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
              photoUrl: firebaseUser.photoURL || undefined,
            }),
          });
          if (regRes.ok) {
            const regData = await regRes.json();
            if (regData.state) setState(regData.state);
          }
        } catch {
          // ignore registration sync error
        }
      }

      await Promise.all([fetchAgencyState(), fetchOAuthStatuses()]);
      return true;
    },
    [fetchAgencyState, fetchOAuthStatuses]
  );

  // Listen for Google Auth state without overwriting an active password session
  useEffect(() => {
    const unsub = initAuth(async (firebaseUser, token) => {
      setUser(firebaseUser);
      setWorkspaceToken(token);
      if (firebaseUser && gateCheckedRef.current && !gateAuthorizedRef.current) {
        await establishServerSession(firebaseUser);
      }
    });
    return () => unsub();
  }, [establishServerSession]);

  // Listen for 3P OAuth popup completion messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchOAuthStatuses();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchOAuthStatuses]);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setGateError('');
    try {
      const { user: signedUser, accessToken } = await googleSignIn();
      setUser(signedUser);
      setWorkspaceToken(accessToken);
      await establishServerSession(signedUser);
    } catch (err: any) {
      console.error('Google Sign-In error:', err);
      setGateError(err?.message || 'Échec de la connexion Google.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await logoutGoogle();
    setUser(null);
    setWorkspaceToken(null);
    setGateError('');
    await refreshGateAndData();
  };

  const handlePasswordAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setGateError('');
    try {
      const endpoint = gate.hasAdmin ? '/api/auth/login' : '/api/auth/register-admin';
      const payload = gate.hasAdmin
        ? { email: loginEmail, password: loginPassword }
        : { name: loginName, email: loginEmail, password: loginPassword };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setGateError(data.error || 'Connexion impossible.');
        return;
      }

      setLoginPassword('');
      setGate((prev) => ({
        ...prev,
        checked: true,
        authorized: true,
        hasAdmin: true,
        email: data.email || loginEmail.trim().toLowerCase(),
        isAdmin: Boolean(data.isAdmin),
      }));
      await Promise.all([fetchAgencyState(), fetchOAuthStatuses()]);
    } catch (err: any) {
      setGateError(err?.message || 'Erreur réseau lors de la connexion.');
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    if (!state) return;
    if (state.projects.length === 0) {
      if (selectedProjectId) setSelectedProjectId('');
      return;
    }
    if (!selectedProjectId || !state.projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(state.projects[0].id);
    }
  }, [state, selectedProjectId]);

  const apiJson = useCallback(
    async <T,>(url: string, options?: RequestInit): Promise<T> => {
      setActionError('');
      let res: Response;
      try {
        res = await fetch(url, options);
      } catch {
        const msg = 'Impossible de joindre le serveur. Vérifiez votre connexion internet.';
        setActionError(msg);
        throw new Error(msg);
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        const msg =
          data?.error ||
          (res.status === 401
            ? 'Votre session a expiré. Veuillez vous reconnecter.'
            : 'Accès refusé pour cette action.');
        if (res.status === 401) {
          setGateError(msg);
          await refreshGateAndData();
        } else {
          setActionError(msg);
        }
        throw new Error(msg);
      }

      if (!res.ok) {
        const msg = data?.error || data?.message || `Erreur serveur (${res.status}).`;
        setActionError(msg);
        throw new Error(msg);
      }

      return data as T;
    },
    [refreshGateAndData]
  );

  // --- Agency Mutations ---
  const handleToggleChecklist = async (id: string, completed: boolean) => {
    const next = await apiJson<AgencyState>(`/api/agency/checklist/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    setState(next);
  };

  const handleToggleRoadmapTask = async (weekId: string, taskId: string, completed: boolean) => {
    const next = await apiJson<AgencyState>(`/api/agency/roadmap/${weekId}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    setState(next);
  };

  const handleCreateProject = async (payload: Partial<ClientProject>): Promise<ClientProject> => {
    const data = await apiJson<{ project: ClientProject; state: AgencyState }>(
      '/api/agency/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    setState(data.state);
    setSelectedProjectId(data.project.id);
    return data.project;
  };

  const handleUpdateProject = async (id: string, updates: Partial<ClientProject>): Promise<ClientProject> => {
    const data = await apiJson<{ project: ClientProject; state: AgencyState }>(
      `/api/agency/projects/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }
    );
    setState(data.state);
    return data.project;
  };

  const handleDeleteProject = async (id: string) => {
    const next = await apiJson<AgencyState>(`/api/agency/projects/${id}`, { method: 'DELETE' });
    setState(next);
  };

  const handleCreateTask = async (payload: Partial<KanbanTask>) => {
    const next = await apiJson<AgencyState>('/api/agency/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setState(next);
  };

  const handleUpdateTask = async (id: string, updates: Partial<KanbanTask>) => {
    const next = await apiJson<AgencyState>(`/api/agency/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setState(next);
  };

  const handleDeleteTask = async (id: string) => {
    const next = await apiJson<AgencyState>(`/api/agency/tasks/${id}`, { method: 'DELETE' });
    setState(next);
  };

  const handleCreateAppointment = async (payload: Partial<AgencyAppointment>) => {
    const data = await apiJson<{ appointment: AgencyAppointment; state: AgencyState }>(
      '/api/agency/appointments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    setState(data.state);
  };

  const handleDeleteAppointment = async (id: string) => {
    const next = await apiJson<AgencyState>(`/api/agency/appointments/${id}`, { method: 'DELETE' });
    setState(next);
  };

  const handleCreateProspect = async (payload: Partial<Prospect>) => {
    const next = await apiJson<AgencyState>('/api/agency/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setState(next);
  };

  const handleUpdateProspect = async (id: string, updates: Partial<Prospect>) => {
    const next = await apiJson<AgencyState>(`/api/agency/prospects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setState(next);
  };

  const handleDeleteProspect = async (id: string) => {
    const next = await apiJson<AgencyState>(`/api/agency/prospects/${id}`, { method: 'DELETE' });
    setState(next);
  };

  const handleUpdateMember = async (id: string, updates: Partial<TeamMember>) => {
    const next = await apiJson<AgencyState>(`/api/agency/members/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setState(next);
  };

  const handleAddMember = async (payload: Partial<TeamMember>) => {
    const next = await apiJson<AgencyState>('/api/agency/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setState(next);
  };

  const handleDeleteMember = async (id: string) => {
    const next = await apiJson<AgencyState>(`/api/agency/members/${id}`, { method: 'DELETE' });
    setState(next);
  };

  const handleAddFinance = async (payload: Partial<FinanceEntry>) => {
    const next = await apiJson<AgencyState>('/api/agency/finances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setState(next);
  };

  const handleUpdateFinance = async (id: string, updates: Partial<FinanceEntry>) => {
    const next = await apiJson<AgencyState>(`/api/agency/finances/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setState(next);
  };

  const handleDeleteFinance = async (id: string) => {
    const next = await apiJson<AgencyState>(`/api/agency/finances/${id}`, { method: 'DELETE' });
    setState(next);
  };

  const handleUpdateSettings = async (updates: Partial<AgencyState['settings']>) => {
    const next = await apiJson<AgencyState>('/api/agency/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setState(next);
  };

  if (!gate.checked || (gate.authorized && loadingState)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] text-sm text-slate-500">
        Vérification de votre accès à Omnix...
      </div>
    );
  }

  if (!gate.authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-xs font-bold text-white tracking-wide">
              OM
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                {gate.agencyName} — Accès équipe
              </h1>
              <p className="text-xs text-slate-500">
                Espace privé réservé aux membres autorisés
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs leading-relaxed text-slate-700 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              {gate.hasAdmin ? (
                <KeyRound className="h-4 w-4 text-blue-600 shrink-0" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
              )}
              <span>
                {gate.hasAdmin
                  ? 'Connexion directe par e-mail et mot de passe'
                  : 'Créer l’accès administrateur Omnix'}
              </span>
            </div>
            <p className="text-slate-600">
              {gate.hasAdmin
                ? 'Saisissez votre e-mail d’équipe et votre mot de passe Omnix. Aucune vérification Google n’est requise.'
                : 'Premier lancement : choisissez votre e-mail et votre mot de passe administrateur. Vous pourrez ensuite créer des accès pour votre fils et ses coéquipiers.'}
            </p>
          </div>

          {gateError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 space-y-2">
              <p>{gateError}</p>
              {user && (
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  className="inline-flex items-center gap-1.5 font-semibold text-red-800 hover:underline"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Réinitialiser la session Google</span>
                </button>
              )}
            </div>
          )}

          <form onSubmit={handlePasswordAuthSubmit} className="space-y-3.5">
            {!gate.hasAdmin && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Votre prénom ou nom
                </label>
                <input
                  type="text"
                  required
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="Ex : Louis"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Adresse e-mail
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="vous@exemple.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Mot de passe {!gate.hasAdmin && '(6 caractères minimum)'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={gate.hasAdmin ? 1 : 6}
                  autoComplete={gate.hasAdmin ? 'current-password' : 'new-password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors"
            >
              {authLoading
                ? 'Vérification...'
                : gate.hasAdmin
                  ? 'Se connecter à Omnix'
                  : 'Créer mon compte administrateur'}
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="mx-3 shrink text-[11px] text-slate-400">ou</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <div className="flex flex-col gap-2">
            <GoogleSignInButton
              onClick={handleGoogleSignIn}
              loading={signingIn}
              label="Continuer avec Google (optionnel)"
            />
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-red-700">
            {loadError || 'Erreur de chargement.'}
          </p>
          <button
            type="button"
            onClick={fetchAgencyState}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  const connectedThirdPartyCount = providerStatuses.filter((p) => p.connected).length;

  return (
    <div className="flex min-h-screen bg-[#f5f6f8] text-slate-900">
      <Sidebar
        activeSection={activeSection}
        onSelect={setActiveSection}
        agencyName={state.settings.agencyName}
        currentMonthLabel={state.settings.currentMonthLabel}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        connectedGoogle={Boolean(workspaceToken)}
        connectedThirdPartyCount={connectedThirdPartyCount}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar
          activeSection={activeSection}
          agencyName={state.settings.agencyName}
          gateEmail={gate.email}
          user={user}
          hasWorkspaceToken={Boolean(workspaceToken)}
          signingIn={signingIn}
          onSignIn={handleGoogleSignIn}
          onSignOut={handleGoogleSignOut}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickOpenStudio={() => setActiveSection('ai-studio')}
          onOpenJarvis={() => setJarvisOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {actionError && (
            <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{actionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionError('')}
                className="rounded p-1 text-red-500 hover:bg-red-100 hover:text-red-700"
                aria-label="Fermer l’alerte"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {activeSection === 'overview' && (
            <OverviewView
              state={state}
              hasWorkspaceToken={Boolean(workspaceToken)}
              providerStatuses={providerStatuses}
              onToggleChecklist={handleToggleChecklist}
              onToggleRoadmapTask={handleToggleRoadmapTask}
              onUpdateSettings={handleUpdateSettings}
              onNavigate={setActiveSection}
              onOpenNewProject={() => {
                setOpenNewProjectNonce((n) => n + 1);
                setActiveSection('projects');
              }}
              onOpenProject={(projId) => {
                setSelectedProjectId(projId);
                setActiveSection('projects');
              }}
              onOpenAiStudio={(projId) => {
                if (projId) setSelectedProjectId(projId);
                setActiveSection('ai-studio');
              }}
            />
          )}

          {activeSection === 'ai-studio' && (
            <AiStudioView
              projects={state.projects}
              activeProjectId={selectedProjectId}
              onSelectProjectId={setSelectedProjectId}
              workspaceToken={workspaceToken}
              providerStatuses={providerStatuses}
              onSaveProjectHtml={async (projectId, html) => {
                await handleUpdateProject(projectId, { generatedHtml: html });
              }}
              onCreateProjectWithHtml={async (clientName, html) => {
                return handleCreateProject({
                  clientName,
                  generatedHtml: html,
                  isDemo: true,
                  step: 5,
                });
              }}
            />
          )}

          {activeSection === 'projects' && (
            <ProjectsView
              state={state}
              selectedProjectId={selectedProjectId}
              onSelectProjectId={setSelectedProjectId}
              openNewProjectNonce={openNewProjectNonce}
              onCreateProject={handleCreateProject}
              onUpdateProject={handleUpdateProject}
              onDeleteProject={handleDeleteProject}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
              onAddFinance={handleAddFinance}
              onOpenAiStudio={(projId) => {
                if (projId) setSelectedProjectId(projId);
                setActiveSection('ai-studio');
              }}
            />
          )}

          {activeSection === 'calendar' && (
            <CalendarView
              state={state}
              workspaceToken={workspaceToken}
              onSignInGoogle={handleGoogleSignIn}
              onCreateAppointment={handleCreateAppointment}
              onDeleteAppointment={handleDeleteAppointment}
            />
          )}

          {activeSection === 'prospects' && (
            <ProspectsOutreachView
              state={state}
              workspaceToken={workspaceToken}
              onSignInGoogle={handleGoogleSignIn}
              onCreateProspect={handleCreateProspect}
              onUpdateProspect={handleUpdateProspect}
              onDeleteProspect={handleDeleteProspect}
              onSaveDefaultFormId={(formId) =>
                handleUpdateSettings({ defaultGoogleFormId: formId })
              }
              onConvertToProject={async (prospect) => {
                const created = await handleCreateProject({
                  clientName: prospect.businessName,
                  sector: prospect.category,
                  contactEmail: prospect.contactEmail,
                  contactPhone: prospect.phone,
                  isDemo: false,
                  step: 1,
                  legal: createDefaultLegalInfo({
                    legalForm:
                      prospect.category === 'Club / Association'
                        ? 'Association loi 1901'
                        : 'EI / Micro-entrepreneur',
                    legalCompanyName: prospect.businessName,
                    privacyControllerEmail: prospect.contactEmail,
                    registeredAddress: prospect.cityArea,
                  }),
                  notes: prospect.notes
                    ? `Issu de prospection (${prospect.cityArea}). ${prospect.notes}`
                    : `Issu de prospection (${prospect.cityArea}).`,
                });
                await handleUpdateProspect(prospect.id, { status: 'Gagné' });
                setSelectedProjectId(created.id);
                setActiveSection('projects');
              }}
            />
          )}

          {activeSection === 'integrations' && (
            <IntegrationsHubView
              state={state}
              workspaceToken={workspaceToken}
              providerStatuses={providerStatuses}
              onSignInGoogle={handleGoogleSignIn}
              onRefreshOAuthStatuses={fetchOAuthStatuses}
              onSaveSettings={handleUpdateSettings}
            />
          )}

          {activeSection === 'team-finance' && (
            <TeamFinanceView
              state={state}
              currentUserEmail={gate.email || user?.email || ''}
              onUpdateMember={handleUpdateMember}
              onAddMember={handleAddMember}
              onDeleteMember={handleDeleteMember}
              onAddFinance={handleAddFinance}
              onUpdateFinance={handleUpdateFinance}
              onDeleteFinance={handleDeleteFinance}
              onUpdateSettings={handleUpdateSettings}
              onStateReplaced={(nextState) => setState(nextState)}
            />
          )}
        </main>
      </div>

      <JarvisDrawer
        open={jarvisOpen}
        onClose={() => setJarvisOpen(false)}
        state={state}
        user={user}
        gateEmail={gate.email}
        workspaceToken={workspaceToken}
        providerStatuses={providerStatuses}
      />
    </div>
  );
}
