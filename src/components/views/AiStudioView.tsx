import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Smartphone,
  Monitor,
  Code2,
  Eye,
  ShieldCheck,
  Save,
  Download,
  UploadCloud,
  Github,
  Globe,
  Wand2,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  ExternalLink,
  Scale,
} from 'lucide-react';
import type { ClientProject, ThirdPartyProviderStatus } from '../../types';
import { uploadHtmlToGoogleDrive } from '../../lib/googleWorkspace';
import { evaluateProjectLegalCompliance } from '../../lib/legalCompliance';
import { ConfirmModal } from '../ConfirmModal';

interface AiStudioViewProps {
  projects: ClientProject[];
  activeProjectId?: string;
  onSelectProjectId?: (id: string) => void;
  workspaceToken: string | null;
  providerStatuses: ThirdPartyProviderStatus[];
  onSaveProjectHtml: (projectId: string, html: string) => Promise<void>;
  onCreateProjectWithHtml: (clientName: string, html: string) => Promise<ClientProject>;
}

const DEMO_PRESETS = [
  {
    label: 'Boulangerie artisanale',
    prompt:
      'Site vitrine pour une boulangerie-pâtisserie de quartier avec pains au levain, horaires d’ouverture (Mar-Sam 6h30-19h30), adresse, bouton appeler et formulaire commande gâteaux.',
  },
  {
    label: 'Club de sport local',
    prompt:
      'Site pour un club sportif municipal (football & athlétisme) avec planning des entraînements, tarifs d’inscription jeunes/adultes, bouton essai gratuit et contact.',
  },
  {
    label: 'Coach sportif',
    prompt:
      'Page professionnelle pour un coach sportif indépendant : séances individuelles et en petit groupe, 3 formules claires, avis clients, prise de contact rapide.',
  },
  {
    label: 'Artisan menuisier',
    prompt:
      'Site pour un artisan menuisier local : réalisations sur mesure (cuisines, placards, terrasses), zone d’intervention, demande de devis gratuit et téléphone.',
  },
];

const PALETTES = [
  { name: 'Ardoise & Cobalt', primary: '#2563eb', background: '#ffffff', text: '#0f172a' },
  { name: 'Forêt & Crème', primary: '#15803d', background: '#f8fafc', text: '#0f172a' },
  { name: 'Bordeaux & Sable', primary: '#b91c1c', background: '#ffffff', text: '#1e293b' },
  { name: 'Nocturne & Ambre', primary: '#d97706', background: '#0f172a', text: '#f8fafc' },
];

