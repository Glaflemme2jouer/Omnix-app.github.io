import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  FolderPlus,
  Github,
  MessageSquare,
  Figma,
  Globe,
  RefreshCw,
  Send,
  Unplug,
  ExternalLink,
  Copy,
  Check,
  Palette,
} from 'lucide-react';
import type { AgencyState, ThirdPartyProviderStatus } from '../../types';
import {
  createGoogleDriveFolder,
  listGoogleDriveFiles,
  type GoogleDriveFile,
} from '../../lib/googleWorkspace';
import { ConfirmModal } from '../ConfirmModal';
import { GoogleSignInButton } from '../GoogleSignInButton';

interface IntegrationsHubViewProps {
  state: AgencyState;
  workspaceToken: string | null;
  providerStatuses: ThirdPartyProviderStatus[];
  onSignInGoogle: () => void;
  onRefreshOAuthStatuses: () => Promise<void>;
  onSaveSettings: (updates: Partial<AgencyState['settings']>) => Promise<void>;
}

const PROVIDER_META: Record<
  'github' | 'discord' | 'figma' | 'netlify',
  { title: string; roleDesc: string; url: string; buttonLabel: string }
> = {
  github: {
    title: 'GitHub',
    roleDesc: 'Dépôts de code et hébergement GitHub Pages pour chaque site client',
    url: 'https://github.com',
    buttonLabel: 'Ouvrir GitHub',
  },
  discord: {
    title: 'Discord',
    roleDesc: 'Serveurs d’équipe, salons par projet et envoi des bilans hebdomadaires',
    url: 'https://discord.com/app',
    buttonLabel: 'Ouvrir Discord',
  },
  figma: {
    title: 'Figma',
    roleDesc: 'Création et inspection des maquettes et pages de vos clients',
    url: 'https://www.figma.com',
    buttonLabel: 'Ouvrir Figma',
  },
  netlify: {
    title: 'Netlify',
    roleDesc: 'Déploiement instantané en ligne de vos sites HTML/CSS',
    url: 'https://app.netlify.com',
    buttonLabel: 'Ouvrir Netlify',
  },
};

