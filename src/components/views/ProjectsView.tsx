import React, { useEffect, useState } from 'react';
import {
  Plus,
  CheckSquare,
  Square,
  Trash2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Sparkles,
  FolderKanban,
  Save,
  ExternalLink,
  Download,
  Wallet,
  Link2,
  Check,
  AlertCircle,
  Scale,
  Copy,
} from 'lucide-react';
import type {
  AgencyState,
  ClientProject,
  FinanceEntry,
  KanbanTask,
  OfferTier,
  ProjectLegalInfo,
  ProjectStep,
  TaskColumn,
} from '../../types';
import { ConfirmModal } from '../ConfirmModal';
import { LegalQuestionnaireForm } from '../LegalQuestionnaireForm';
import {
  createDefaultLegalInfo,
  evaluateProjectLegalCompliance,
  generateLegalNoticeHtml,
  generateLegalNoticeText,
  normalizeProject,
} from '../../lib/legalCompliance';

interface ProjectsViewProps {
  state: AgencyState;
  selectedProjectId: string;
  onSelectProjectId: (id: string) => void;
  openNewProjectNonce?: number;
  onCreateProject: (payload: Partial<ClientProject>) => Promise<ClientProject>;
  onUpdateProject: (id: string, updates: Partial<ClientProject>) => Promise<ClientProject>;
  onDeleteProject: (id: string) => Promise<void>;
  onCreateTask: (payload: Partial<KanbanTask>) => Promise<void>;
  onUpdateTask: (id: string, updates: Partial<KanbanTask>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onAddFinance: (payload: Partial<FinanceEntry>) => Promise<void>;
  onOpenAiStudio: (projectId?: string) => void;
}

const STEPS: Array<{ num: ProjectStep; label: string }> = [
  { num: 1, label: '1. Premier contact' },
  { num: 2, label: '2. Brief' },
  { num: 3, label: '3. Devis (30%)' },
  { num: 4, label: '4. Maquette' },
  { num: 5, label: '5. Construction' },
  { num: 6, label: '6. Tests' },
  { num: 7, label: '7. Mise en ligne' },
];

const KANBAN_COLS: TaskColumn[] = ['À faire', 'En cours', 'À valider', 'Terminé'];

const OFFER_DEFAULTS: Record<OfferTier, { price: number; desc: string }> = {
  Départ: { price: 200, desc: '1 page avec contact, horaires, plan (150 à 250 €)' },
  Standard: { price: 380, desc: '3 à 5 pages, formulaire, fiche Google Business (300 à 500 €)' },
  Suivi: { price: 25, desc: 'Modifications de texte et sauvegarde (15 à 30 €/mois)' },
};

const BRIEF_QUESTIONS: Array<{ key: keyof ClientProject['brief']; label: string }> = [
  { key: 'activitySummary', label: '1. Quelle est ton activité en deux phrases ?' },
  { key: 'targetClients', label: '2. Qui sont tes clients ?' },
  { key: 'desiredPages', label: '3. Quelles pages veux-tu ?' },
  { key: 'inspirationSites', label: '4. Quels sites te plaisent ?' },
  { key: 'existingAssets', label: '5. As-tu un logo, des photos, des textes ?' },
  { key: 'hoursAddressPhone', label: '6. Quels sont tes horaires, adresse, téléphone ?' },
  { key: 'primaryVisitorAction', label: '7. Quelle action doit faire le visiteur ?' },
  { key: 'budgetRange', label: '8. Quel est ton budget ?' },
];

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  state,
  selectedProjectId,
  onSelectProjectId,
  openNewProjectNonce = 0,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onAddFinance,
  onOpenAiStudio,
}) => {
  const [subTab, setSubTab] = useState<'pipeline' | 'kanban'>('pipeline');
  const [listFilter, setListFilter] = useState<'all' | 'clients' | 'demos'>('all');

  const selectedProject =
    state.projects.find((p) => p.id === selectedProjectId) || state.projects[0];

  const [draft, setDraft] = useState<ClientProject | null>(
    selectedProject ? normalizeProject(selectedProject) : null
  );
  const [isDirty, setIsDirty] = useState(false);
  const [savingDossier, setSavingDossier] = useState(false);
  const [dossierFeedback, setDossierFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [copiedLegalMode, setCopiedLegalMode] = useState<'' | 'text' | 'html'>('');
  const [showLegalPreview, setShowLegalPreview] = useState(false);

  // Create form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSector, setNewSector] = useState('Commerce local');
  const [newTier, setNewTier] = useState<OfferTier>('Standard');
  const [newPrice, setNewPrice] = useState<number>(OFFER_DEFAULTS.Standard.price);
  const [newIsDemo, setNewIsDemo] = useState(false);
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newLegal, setNewLegal] = useState<ProjectLegalInfo>(() => createDefaultLegalInfo());
  const [showNewLegalSection, setShowNewLegalSection] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Delete confirmation modal
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  // Quick payment inside dossier
  const [payType, setPayType] = useState<'Acompte 30 %' | 'Solde' | 'Suivi mensuel'>('Acompte 30 %');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Project-scoped inline task add
  const [dossierTaskTitle, setDossierTaskTitle] = useState('');
  const [dossierTaskAssignee, setDossierTaskAssignee] = useState(state.members[0]?.id || '');
  const [addingDossierTask, setAddingDossierTask] = useState(false);

  // Kanban global task add
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskProjectId, setNewTaskProjectId] = useState(state.projects[0]?.id || '');
  const [newTaskAssignee, setNewTaskAssignee] = useState(state.members[0]?.id || '');
  const [newTaskDueDate, setNewTaskDueDate] = useState(
    () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  );
  const [addingKanbanTask, setAddingKanbanTask] = useState(false);
  const [kanbanError, setKanbanError] = useState('');

  useEffect(() => {
    if (openNewProjectNonce > 0) {
      setSubTab('pipeline');
      setShowNewForm(true);
    }
  }, [openNewProjectNonce]);

  useEffect(() => {
    if (!selectedProject) {
      setDraft(null);
      setIsDirty(false);
      return;
    }
    if (!draft || draft.id !== selectedProject.id) {
      setDraft(normalizeProject(selectedProject));
      setIsDirty(false);
      setDossierFeedback(null);
      setShowLegalPreview(false);
      setPayAmount(Math.round(selectedProject.totalPriceEur * 0.3));
    } else if (!isDirty && draft.updatedAt !== selectedProject.updatedAt) {
      setDraft(normalizeProject(selectedProject));
    }
  }, [selectedProject, draft, isDirty]);

  useEffect(() => {
    if (state.members.length > 0) {
      if (!dossierTaskAssignee) setDossierTaskAssignee(state.members[0].id);
      if (!newTaskAssignee) setNewTaskAssignee(state.members[0].id);
    }
  }, [state.members, dossierTaskAssignee, newTaskAssignee]);

  useEffect(() => {
    if (state.projects.length > 0 && !state.projects.some((p) => p.id === newTaskProjectId)) {
      setNewTaskProjectId(state.projects[0].id);
    }
  }, [state.projects, newTaskProjectId]);

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const preparedLegal: ProjectLegalInfo = {
        ...newLegal,
        legalCompanyName: newLegal.legalCompanyName.trim() || newName.trim(),
        privacyControllerEmail: newLegal.privacyControllerEmail.trim() || newContactEmail.trim(),
      };
      const created = await onCreateProject({
        clientName: newName.trim(),
        sector: newSector.trim() || 'Commerce local',
        offerTier: newTier,
        totalPriceEur: Number.isFinite(Number(newPrice)) ? Math.max(0, Number(newPrice)) : OFFER_DEFAULTS[newTier].price,
        isDemo: newIsDemo,
        contactEmail: newContactEmail.trim(),
        contactPhone: newContactPhone.trim(),
        legal: preparedLegal,
        step: 1,
      });
      setSubTab('pipeline');
      setListFilter('all');
      onSelectProjectId(created.id);
      setDraft(normalizeProject(created));
      setIsDirty(false);
      setNewName('');
      setNewSector('Commerce local');
      setNewContactEmail('');
      setNewContactPhone('');
      setNewIsDemo(false);
      setNewLegal(createDefaultLegalInfo());
      setShowNewLegalSection(true);
      setShowNewForm(false);
    } catch (err: any) {
      setCreateError(err?.message || 'Impossible de créer le projet.');
    } finally {
      setCreating(false);
    }
  };

  const commitProjectUpdates = async (updates: Partial<ClientProject>, nextDraftState?: ClientProject) => {
    if (!draft) return;
    setSavingDossier(true);
    setDossierFeedback(null);
    try {
      // If there were unsaved local edits in draft, include them cleanly unless superseded
      const payloadToSave: Partial<ClientProject> = nextDraftState
        ? (() => {
            const { id: _id, updatedAt: _u, ...rest } = nextDraftState;
            return rest;
          })()
        : updates;
      const updated = await onUpdateProject(draft.id, payloadToSave);
      setDraft(normalizeProject(updated));
      setIsDirty(false);
      setDossierFeedback({ type: 'ok', text: 'Dossier enregistré.' });
    } catch (err: any) {
      setDossierFeedback({ type: 'err', text: err?.message || 'Erreur lors de la sauvegarde.' });
    } finally {
      setSavingDossier(false);
    }
  };

  const handleSaveFullDossier = async () => {
    if (!draft || savingDossier) return;
    const { id: _id, updatedAt: _u, ...rest } = draft;
    await commitProjectUpdates(rest);
  };

  const handleConfirmDeleteProject = async () => {
    if (!draft || deletingProject) return;
    setDeletingProject(true);
    try {
      await onDeleteProject(draft.id);
      setConfirmDeleteOpen(false);
      setIsDirty(false);
    } catch (err: any) {
      setDossierFeedback({ type: 'err', text: err?.message || 'Suppression impossible.' });
      setConfirmDeleteOpen(false);
    } finally {
      setDeletingProject(false);
    }
  };

  const handleRecordProjectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || recordingPayment || payAmount <= 0) return;
    setRecordingPayment(true);
    setDossierFeedback(null);
    try {
      await onAddFinance({
        projectId: draft.id,
        clientName: draft.clientName,
        label: `${payType} — ${draft.clientName}`,
        amountEur: payAmount,
        type: payType,
        status: 'Payé',
        billingParentOrEntity: state.settings.billingFramework,
        commercialMemberId: draft.commercialMemberId || undefined,
      });

      const updates: Partial<ClientProject> = {};
      if (payType === 'Acompte 30 %') {
        updates.depositPaidEur = (draft.depositPaidEur || 0) + payAmount;
      } else if (payType === 'Solde') {
        updates.balancePaidEur = (draft.balancePaidEur || 0) + payAmount;
      }

      if (Object.keys(updates).length > 0) {
        const updated = await onUpdateProject(draft.id, updates);
        setDraft(updated);
        setIsDirty(false);
      }
      setDossierFeedback({
        type: 'ok',
        text: `${payType} de ${payAmount} € ajouté au journal des ventes.`,
      });
    } catch (err: any) {
      setDossierFeedback({ type: 'err', text: err?.message || 'Erreur lors de l’encaissement.' });
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleAddDossierTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !dossierTaskTitle.trim() || addingDossierTask) return;
    setAddingDossierTask(true);
    try {
      await onCreateTask({
        projectId: draft.id,
        title: dossierTaskTitle.trim(),
        column: 'À faire',
        assigneeMemberId: dossierTaskAssignee || state.members[0]?.id || '',
      });
      setDossierTaskTitle('');
    } catch (err: any) {
      setDossierFeedback({ type: 'err', text: err?.message || 'Impossible d’ajouter la tâche.' });
    } finally {
      setAddingDossierTask(false);
    }
  };

  const handleAddKanbanTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || addingKanbanTask) return;
    setAddingKanbanTask(true);
    setKanbanError('');
    try {
      await onCreateTask({
        projectId: newTaskProjectId || selectedProject?.id || state.projects[0]?.id || '',
        title: newTaskTitle.trim(),
        column: 'À faire',
        assigneeMemberId: newTaskAssignee || state.members[0]?.id || '',
        dueDate: newTaskDueDate || undefined,
      });
      setNewTaskTitle('');
    } catch (err: any) {
      setKanbanError(err?.message || 'Impossible de créer la tâche.');
    } finally {
      setAddingKanbanTask(false);
    }
  };

  const handleDownloadProjectHtml = () => {
    if (!draft?.generatedHtml) return;
    const blob = new Blob([draft.generatedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draft.clientName || 'site-client').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyLegalBlock = async (mode: 'text' | 'html') => {
    if (!draft) return;
    const content =
      mode === 'html' ? generateLegalNoticeHtml(draft) : generateLegalNoticeText(draft);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedLegalMode(mode);
      setTimeout(() => setCopiedLegalMode(''), 2000);
    } catch {
      setDossierFeedback({
        type: 'err',
        text: 'Copie automatique bloquée par le navigateur. Ouvrez l’aperçu pour copier.',
      });
      setShowLegalPreview(true);
    }
  };

  const normalizeExternalUrl = (url?: string) => {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const updateDraftField = <K extends keyof ClientProject>(key: K, value: ClientProject[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setIsDirty(true);
    setDossierFeedback(null);
  };

  const filteredProjects = state.projects.filter((p) => {
    if (listFilter === 'clients') return !p.isDemo;
    if (listFilter === 'demos') return p.isDemo;
    return true;
  });

  const dossierTasks = draft ? state.tasks.filter((t) => t.projectId === draft.id) : [];
  const totalPaidForProject = draft ? (draft.depositPaidEur || 0) + (draft.balancePaidEur || 0) : 0;
  const remainingToPay = draft ? Math.max(0, (draft.totalPriceEur || 0) - totalPaidForProject) : 0;
  const newLegalReport = evaluateProjectLegalCompliance({
    clientName: newName,
    isDemo: newIsDemo,
    contactEmail: newContactEmail,
    contactPhone: newContactPhone,
    legal: newLegal,
  });

  return (
    <div className="space-y-6">
      <ConfirmModal
        open={confirmDeleteOpen}
        title="Supprimer ce dossier projet ?"
        description={`Le dossier "${draft?.clientName || ''}" ainsi que ses tâches associées seront définitivement supprimés.`}
        confirmLabel="Supprimer le projet"
        loading={deletingProject}
        onConfirm={handleConfirmDeleteProject}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setSubTab('pipeline')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'pipeline' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Pipeline Projets ({state.projects.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('kanban')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'kanban' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Tableau des Tâches ({state.tasks.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateError('');
            setShowNewForm((prev) => !prev);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{showNewForm ? 'Fermer le formulaire' : 'Nouveau projet'}</span>
        </button>
      </div>

      {showNewForm && (
        <form
          onSubmit={handleAddProject}
          className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">Créer un dossier projet</h2>
            <span className="text-[11px] text-slate-500">Durée cible : 7 à 10 jours</span>
          </div>

          {createError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 items-end">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nom du client ou de la démo *
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex : Boulangerie du Centre"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Secteur</label>
              <input
                type="text"
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
                placeholder="Ex : Restauration, Sport..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Formule</label>
              <select
                value={newTier}
                onChange={(e) => {
                  const tier = e.target.value as OfferTier;
                  setNewTier(tier);
                  setNewPrice(OFFER_DEFAULTS[tier].price);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="Départ">Départ (150–250 €)</option>
                <option value="Standard">Standard (300–500 €)</option>
                <option value="Suivi">Suivi (15–30 €/mois)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Prix devis (€)</label>
              <input
                type="number"
                min={0}
                value={newPrice}
                onChange={(e) => setNewPrice(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono tabular-nums text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">E-mail client</label>
              <input
                type="email"
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                placeholder="contact@client.fr"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsDemo}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setNewIsDemo(checked);
                    if (checked) {
                      setNewPrice(0);
                      setShowNewLegalSection(false);
                    } else {
                      setNewPrice(OFFER_DEFAULTS[newTier].price);
                      setShowNewLegalSection(true);
                    }
                  }}
                />
                <span>Site démo portfolio (gratuit)</span>
              </label>

              <input
                type="tel"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                placeholder="Téléphone du patron (obligatoire LCEN)"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {creating ? 'Création...' : 'Créer le projet'}
              </button>
            </div>
          </div>

          {/* Section Questionnaire Patron & Conformité Loi Française */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowNewLegalSection((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-100/70 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Scale className="h-4 w-4 text-blue-600 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">
                    Questionnaire Patron : Mentions légales, SIREN & Conformité loi française
                  </div>
                  <div className="text-[11px] text-slate-500">
                    À poser au client pour que son site respecte la loi (LCEN, RGPD, Code de la consommation) — modifiable aussi après création.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[11px] font-semibold font-mono tabular-nums ${
                    newLegalReport.isFullyCompliant ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {newLegalReport.score}/{newLegalReport.total} prêts
                </span>
                {showNewLegalSection ? (
                  <ChevronUp className="h-4 w-4 text-slate-500" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                )}
              </div>
            </button>

            {showNewLegalSection && (
              <div className="border-t border-slate-200 bg-white p-4">
                <LegalQuestionnaireForm
                  clientName={newName}
                  isDemo={newIsDemo}
                  contactEmail={newContactEmail}
                  contactPhone={newContactPhone}
                  legal={newLegal}
                  onChange={setNewLegal}
                  compact
                />
              </div>
            )}
          </div>
        </form>
      )}

      {subTab === 'pipeline' ? (
        state.projects.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white py-16 px-6 text-center flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 mb-4">
              <FolderKanban className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Aucun projet enregistré</h2>
            <p className="mt-1.5 max-w-md text-xs text-slate-500 leading-relaxed">
              Créez un premier site démo pour votre portfolio ou ajoutez un vrai projet client pour suivre les 7 étapes, le brief en 8 questions et les points de contrôle.
            </p>
            <button
              type="button"
              onClick={() => setShowNewForm(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Ajouter un premier projet</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {/* Left Project Selector List */}
            <div className="rounded-xl border border-slate-200/90 bg-white h-fit overflow-hidden">
              <div className="flex items-center gap-1 border-b border-slate-100 bg-slate-50/70 p-2">
                {[
                  { id: 'all' as const, label: `Tous (${state.projects.length})` },
                  { id: 'clients' as const, label: `Clients (${state.projects.filter((p) => !p.isDemo).length})` },
                  { id: 'demos' as const, label: `Démos (${state.projects.filter((p) => p.isDemo).length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setListFilter(f.id)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium whitespace-nowrap ${
                      listFilter === f.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="divide-y divide-slate-100">
                {filteredProjects.length === 0 ? (
                  <p className="p-5 text-center text-xs text-slate-500">
                    Aucun dossier dans cette catégorie.
                  </p>
                ) : (
                  filteredProjects.map((proj) => {
                    const active = proj.id === draft?.id;
                    const projLegal = evaluateProjectLegalCompliance(proj);
                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => onSelectProjectId(proj.id)}
                        className={`flex w-full items-center justify-between gap-3 p-4 text-left transition-colors ${
                          active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {proj.clientName}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                            Étape {proj.step}/7 · {proj.offerTier} · {proj.totalPriceEur} €
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                            {proj.isDemo ? 'Démo' : 'Client'} · {proj.sector} · Loi {projLegal.score}/{projLegal.total}
                            {proj.generatedHtml ? ' · Site IA prêt' : ''}
                          </div>
                        </div>
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-300'}`}
                        />
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Full Project Dossier */}
            {draft && (
              <div className="xl:col-span-2 space-y-6">
                {/* Dossier Header & Pipeline & Core Details */}
                <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="flex-1 min-w-[220px] space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={draft.isDemo ? 'demo' : 'client'}
                          onChange={(e) => {
                            const isDemo = e.target.value === 'demo';
                            const nextDraft = { ...draft, isDemo };
                            setDraft(nextDraft);
                            commitProjectUpdates({ isDemo }, nextDraft);
                          }}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700"
                        >
                          <option value="client">Projet Client</option>
                          <option value="demo">Site Démo Portfolio</option>
                        </select>
                        <input
                          type="text"
                          value={draft.sector}
                          onChange={(e) => updateDraftField('sector', e.target.value)}
                          onBlur={() => isDirty && handleSaveFullDossier()}
                          placeholder="Secteur d’activité"
                          className="rounded-md border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-[11px] text-slate-700 focus:bg-white focus:border-blue-500 focus:outline-none"
                        />
                        <span className="text-[11px] text-slate-400">
                          {savingDossier
                            ? 'Enregistrement...'
                            : isDirty
                              ? 'Modifications non enregistrées'
                              : 'Enregistré'}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={draft.clientName}
                        onChange={(e) => updateDraftField('clientName', e.target.value)}
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        className="w-full rounded-lg border border-transparent px-1 py-0.5 text-lg font-bold text-slate-900 hover:border-slate-200 focus:border-blue-500 focus:bg-slate-50/50 focus:outline-none"
                        aria-label="Nom du client"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveFullDossier}
                        disabled={savingDossier || !isDirty}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {isDirty ? <Save className="h-3.5 w-3.5 text-blue-600" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                        <span>{savingDossier ? 'Sauvegarde...' : isDirty ? 'Enregistrer le dossier' : 'À jour'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenAiStudio(draft.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{draft.generatedHtml ? 'Modifier dans Studio IA' : 'Construire dans Studio IA'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOpen(true)}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        title="Supprimer ce projet"
                        aria-label="Supprimer ce projet"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {dossierFeedback && (
                    <div
                      className={`rounded-lg border px-3.5 py-2 text-xs font-medium ${
                        dossierFeedback.type === 'ok'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-red-200 bg-red-50 text-red-700'
                      }`}
                    >
                      {dossierFeedback.text}
                    </div>
                  )}

                  {/* 7 Steps */}
                  <div>
                    <div className="text-xs font-medium text-slate-700 mb-2">
                      Avancement du projet (durée cible : 7 à 10 jours)
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
                      {STEPS.map((st) => {
                        const active = draft.step === st.num;
                        const done = draft.step > st.num;
                        return (
                          <button
                            key={st.num}
                            type="button"
                            onClick={() => {
                              const nextDraft = { ...draft, step: st.num };
                              setDraft(nextDraft);
                              commitProjectUpdates({ step: st.num }, nextDraft);
                            }}
                            className={`rounded-lg border px-2 py-2 text-left text-[11px] font-medium transition-colors ${
                              active
                                ? 'border-blue-600 bg-blue-50 text-blue-800'
                                : done
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {st.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Offer, Pricing, Team Ownership & Date */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 border-t border-slate-100 pt-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Formule choisie
                      </label>
                      <select
                        value={draft.offerTier}
                        onChange={(e) => {
                          const tier = e.target.value as OfferTier;
                          const nextPrice = draft.isDemo ? 0 : OFFER_DEFAULTS[tier].price;
                          const nextDraft = { ...draft, offerTier: tier, totalPriceEur: nextPrice };
                          setDraft(nextDraft);
                          commitProjectUpdates(
                            { offerTier: tier, totalPriceEur: nextPrice },
                            nextDraft
                          );
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <option value="Départ">Départ (150–250 €)</option>
                        <option value="Standard">Standard (300–500 €)</option>
                        <option value="Suivi">Suivi (15–30 €/mois)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Prix total devis (€)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={draft.totalPriceEur}
                        onChange={(e) =>
                          updateDraftField('totalPriceEur', Math.max(0, Number(e.target.value) || 0))
                        }
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Livraison prévue
                      </label>
                      <input
                        type="date"
                        value={draft.deliveryTargetDate}
                        onChange={(e) => {
                          const deliveryTargetDate = e.target.value;
                          const nextDraft = { ...draft, deliveryTargetDate };
                          setDraft(nextDraft);
                          commitProjectUpdates({ deliveryTargetDate }, nextDraft);
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Chef de projet responsable
                      </label>
                      <select
                        value={draft.ownerMemberId}
                        onChange={(e) => {
                          const ownerMemberId = e.target.value;
                          const nextDraft = { ...draft, ownerMemberId };
                          setDraft(nextDraft);
                          commitProjectUpdates({ ownerMemberId }, nextDraft);
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <option value="">À assigner</option>
                        {state.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Commercial (prime 10 %)
                      </label>
                      <select
                        value={draft.commercialMemberId}
                        onChange={(e) => {
                          const commercialMemberId = e.target.value;
                          const nextDraft = { ...draft, commercialMemberId };
                          setDraft(nextDraft);
                          commitProjectUpdates({ commercialMemberId }, nextDraft);
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <option value="">Aucun commercial</option>
                        {state.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Retours clients inclus
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={draft.revisionsIncluded}
                        onChange={(e) =>
                          updateDraftField(
                            'revisionsIncluded',
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        }
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  {/* Payments Tracking & Quick Finance Entry */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                        <Wallet className="h-3.5 w-3.5 text-blue-600" />
                        <span>Suivi des paiements du projet</span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-600">
                        Acompte 30 % conseillé : {Math.round(draft.totalPriceEur * 0.3)} € · Encaissé :{' '}
                        {totalPaidForProject} € · Reste dû : {remainingToPay} €
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Acompte encaissé (€)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={draft.depositPaidEur}
                          onChange={(e) =>
                            updateDraftField(
                              'depositPaidEur',
                              Math.max(0, Number(e.target.value) || 0)
                            )
                          }
                          onBlur={() => isDirty && handleSaveFullDossier()}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Solde encaissé (€)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={draft.balancePaidEur}
                          onChange={(e) =>
                            updateDraftField(
                              'balancePaidEur',
                              Math.max(0, Number(e.target.value) || 0)
                            )
                          }
                          onBlur={() => isDirty && handleSaveFullDossier()}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    <form
                      onSubmit={handleRecordProjectPayment}
                      className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3"
                    >
                      <span className="text-[11px] font-medium text-slate-700">
                        Ajouter en caisse :
                      </span>
                      <select
                        value={payType}
                        onChange={(e) => {
                          const t = e.target.value as 'Acompte 30 %' | 'Solde' | 'Suivi mensuel';
                          setPayType(t);
                          if (t === 'Acompte 30 %') {
                            setPayAmount(Math.round(draft.totalPriceEur * 0.3));
                          } else if (t === 'Solde') {
                            setPayAmount(remainingToPay > 0 ? remainingToPay : draft.totalPriceEur);
                          } else {
                            setPayAmount(25);
                          }
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="Acompte 30 %">Acompte 30 %</option>
                        <option value="Solde">Solde</option>
                        <option value="Suivi mensuel">Suivi mensuel</option>
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={payAmount}
                        onChange={(e) => setPayAmount(Math.max(0, Number(e.target.value) || 0))}
                        className="w-24 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums"
                      />
                      <button
                        type="submit"
                        disabled={recordingPayment || payAmount <= 0}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {recordingPayment ? 'Enregistrement...' : 'Encaisser & journaliser'}
                      </button>
                    </form>
                  </div>

                  {/* Contact Info & Notes */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-slate-100 pt-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        E-mail du client
                      </label>
                      <input
                        type="email"
                        value={draft.contactEmail}
                        onChange={(e) => updateDraftField('contactEmail', e.target.value)}
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        placeholder="client@commerce.fr"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Téléphone du client
                      </label>
                      <input
                        type="tel"
                        value={draft.contactPhone}
                        onChange={(e) => updateDraftField('contactPhone', e.target.value)}
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        placeholder="06 00 00 00 00"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Notes de suivi d’équipe
                      </label>
                      <textarea
                        rows={2}
                        value={draft.notes}
                        onChange={(e) => updateDraftField('notes', e.target.value)}
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        placeholder="Détails sur les rendez-vous, demandes spécifiques, validation parentale..."
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  {/* Quality Checks + Post Delivery */}
                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    <div className="text-xs font-semibold text-slate-900">
                      Points à vérifier avant mise en ligne (Qualité, Loi & SEO local)
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {[
                        { key: 'aiCopyReviewed', label: 'Textes relus (horaires, prix, adresse NAP)' },
                        { key: 'mobileTested', label: 'Site testé sur téléphone (zéro coupure)' },
                        { key: 'imageRightsVerified', label: 'Droits de chaque image et logo vérifiés' },
                        { key: 'legalMentionsAdded', label: 'Mentions légales LCEN complètes ajoutées' },
                        { key: 'privacyPolicyAdded', label: 'Politique de confidentialité RGPD ajoutée' },
                        { key: 'cookieComplianceChecked', label: 'Analytics sans cookies ou bandeau CNIL ok' },
                        { key: 'mediatorAddedIfB2C', label: 'Médiateur conso B2C indiqué (si particuliers)' },
                        { key: 'seoLocalMetaReady', label: 'SEO local prêt (<title>, meta, H1, JSON-LD)' },
                      ].map((chk) => {
                        const checked = Boolean(
                          draft.qualityChecks[chk.key as keyof typeof draft.qualityChecks]
                        );
                        return (
                          <button
                            key={chk.key}
                            type="button"
                            onClick={() => {
                              const nextChecks = {
                                ...draft.qualityChecks,
                                [chk.key]: !checked,
                              };
                              const nextDraft = { ...draft, qualityChecks: nextChecks };
                              setDraft(nextDraft);
                              commitProjectUpdates({ qualityChecks: nextChecks }, nextDraft);
                            }}
                            className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50"
                          >
                            {checked ? (
                              <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-400 shrink-0" />
                            )}
                            <span className={checked ? 'text-slate-800 font-medium' : 'text-slate-600'}>
                              {chk.label}
                            </span>
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => {
                          const followUp30Done = !draft.followUp30Done;
                          const nextDraft = { ...draft, followUp30Done };
                          setDraft(nextDraft);
                          commitProjectUpdates({ followUp30Done }, nextDraft);
                        }}
                        className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50"
                      >
                        {draft.followUp30Done ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-400 shrink-0" />
                        )}
                        <span className={draft.followUp30Done ? 'text-slate-800 font-medium' : 'text-slate-600'}>
                          Suivi client à J+30 effectué
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const googleReviewRequested = !draft.googleReviewRequested;
                          const nextDraft = { ...draft, googleReviewRequested };
                          setDraft(nextDraft);
                          commitProjectUpdates({ googleReviewRequested }, nextDraft);
                        }}
                        className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50"
                      >
                        {draft.googleReviewRequested ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-400 shrink-0" />
                        )}
                        <span className={draft.googleReviewRequested ? 'text-slate-800 font-medium' : 'text-slate-600'}>
                          Avis Google demandé au client
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Questionnaire Patron, Conformité Loi & Générateur Mentions Légales */}
                <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Questionnaire Patron & Mentions légales (Conformité loi française)
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyLegalBlock('text')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        {copiedLegalMode === 'text' ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedLegalMode === 'text' ? 'Copié !' : 'Copier mentions (texte)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyLegalBlock('html')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        {copiedLegalMode === 'html' ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedLegalMode === 'html' ? 'Copié !' : 'Copier bloc HTML'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowLegalPreview((prev) => !prev)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                      >
                        {showLegalPreview ? 'Masquer aperçu' : 'Aperçu mentions'}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveFullDossier}
                        disabled={savingDossier || !isDirty}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        Enregistrer infos légales
                      </button>
                    </div>
                  </div>

                  {showLegalPreview && (
                    <div className="rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>Texte prêt à insérer sur le site du client</span>
                        <span>Inclus automatiquement lors de la génération Studio IA</span>
                      </div>
                      <pre className="whitespace-pre-wrap font-sans leading-relaxed text-slate-200 max-h-72 overflow-y-auto">
                        {generateLegalNoticeText(draft)}
                      </pre>
                    </div>
                  )}

                  <LegalQuestionnaireForm
                    clientName={draft.clientName}
                    isDemo={draft.isDemo}
                    contactEmail={draft.contactEmail}
                    contactPhone={draft.contactPhone}
                    legal={draft.legal}
                    onChange={(nextLegal) => updateDraftField('legal', nextLegal)}
                    onBlurSave={() => isDirty && handleSaveFullDossier()}
                  />
                </div>

                {/* Brief 8 Questions */}
                <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Questionnaire de brief client (les 8 questions du guide)
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveFullDossier}
                      disabled={savingDossier || !isDirty}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                    >
                      Enregistrer le brief
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {BRIEF_QUESTIONS.map((field) => (
                      <div key={field.key}>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {field.label}
                        </label>
                        <textarea
                          rows={2}
                          value={draft.brief[field.key]}
                          onChange={(e) => {
                            const nextBrief = { ...draft.brief, [field.key]: e.target.value };
                            updateDraftField('brief', nextBrief);
                          }}
                          onBlur={() => isDirty && handleSaveFullDossier()}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Links, Integrations & Generated Site */}
                <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Hébergement, liens & site généré
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.generatedHtml && (
                        <button
                          type="button"
                          onClick={handleDownloadProjectHtml}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Télécharger index.html</span>
                        </button>
                      )}
                      {draft.integrations.netlifyUrl && (
                        <a
                          href={normalizeExternalUrl(draft.integrations.netlifyUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap shrink-0"
                        >
                          <span>Voir le site en ligne</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        URL du site en ligne (Netlify / GitHub Pages / Render)
                      </label>
                      <input
                        type="url"
                        value={draft.integrations.netlifyUrl || ''}
                        onChange={(e) =>
                          updateDraftField('integrations', {
                            ...draft.integrations,
                            netlifyUrl: e.target.value,
                          })
                        }
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        placeholder="https://mon-client.netlify.app"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Dépôt GitHub (ex : equipe/site-boulangerie)
                      </label>
                      <input
                        type="text"
                        value={draft.integrations.githubRepo || ''}
                        onChange={(e) =>
                          updateDraftField('integrations', {
                            ...draft.integrations,
                            githubRepo: e.target.value,
                          })
                        }
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        placeholder="utilisateur/nom-du-depot"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Maquette Figma (URL ou clé)
                      </label>
                      <input
                        type="text"
                        value={draft.integrations.figmaFileKey || ''}
                        onChange={(e) =>
                          updateDraftField('integrations', {
                            ...draft.integrations,
                            figmaFileKey: e.target.value,
                          })
                        }
                        onBlur={() => isDirty && handleSaveFullDossier()}
                        placeholder="https://www.figma.com/design/..."
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Dossier Google Drive / Salon Discord
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={draft.integrations.driveFolderId || ''}
                          onChange={(e) =>
                            updateDraftField('integrations', {
                              ...draft.integrations,
                              driveFolderId: e.target.value,
                            })
                          }
                          onBlur={() => isDirty && handleSaveFullDossier()}
                          placeholder="ID / lien Drive"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
                        />
                        <input
                          type="text"
                          value={draft.integrations.discordChannelName || ''}
                          onChange={(e) =>
                            updateDraftField('integrations', {
                              ...draft.integrations,
                              discordChannelName: e.target.value,
                            })
                          }
                          onBlur={() => isDirty && handleSaveFullDossier()}
                          placeholder="#salon-projet"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const nextIntegrations = {
                          ...draft.integrations,
                          googleBusinessReady: !draft.integrations.googleBusinessReady,
                        };
                        const nextDraft = { ...draft, integrations: nextIntegrations };
                        setDraft(nextDraft);
                        commitProjectUpdates({ integrations: nextIntegrations }, nextDraft);
                      }}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
                    >
                      {draft.integrations.googleBusinessReady ? (
                        <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-slate-400 shrink-0" />
                      )}
                      <span>Fiche Google Business prête / vérifiée</span>
                    </button>

                    <span className="text-xs text-slate-500">
                      {draft.generatedHtml
                        ? `Code HTML généré (${Math.round(draft.generatedHtml.length / 1024)} Ko)`
                        : 'Aucun code HTML enregistré — générez-le dans Studio IA'}
                    </span>
                  </div>
                </div>

                {/* Project-scoped Tasks */}
                <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Tâches de ce dossier ({dossierTasks.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setNewTaskProjectId(draft.id);
                        setSubTab('kanban');
                      }}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Voir tout le tableau Kanban
                    </button>
                  </div>

                  <form onSubmit={handleAddDossierTask} className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={dossierTaskTitle}
                      onChange={(e) => setDossierTaskTitle(e.target.value)}
                      placeholder={`Nouvelle tâche pour ${draft.clientName}...`}
                      className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    />
                    {state.members.length > 0 && (
                      <select
                        value={dossierTaskAssignee}
                        onChange={(e) => setDossierTaskAssignee(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                      >
                        {state.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="submit"
                      disabled={addingDossierTask || !dossierTaskTitle.trim()}
                      className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {addingDossierTask ? 'Ajout...' : 'Ajouter'}
                    </button>
                  </form>

                  {dossierTasks.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">
                      Aucune tâche rattachée à ce projet pour le moment.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {dossierTasks.map((task) => {
                        const assignee = state.members.find((m) => m.id === task.assigneeMemberId);
                        return (
                          <div
                            key={task.id}
                            className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">{task.title}</div>
                              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {assignee?.name || 'Équipe'} · Échéance {task.dueDate}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={task.column}
                                onChange={(e) =>
                                  onUpdateTask(task.id, { column: e.target.value as TaskColumn })
                                }
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                              >
                                {KANBAN_COLS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => onDeleteTask(task.id)}
                                className="p-1 text-slate-400 hover:text-red-600"
                                title="Supprimer la tâche"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        /* Kanban Tab */
        <div className="space-y-5">
          {kanbanError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-700">
              {kanbanError}
            </div>
          )}

          <form
            onSubmit={handleAddKanbanTask}
            className="rounded-xl border border-slate-200/90 bg-white p-4 flex flex-col gap-3 lg:flex-row lg:items-center"
          >
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Nouvelle tâche (ex : Préparer les 3 sites démo pour le portfolio)..."
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {state.projects.length > 0 && (
              <select
                value={newTaskProjectId}
                onChange={(e) => setNewTaskProjectId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName}
                  </option>
                ))}
              </select>
            )}
            {state.members.length > 0 && (
              <select
                value={newTaskAssignee}
                onChange={(e) => setNewTaskAssignee(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {state.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            )}
            <input
              type="date"
              value={newTaskDueDate}
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-mono"
            />
            <button
              type="submit"
              disabled={addingKanbanTask || !newTaskTitle.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {addingKanbanTask ? 'Ajout...' : 'Ajouter au tableau'}
            </button>
          </form>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {KANBAN_COLS.map((col) => {
              const colTasks = state.tasks.filter((t) => t.column === col);
              return (
                <div
                  key={col}
                  className="rounded-xl border border-slate-200/90 bg-white p-4 space-y-3 min-h-[220px]"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h3 className="text-sm font-semibold text-slate-900">{col}</h3>
                    <span className="font-mono tabular-nums text-xs text-slate-500">
                      {colTasks.length}
                    </span>
                  </div>

                  {colTasks.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">Aucune carte</p>
                  ) : (
                    <div className="space-y-3">
                      {colTasks.map((task) => {
                        const assignee = state.members.find((m) => m.id === task.assigneeMemberId);
                        const proj = state.projects.find((p) => p.id === task.projectId);
                        return (
                          <div
                            key={task.id}
                            className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2"
                          >
                            <div className="text-xs font-medium text-slate-900">{task.title}</div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {assignee?.name || 'Équipe'} · Échéance {task.dueDate}
                            </div>
                            {proj && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectProjectId(proj.id);
                                  setSubTab('pipeline');
                                }}
                                className="text-[11px] text-blue-700 hover:underline truncate block text-left"
                              >
                                {proj.clientName}
                              </button>
                            )}
                            <div className="flex items-center justify-between pt-1">
                              <select
                                value={task.column}
                                onChange={(e) =>
                                  onUpdateTask(task.id, { column: e.target.value as TaskColumn })
                                }
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                              >
                                {KANBAN_COLS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => onDeleteTask(task.id)}
                                className="text-slate-400 hover:text-red-600 p-1"
                                title="Supprimer la tâche"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