export const AiStudioView: React.FC<AiStudioViewProps> = ({
  projects,
  activeProjectId,
  onSelectProjectId,
  workspaceToken,
  providerStatuses,
  onSaveProjectHtml,
  onCreateProjectWithHtml,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    activeProjectId || projects[0]?.id || ''
  );
  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const [newProjectName, setNewProjectName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [refineInput, setRefineInput] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [fontPair, setFontPair] = useState('Plus Jakarta Sans + DM Sans');
  const [htmlCode, setHtmlCode] = useState(selectedProject?.generatedHtml || '');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop');

  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [savingHtml, setSavingHtml] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    summary: string;
    checks: Array<{ label: string; passed: boolean; advice: string }>;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [githubRepos, setGithubRepos] = useState<Array<{ full_name: string }>>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [netlifySites, setNetlifySites] = useState<Array<{ id: string; name: string; ssl_url?: string }>>([]);
  const [selectedNetlifySite, setSelectedNetlifySite] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    kind: 'drive' | 'github' | 'netlify';
    title: string;
    description: string;
  } | null>(null);
  const [deploying, setDeploying] = useState(false);

  const githubConnected = providerStatuses.find((p) => p.provider === 'github')?.connected;
  const netlifyConnected = providerStatuses.find((p) => p.provider === 'netlify')?.connected;

  useEffect(() => {
    if (activeProjectId && projects.some((p) => p.id === activeProjectId)) {
      setSelectedProjectId(activeProjectId);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (selectedProject) {
      setHtmlCode(selectedProject.generatedHtml || '');
      setAuditResult(null);
      if (selectedProject.integrations.githubRepo) {
        setSelectedRepo(selectedProject.integrations.githubRepo);
      }
      if (selectedProject.integrations.netlifySiteId) {
        setSelectedNetlifySite(selectedProject.integrations.netlifySiteId);
      }
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (githubConnected) {
      fetch('/api/integrations/github/repos')
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (Array.isArray(data)) {
            setGithubRepos(data);
            if (!selectedRepo && data[0]?.full_name) {
              setSelectedRepo(data[0].full_name);
            }
          }
        })
        .catch(() => {});
    }
  }, [githubConnected]);

  useEffect(() => {
    if (netlifyConnected) {
      fetch('/api/integrations/netlify/sites')
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (Array.isArray(data)) {
            setNetlifySites(data);
            if (!selectedNetlifySite && data[0]?.id) {
              setSelectedNetlifySite(data[0].id);
            }
          }
        })
        .catch(() => {});
    }
  }, [netlifyConnected]);

  const handleGenerate = async () => {
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/ai/generate-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          project: selectedProject,
          palette: PALETTES[paletteIdx],
          fontPair,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Échec de génération');
      }
      setHtmlCode(data.html);
      setViewMode('preview');
      if (selectedProject) {
        await onSaveProjectHtml(selectedProject.id, data.html);
        setFeedback({ type: 'ok', text: 'Site généré et enregistré dans le projet.' });
      } else {
        setFeedback({ type: 'ok', text: 'Site généré ! Vous pouvez le retoucher ou l’enregistrer comme nouveau projet.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!htmlCode || !refineInput.trim()) return;
    setRefining(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/ai/refine-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentHtml: htmlCode,
          instruction: refineInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Échec de la retouche');
      }
      setHtmlCode(data.html);
      setRefineInput('');
      if (selectedProject) {
        await onSaveProjectHtml(selectedProject.id, data.html);
      }
      setFeedback({ type: 'ok', text: 'Modification appliquée par Google AI Studio.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setRefining(false);
    }
  };

  const handleAudit = async () => {
    if (!htmlCode) return;
    setAuditing(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/ai/review-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlCode, project: selectedProject }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Audit impossible');
      }
      setAuditResult(data);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setAuditing(false);
    }
  };

  const handleSaveManualEdits = async () => {
    if (!selectedProject || savingHtml) return;
    setSavingHtml(true);
    setFeedback(null);
    try {
      await onSaveProjectHtml(selectedProject.id, htmlCode);
      setFeedback({ type: 'ok', text: 'Modifications manuelles enregistrées.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Impossible d’enregistrer les modifications.' });
    } finally {
      setSavingHtml(false);
    }
  };

  const handleCreateProjectFromStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !htmlCode || creatingProject) return;
    setCreatingProject(true);
    setFeedback(null);
    try {
      const created = await onCreateProjectWithHtml(newProjectName.trim(), htmlCode);
      setSelectedProjectId(created.id);
      onSelectProjectId?.(created.id);
      setNewProjectName('');
      setFeedback({ type: 'ok', text: `Projet "${created.clientName}" créé avec ce site !` });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Impossible de créer le projet.' });
    } finally {
      setCreatingProject(false);
    }
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([htmlCode], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(selectedProject?.clientName || 'site-client').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const executeConfirmedDeploy = async () => {
    if (!confirmAction) return;
    setDeploying(true);
    setFeedback(null);
    try {
      if (confirmAction.kind === 'drive') {
        if (!workspaceToken) throw new Error('Connectez votre compte Google Workspace d’abord.');
        const fileName = `${selectedProject?.clientName || 'site-client'}-index.html`;
        const file = await uploadHtmlToGoogleDrive(workspaceToken, fileName, htmlCode);
        setFeedback({ type: 'ok', text: `Fichier "${file.name}" enregistré dans votre Google Drive.` });
      } else if (confirmAction.kind === 'github') {
        if (!selectedRepo) throw new Error('Sélectionnez un dépôt GitHub.');
        const res = await fetch('/api/integrations/github/push-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullRepoName: selectedRepo,
            html: htmlCode,
            commitMessage: `Déploiement ${selectedProject?.clientName || 'site'} depuis Studio IA`,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Échec push GitHub');
        setFeedback({ type: 'ok', text: `index.html poussé sur GitHub (${selectedRepo}).` });
      } else if (confirmAction.kind === 'netlify') {
        if (!selectedNetlifySite) throw new Error('Sélectionnez un site Netlify.');
        const res = await fetch('/api/integrations/netlify/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: selectedNetlifySite, html: htmlCode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Échec déploiement Netlify');
        setFeedback({ type: 'ok', text: `Site déployé en ligne sur Netlify (${data.ssl_url || data.url || 'OK'}).` });
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setDeploying(false);
      setConfirmAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <ConfirmModal
        open={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        description={confirmAction?.description || ''}
        loading={deploying}
        onConfirm={executeConfirmedDeploy}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Top Controls Bar */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-6 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Studio IA intégré (Google AI Studio · Gemini)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Décrivez le site, générez le code HTML/CSS en direct, retouchez à la main, vérifiez sur mobile et publiez.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {projects.length > 0 && (
              <select
                value={selectedProject?.id || ''}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  onSelectProjectId?.(e.target.value);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                aria-label="Sélectionner un projet"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName} ({p.offerTier})
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{generating ? 'Génération en cours...' : 'Générer le site avec Gemini'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 pt-3 border-t border-slate-100">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Description du site à créer
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Ex : Site vitrine pour un artisan ou commerce local avec horaires, tarifs et bouton d’appel..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/40 px-3 py-2 text-sm text-slate-900 focus:bg-white"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">Idées de démos :</span>
              {DEMO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Palette de couleurs
              </label>
              <select
                value={paletteIdx}
                onChange={(e) => setPaletteIdx(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
              >
                {PALETTES.map((pal, i) => (
                  <option key={pal.name} value={i}>
                    {pal.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Typographie (Google Fonts)
              </label>
              <select
                value={fontPair}
                onChange={(e) => setFontPair(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
              >
                <option value="Plus Jakarta Sans + DM Sans">Plus Jakarta Sans + DM Sans</option>
                <option value="Playfair Display + Lora">Playfair Display + Lora (Artisan / Boutique)</option>
                <option value="Barlow Condensed + Public Sans">Barlow Condensed + Public Sans (Club sportif)</option>
                <option value="Outfit + Manrope">Outfit + Manrope (Moderne / Coach)</option>
              </select>
            </div>
          </div>
        </div>

        {selectedProject && (() => {
          const legalReport = evaluateProjectLegalCompliance(selectedProject);
          return (
            <div
              className={`rounded-lg border px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                legalReport.isFullyCompliant
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                  : 'border-amber-200 bg-amber-50/70 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 shrink-0" />
                <span>
                  <strong>Conformité légale ({selectedProject.clientName}) :</strong>{' '}
                  {legalReport.score}/{legalReport.total} points prêts pour les mentions légales & RGPD.
                  {!legalReport.isFullyCompliant && legalReport.missingLabels.length > 0 && (
                    <> Manque : {legalReport.missingLabels.slice(0, 3).join(', ')}.</>
                  )}
                </span>
              </div>
              <span className="font-mono text-[11px]">
                Injecté automatiquement dans la génération IA
              </span>
            </div>
          );
        })()}

        {feedback && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {feedback.text}
          </div>
        )}
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3 rounded-2xl border border-slate-200/90 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 bg-slate-50/70">
            <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                  viewMode === 'preview' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Aperçu</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('code')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                  viewMode === 'code' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>Code HTML</span>
              </button>
            </div>

            {viewMode === 'preview' && (
              <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
                <button
                  type="button"
                  onClick={() => setDeviceMode('desktop')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    deviceMode === 'desktop' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  <span>Ordinateur</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeviceMode('mobile')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    deviceMode === 'mobile' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>Téléphone (375px)</span>
                </button>
              </div>
            )}

            <div className="flex items-center gap-2">
              {selectedProject && (
                <button
                  type="button"
                  onClick={handleSaveManualEdits}
                  disabled={!htmlCode || savingHtml}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingHtml ? 'Sauvegarde...' : 'Enregistrer'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDownloadHtml}
                disabled={!htmlCode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exporter .html</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-100/80 p-4 flex justify-center min-h-[540px]">
            {!htmlCode ? (
              <div className="flex flex-col items-center justify-center text-center max-w-md py-16">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-blue-600 mb-4 shadow-xs">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Prêt à générer votre premier site
                </h3>
                <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                  Sélectionnez une idée de démo ci-dessus ou décrivez le site de votre client, puis cliquez sur « Générer le site avec Gemini ».
                </p>
              </div>
            ) : viewMode === 'preview' ? (
              <iframe
                title="Aperçu site client"
                srcDoc={htmlCode}
                sandbox="allow-scripts"
                className={`bg-white border border-slate-200 rounded-xl shadow-xs transition-all ${
                  deviceMode === 'mobile' ? 'w-[375px] h-[640px]' : 'w-full h-[600px]'
                }`}
              />
            ) : (
              <textarea
                value={htmlCode}
                onChange={(e) => setHtmlCode(e.target.value)}
                spellCheck={false}
                className="w-full h-[600px] rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-100 focus:outline-none"
              />
            )}
          </div>
        </div>

        {/* Right Copilot, Save as Project, Audit & Deployment */}
        <div className="space-y-5">
          {!selectedProject && htmlCode && (
            <form
              onSubmit={handleCreateProjectFromStudio}
              className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FolderPlus className="h-4 w-4 text-blue-600" />
                <span>Créer un projet avec ce site</span>
              </div>
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Nom du client ou démo..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={creatingProject || !newProjectName.trim()}
                className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {creatingProject ? 'Création...' : 'Enregistrer dans Projets'}
              </button>
            </form>
          )}

          <form
            onSubmit={handleRefine}
            className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-3"
          >
            <h3 className="text-sm font-semibold text-slate-900">Retouche rapide avec l’IA</h3>
            <p className="text-xs text-slate-500">
              Demandez une modification ciblée sur la maquette actuelle.
            </p>
            <textarea
              value={refineInput}
              onChange={(e) => setRefineInput(e.target.value)}
              rows={3}
              placeholder="Ex : Remplace l'horaire du dimanche par 7h-12h30 et agrandis le bouton d'appel."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-900 focus:bg-white"
            />
            <button
              type="submit"
              disabled={refining || !htmlCode || !refineInput.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>{refining ? 'Application...' : 'Appliquer la retouche'}</span>
            </button>
          </form>

          <div className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Audit qualité & Loi (7 points)</h3>
              <button
                type="button"
                onClick={handleAudit}
                disabled={auditing || !htmlCode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                <span>{auditing ? 'Audit...' : 'Vérifier'}</span>
              </button>
            </div>
            {auditResult ? (
              <div className="space-y-2.5 pt-1">
                <p className="text-xs text-slate-600">{auditResult.summary}</p>
                {auditResult.checks?.map((chk, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs border-t border-slate-100 pt-2">
                    {chk.passed ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium text-slate-900">{chk.label}</div>
                      <div className="text-slate-500">{chk.advice}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Vérifie NAP, mobile, droits images, mentions légales LCEN (SIREN/SIRET/hébergeur), RGPD, médiateur B2C, cookies & SEO local.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Publier vers vos comptes</h3>

            <button
              type="button"
              disabled={!htmlCode || !workspaceToken}
              onClick={() =>
                setConfirmAction({
                  kind: 'drive',
                  title: 'Enregistrer dans Google Drive ?',
                  description: `Le fichier HTML pour "${selectedProject?.clientName || 'site-client'}" sera créé dans votre Google Drive connecté.`,
                })
              }
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>
                {workspaceToken ? 'Sauvegarder sur Google Drive' : 'Google Drive (connecter Google)'}
              </span>
            </button>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              {githubConnected ? (
                <>
                  {githubRepos.length > 0 && (
                    <select
                      value={selectedRepo}
                      onChange={(e) => setSelectedRepo(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
                    >
                      {githubRepos.map((r) => (
                        <option key={r.full_name} value={r.full_name}>
                          {r.full_name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    disabled={!htmlCode || !selectedRepo}
                    onClick={() =>
                      setConfirmAction({
                        kind: 'github',
                        title: 'Pousser index.html sur GitHub ?',
                        description: `Le fichier index.html du dépôt "${selectedRepo}" sera créé ou mis à jour directement sur GitHub.`,
                      })
                    }
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Github className="h-3.5 w-3.5" />
                    <span>Pousser sur GitHub</span>
                  </button>
                </>
              ) : (
                <a
                  href="https://github.com/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Github className="h-3.5 w-3.5" />
                  <span>Ouvrir GitHub</span>
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                </a>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              {netlifyConnected ? (
                <>
                  {netlifySites.length > 0 && (
                    <select
                      value={selectedNetlifySite}
                      onChange={(e) => setSelectedNetlifySite(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
                    >
                      {netlifySites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    disabled={!htmlCode || !selectedNetlifySite}
                    onClick={() =>
                      setConfirmAction({
                        kind: 'netlify',
                        title: 'Mettre en ligne sur Netlify ?',
                        description: `La version actuelle sera déployée immédiatement sur votre site Netlify sélectionné.`,
                      })
                    }
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>Déployer sur Netlify</span>
                  </button>
                </>
              ) : (
                <a
                  href="https://app.netlify.com/drop"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>Déployer sur Netlify Drop</span>
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