export const IntegrationsHubView: React.FC<IntegrationsHubViewProps> = ({
  state,
  workspaceToken,
  providerStatuses,
  onSignInGoogle,
  onRefreshOAuthStatuses,
  onSaveSettings,
}) => {
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedUri, setCopiedUri] = useState('');

  // Google Drive Explorer
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFile[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [confirmDriveFolder, setConfirmDriveFolder] = useState(false);
  const [creatingDriveFolder, setCreatingDriveFolder] = useState(false);

  // GitHub Explorer
  const [githubRepos, setGithubRepos] = useState<Array<{ id: number; full_name: string; html_url: string; updated_at: string }>>([]);
  const [newRepoName, setNewRepoName] = useState('');
  const [confirmGithubCreate, setConfirmGithubCreate] = useState(false);
  const [creatingGithubRepo, setCreatingGithubRepo] = useState(false);

  // Discord Webhook & Guilds
  const [webhookInput, setWebhookInput] = useState(state.settings.discordWebhookUrl || '');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [discordMessage, setDiscordMessage] = useState('');
  const [discordGuilds, setDiscordGuilds] = useState<Array<{ id: string; name: string }>>([]);
  const [confirmDiscordSend, setConfirmDiscordSend] = useState(false);
  const [sendingDiscord, setSendingDiscord] = useState(false);

  // Figma Inspector
  const [figmaKey, setFigmaKey] = useState('');
  const [figmaData, setFigmaData] = useState<{ name?: string; lastModified?: string; document?: any } | null>(null);

  // Netlify Sites
  const [netlifySites, setNetlifySites] = useState<Array<{ id: string; name: string; ssl_url?: string }>>([]);

  // Legal Mentions Quick Preview
  const [legalOwner, setLegalOwner] = useState('');
  const [legalSiret, setLegalSiret] = useState('');
  const [legalHost, setLegalHost] = useState('Netlify, Inc. · 512 2nd Street, San Francisco');
  const [legalEmail, setLegalEmail] = useState('');

  useEffect(() => {
    if (state.settings.discordWebhookUrl && !webhookInput) {
      setWebhookInput(state.settings.discordWebhookUrl);
    }
  }, [state.settings.discordWebhookUrl]);

  const isConnected = (p: 'github' | 'discord' | 'figma' | 'netlify') =>
    Boolean(providerStatuses.find((s) => s.provider === p)?.connected);

  const loadDriveFiles = async () => {
    if (!workspaceToken) return;
    setLoadingDrive(true);
    try {
      const files = await listGoogleDriveFiles(workspaceToken, driveSearch);
      setDriveFiles(files);
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message });
    } finally {
      setLoadingDrive(false);
    }
  };

  useEffect(() => {
    if (workspaceToken) {
      loadDriveFiles();
    }
  }, [workspaceToken]);

  useEffect(() => {
    if (isConnected('github')) {
      fetch('/api/integrations/github/repos')
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => Array.isArray(d) && setGithubRepos(d))
        .catch(() => {});
    }
    if (isConnected('discord')) {
      fetch('/api/integrations/discord/guilds')
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => Array.isArray(d) && setDiscordGuilds(d))
        .catch(() => {});
    }
    if (isConnected('netlify')) {
      fetch('/api/integrations/netlify/sites')
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => Array.isArray(d) && setNetlifySites(d))
        .catch(() => {});
    }
  }, [providerStatuses]);

  const handleDisconnectProvider = async (provider: string) => {
    try {
      const res = await fetch(`/api/oauth/${provider}/disconnect`, { method: 'POST' });
      if (!res.ok) throw new Error('Impossible de déconnecter ce service.');
      await onRefreshOAuthStatuses();
      setStatusMessage({ type: 'ok', text: `Compte ${provider} déconnecté.` });
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err?.message || 'Erreur lors de la déconnexion.' });
    }
  };

  const executeCreateDriveFolder = async () => {
    if (!workspaceToken || !newFolderName.trim()) return;
    setCreatingDriveFolder(true);
    try {
      await createGoogleDriveFolder(workspaceToken, newFolderName.trim());
      setNewFolderName('');
      setStatusMessage({ type: 'ok', text: 'Dossier client créé dans Google Drive.' });
      await loadDriveFiles();
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message });
    } finally {
      setCreatingDriveFolder(false);
      setConfirmDriveFolder(false);
    }
  };

  const executeCreateGithubRepo = async () => {
    if (!newRepoName.trim()) return;
    setCreatingGithubRepo(true);
    try {
      const res = await fetch('/api/integrations/github/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRepoName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Erreur GitHub');
      setNewRepoName('');
      setStatusMessage({ type: 'ok', text: `Dépôt GitHub "${data.full_name}" créé.` });
      const rRes = await fetch('/api/integrations/github/repos');
      if (rRes.ok) setGithubRepos(await rRes.json());
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message });
    } finally {
      setCreatingGithubRepo(false);
      setConfirmGithubCreate(false);
    }
  };

  const handleSaveWebhookUrl = async () => {
    setSavingWebhook(true);
    setStatusMessage(null);
    try {
      await onSaveSettings({ discordWebhookUrl: webhookInput.trim() });
      setStatusMessage({ type: 'ok', text: 'URL du webhook Discord enregistrée.' });
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err?.message || 'Sauvegarde impossible.' });
    } finally {
      setSavingWebhook(false);
    }
  };

  const executeSendDiscordMessage = async () => {
    setSendingDiscord(true);
    try {
      await onSaveSettings({ discordWebhookUrl: webhookInput.trim() });
      const res = await fetch('/api/integrations/discord/send-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: webhookInput.trim(),
          content: discordMessage.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur Discord');
      setDiscordMessage('');
      setStatusMessage({ type: 'ok', text: 'Message envoyé sur votre salon Discord.' });
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message });
    } finally {
      setSendingDiscord(false);
      setConfirmDiscordSend(false);
    }
  };

  const handleLoadFigma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!figmaKey.trim()) return;
    setStatusMessage(null);
    const cleanedKey = figmaKey.includes('figma.com')
      ? figmaKey.split('/file/')[1]?.split('/')[0] || figmaKey.split('/design/')[1]?.split('/')[0] || figmaKey
      : figmaKey;
    try {
      const res = await fetch(`/api/integrations/figma/file?fileKey=${encodeURIComponent(cleanedKey)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.err || data.error || 'Impossible de charger le fichier Figma');
      setFigmaData(data);
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message });
    }
  };

  const copyText = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedUri(val);
      setTimeout(() => setCopiedUri(''), 1500);
    } catch {
      setStatusMessage({ type: 'err', text: 'Copie bloquée par le navigateur.' });
    }
  };

  const legalPreview = `Mentions légales (LCEN) : Édité par ${legalOwner || '[Raison sociale / Nom EI & Directeur pub.]'} · SIRET : ${legalSiret || '[14 chiffres]'} · Contact : ${legalEmail || '[E-mail & Téléphone]'} · Hébergeur : ${legalHost}. Données formulaire : conservées 36 mois max (droits RGPD via ${legalEmail || '[E-mail]'}).`;

  return (
    <div className="space-y-6">
      <ConfirmModal
        open={confirmDriveFolder}
        title="Créer un dossier dans Google Drive ?"
        description={`Un nouveau dossier nommé "${newFolderName}" sera créé dans votre Google Drive connecté.`}
        loading={creatingDriveFolder}
        onConfirm={executeCreateDriveFolder}
        onCancel={() => setConfirmDriveFolder(false)}
      />
      <ConfirmModal
        open={confirmGithubCreate}
        title="Créer un dépôt GitHub ?"
        description={`Un nouveau dépôt public nommé "${newRepoName}" sera créé sur votre compte GitHub connecté.`}
        loading={creatingGithubRepo}
        onConfirm={executeCreateGithubRepo}
        onCancel={() => setConfirmGithubCreate(false)}
      />
      <ConfirmModal
        open={confirmDiscordSend}
        title="Publier ce message sur Discord ?"
        description={`Le message sera envoyé immédiatement dans le salon configuré par votre Webhook Discord.`}
        loading={sendingDiscord}
        onConfirm={executeSendDiscordMessage}
        onCancel={() => setConfirmDiscordSend(false)}
      />

      {statusMessage && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
            statusMessage.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Account Connection Cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {/* Google Workspace Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Google Workspace</h3>
              <span className={`text-xs font-medium ${workspaceToken ? 'text-emerald-700' : 'text-slate-500'}`}>
                {workspaceToken ? 'Connecté' : 'À connecter'}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Agenda, Drive partagé, Gmail et Google Forms intégrés.
            </p>
          </div>
          {!workspaceToken && (
            <GoogleSignInButton onClick={onSignInGoogle} label="Connecter Google" />
          )}
        </div>

        {/* 3P Direct Redirect Cards */}
        {(['github', 'discord', 'figma', 'netlify'] as const).map((providerKey) => {
          const meta = PROVIDER_META[providerKey];
          const st = providerStatuses.find((s) => s.provider === providerKey);
          return (
            <div
              key={providerKey}
              className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{meta.title}</h3>
                  <span className="text-xs font-medium text-emerald-700">
                    {st?.connected ? 'Connecté' : 'Accès direct'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{meta.roleDesc}</p>
                {st?.connected && st.accountName && (
                  <p className="mt-2 text-xs font-medium text-slate-800 truncate">
                    {st.accountName} {st.accountHandle ? `(${st.accountHandle})` : ''}
                  </p>
                )}
              </div>

              {st?.connected ? (
                <div className="flex items-center gap-2">
                  <a
                    href={meta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    <span>Ouvrir</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDisconnectProvider(providerKey)}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
                    title="Déconnecter"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <a
                  href={meta.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                >
                  <span>{meta.buttonLabel}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          );
        })}
      </section>

      {/* Embedded Workspaces Grid */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Google Drive Embedded Explorer */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Google Drive intégré (Devis, factures, textes, images)
              </h3>
            </div>
            {workspaceToken && (
              <button
                type="button"
                onClick={loadDriveFiles}
                className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingDrive ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          {!workspaceToken ? (
            <div className="py-6 space-y-3">
              <p className="text-xs text-slate-500">
                Connectez Google pour explorer vos dossiers partagés et créer des dossiers clients sans quitter l’app.
              </p>
              <GoogleSignInButton onClick={onSignInGoogle} label="Connecter Google Drive" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={driveSearch}
                    onChange={(e) => setDriveSearch(e.target.value)}
                    placeholder="Rechercher un fichier..."
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={loadDriveFiles}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Chercher
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Nouveau dossier client..."
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={!newFolderName.trim()}
                    onClick={() => setConfirmDriveFolder(true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    <span>Créer</span>
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {driveFiles.map((f) => (
                  <div key={f.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{f.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {f.mimeType.includes('folder') ? 'Dossier' : 'Fichier'}
                      </div>
                    </div>
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-blue-600 p-1 shrink-0"
                        title="Ouvrir dans Drive"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Discord Integrated Channel & Weekly Bilan */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <MessageSquare className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Discord intégré (Serveurs & envoi du bilan)
            </h3>
          </div>

          {discordGuilds.length > 0 && (
            <div className="text-xs text-slate-600">
              Serveurs connectés :{' '}
              <span className="font-medium text-slate-900">
                {discordGuilds.slice(0, 5).map((g) => g.name).join(', ')}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              URL Webhook du salon Discord de l’agence (fonctionne immédiatement)
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={webhookInput}
                onChange={(e) => setWebhookInput(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono"
              />
              <button
                type="button"
                disabled={savingWebhook}
                onClick={handleSaveWebhookUrl}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {savingWebhook ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Message ou bilan écrit du dimanche à publier sur Discord
            </label>
            <textarea
              rows={3}
              value={discordMessage}
              onChange={(e) => setDiscordMessage(e.target.value)}
              placeholder="Bilan de la semaine : Ce qui avance / Ce qui bloque..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
          </div>

          <button
            type="button"
            disabled={!webhookInput.trim() || !discordMessage.trim()}
            onClick={() => setConfirmDiscordSend(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Publier sur Discord</span>
          </button>
        </div>

        {/* GitHub & Netlify Embedded Explorer */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Github className="h-4 w-4 text-slate-900" />
            <h3 className="text-sm font-semibold text-slate-900">
              GitHub & Netlify (Code et mise en ligne)
            </h3>
          </div>

          {!isConnected('github') && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Ouvrez directement GitHub ou Netlify Drop pour déposer vos fichiers HTML exportés depuis Studio IA.
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href="https://github.com/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Github className="h-3.5 w-3.5" />
                  <span>Nouveau dépôt GitHub</span>
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                </a>
                <a
                  href="https://app.netlify.com/drop"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Globe className="h-3.5 w-3.5 text-blue-600" />
                  <span>Netlify Drop (glisser-déposer)</span>
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                </a>
              </div>
            </div>
          )}

          {isConnected('github') && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  placeholder="Nom nouveau dépôt (ex : site-boulangerie)"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={!newRepoName.trim()}
                  onClick={() => setConfirmGithubCreate(true)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  Créer dépôt
                </button>
              </div>
              <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {githubRepos.map((repo) => (
                  <div key={repo.id} className="py-2 flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-800 truncate">{repo.full_name}</span>
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline shrink-0"
                    >
                      Ouvrir
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isConnected('netlify') && netlifySites.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 mb-2">
                <Globe className="h-3.5 w-3.5 text-blue-600" />
                <span>Sites Netlify connectés</span>
              </div>
              <div className="divide-y divide-slate-100">
                {netlifySites.slice(0, 5).map((s) => (
                  <div key={s.id} className="py-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{s.name}</span>
                    {s.ssl_url && (
                      <a
                        href={s.ssl_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Voir en ligne
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Figma Direct & Legal Mentions Builder */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Figma className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Maquettes Figma
                </h3>
              </div>
              <a
                href="https://www.figma.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                <span>Ouvrir Figma</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {isConnected('figma') ? (
              <form onSubmit={handleLoadFigma} className="flex gap-2">
                <input
                  type="text"
                  value={figmaKey}
                  onChange={(e) => setFigmaKey(e.target.value)}
                  placeholder="Coller URL ou clé de fichier Figma..."
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0"
                >
                  Charger maquette
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500">
                Cliquez sur « Ouvrir Figma » pour créer et partager vos maquettes clients avec l’équipe.
              </p>
            )}

            {figmaData && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="font-semibold text-slate-900">{figmaData.name}</div>
                <div className="text-slate-500 mt-1">
                  Pages :{' '}
                  {(figmaData.document?.children || [])
                    .map((c: any) => c.name)
                    .join(', ')}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Aperçu rapide Mentions légales & RGPD (générateur complet dans chaque Dossier Projet)
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={legalOwner}
                onChange={(e) => setLegalOwner(e.target.value)}
                placeholder="Entreprise & Directeur de publication"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
              />
              <input
                type="text"
                value={legalSiret}
                onChange={(e) => setLegalSiret(e.target.value)}
                placeholder="N° SIRET (14 chiffres)"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono"
              />
              <input
                type="text"
                value={legalEmail}
                onChange={(e) => setLegalEmail(e.target.value)}
                placeholder="Contact (e-mail + tél.)"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
              />
              <input
                type="text"
                value={legalHost}
                onChange={(e) => setLegalHost(e.target.value)}
                placeholder="Hébergeur + adresse"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <span>{legalPreview}</span>
              <button
                type="button"
                onClick={() => copyText(legalPreview)}
                className="text-blue-600 hover:text-blue-700 shrink-0 font-medium"
              >
                {copiedUri === legalPreview ? 'Copié' : 'Copier'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
