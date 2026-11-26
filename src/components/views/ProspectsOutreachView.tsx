import React, { useEffect, useState } from 'react';
import {
  Mail,
  Send,
  Sparkles,
  Plus,
  Trash2,
  ClipboardList,
  RefreshCw,
  Target,
  FolderPlus,
} from 'lucide-react';
import type { AgencyState, Prospect } from '../../types';
import {
  fetchGoogleFormWithResponses,
  listRecentGmailMessages,
  sendGmailMessage,
  type GmailMessageSummary,
  type GoogleFormSummary,
} from '../../lib/googleWorkspace';
import { ConfirmModal } from '../ConfirmModal';
import { GoogleSignInButton } from '../GoogleSignInButton';

interface ProspectsOutreachViewProps {
  state: AgencyState;
  workspaceToken: string | null;
  onSignInGoogle: () => void;
  onCreateProspect: (payload: Partial<Prospect>) => Promise<void>;
  onUpdateProspect: (id: string, updates: Partial<Prospect>) => Promise<void>;
  onDeleteProspect: (id: string) => Promise<void>;
  onSaveDefaultFormId: (formId: string) => Promise<void>;
  onConvertToProject: (prospect: Prospect) => Promise<void>;
}

const DEFAULT_TEMPLATE = `Bonjour, nous sommes une équipe de lycéens de la ville. Nous construisons des sites web pour les commerces et les associations. Nous avons remarqué que votre activité n'a pas de site. Voici un exemple de notre travail : [lien de votre démo]. Pouvez-vous nous accorder 15 minutes cette semaine ? Nous vous montrons une maquette gratuite.`;

export const ProspectsOutreachView: React.FC<ProspectsOutreachViewProps> = ({
  state,
  workspaceToken,
  onSignInGoogle,
  onCreateProspect,
  onUpdateProspect,
  onDeleteProspect,
  onSaveDefaultFormId,
  onConvertToProject,
}) => {
  const [subTab, setSubTab] = useState<'prospects' | 'gmail' | 'forms'>('prospects');

  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState<Prospect['category']>('Commerce');
  const [currentSiteStatus, setCurrentSiteStatus] =
    useState<Prospect['currentSiteStatus']>('Aucun site');
  const [cityArea, setCityArea] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addingProspect, setAddingProspect] = useState(false);
  const [prospectError, setProspectError] = useState('');
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const [gmailTo, setGmailTo] = useState('');
  const [gmailSubject, setGmailSubject] = useState('Proposition de maquette gratuite — Omnix');
  const [gmailBody, setGmailBody] = useState(DEFAULT_TEMPLATE);
  const [gmailInbox, setGmailInbox] = useState<GmailMessageSummary[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [draftingAi, setDraftingAi] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [mailStatus, setMailStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [formIdInput, setFormIdInput] = useState(state.settings.defaultGoogleFormId || '');
  const [formSummary, setFormSummary] = useState<GoogleFormSummary | null>(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [formError, setFormError] = useState('');

  const loadInbox = async () => {
    if (!workspaceToken) return;
    setLoadingInbox(true);
    try {
      const msgs = await listRecentGmailMessages(workspaceToken);
      setGmailInbox(msgs);
    } catch (err: any) {
      setMailStatus({ type: 'err', text: err.message });
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    if (workspaceToken && subTab === 'gmail') {
      loadInbox();
    }
  }, [workspaceToken, subTab]);

  useEffect(() => {
    if (state.settings.defaultGoogleFormId && !formIdInput) {
      setFormIdInput(state.settings.defaultGoogleFormId);
    }
  }, [state.settings.defaultGoogleFormId]);

  const handleAddProspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim() || addingProspect) return;
    setAddingProspect(true);
    setProspectError('');
    try {
      await onCreateProspect({
        businessName: businessName.trim(),
        category,
        currentSiteStatus,
        cityArea: cityArea.trim() || state.settings.city || 'Ville',
        contactEmail: contactEmail.trim(),
        phone: phone.trim(),
      });
      setBusinessName('');
      setCityArea('');
      setContactEmail('');
      setPhone('');
    } catch (err: any) {
      setProspectError(err?.message || 'Impossible d’ajouter le prospect.');
    } finally {
      setAddingProspect(false);
    }
  };

  const handlePrepareEmailForProspect = (p: Prospect) => {
    const demoUrl =
      state.projects.find((proj) => proj.isDemo && proj.integrations?.netlifyUrl)?.integrations
        ?.netlifyUrl || '';
    setGmailTo(p.contactEmail || '');
    setGmailSubject(`Maquette de site web pour ${p.businessName}`);
    setGmailBody(
      demoUrl
        ? DEFAULT_TEMPLATE.replace('[lien de votre démo]', demoUrl)
        : DEFAULT_TEMPLATE
    );
    setMailStatus(null);
    setSubTab('gmail');
  };

  const handleDraftWithAi = async (goal: string) => {
    setDraftingAi(true);
    setMailStatus(null);
    try {
      const res = await fetch('/api/ai/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectName: gmailTo || 'Commerce local',
          channel: 'E-mail',
          goal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur IA');
      setGmailBody(data.message);
    } catch (err: any) {
      setMailStatus({ type: 'err', text: err.message });
    } finally {
      setDraftingAi(false);
    }
  };

  const executeSendEmail = async () => {
    if (!workspaceToken) return;
    setSendingEmail(true);
    setMailStatus(null);
    try {
      await sendGmailMessage(workspaceToken, {
        to: gmailTo.trim(),
        subject: gmailSubject.trim(),
        body: gmailBody,
      });
      setMailStatus({ type: 'ok', text: `E-mail envoyé à ${gmailTo} via Gmail.` });
      await loadInbox();
    } catch (err: any) {
      setMailStatus({ type: 'err', text: err.message });
    } finally {
      setSendingEmail(false);
      setConfirmSendOpen(false);
    }
  };

  const handleLoadGoogleForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceToken || !formIdInput.trim()) return;
    setLoadingForm(true);
    setFormError('');
    try {
      const summary = await fetchGoogleFormWithResponses(workspaceToken, formIdInput.trim());
      setFormSummary(summary);
      await onSaveDefaultFormId(formIdInput.trim());
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setLoadingForm(false);
    }
  };

  return (
    <div className="space-y-6">
      <ConfirmModal
        open={confirmSendOpen}
        title="Envoyer cet e-mail via Gmail ?"
        description={`Destinataire : ${gmailTo}\nObjet : ${gmailSubject}`}
        confirmLabel="Envoyer l’e-mail"
        loading={sendingEmail}
        onConfirm={executeSendEmail}
        onCancel={() => setConfirmSendOpen(false)}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setSubTab('prospects')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'prospects' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Carnet Prospects ({state.prospects.length}/30)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('gmail')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'gmail' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Gmail intégré
          </button>
          <button
            type="button"
            onClick={() => setSubTab('forms')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'forms' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Réponses Google Forms
          </button>
        </div>
      </div>

      {subTab === 'prospects' && (
        <div className="space-y-6">
          <form
            onSubmit={handleAddProspect}
            className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-3"
          >
            {prospectError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {prospectError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7 items-end">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Commerce / Club *</label>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Ex : Boulangerie, Club de foot..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Catégorie</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Prospect['category'])}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                >
                  <option value="Commerce">Commerce</option>
                  <option value="Club / Association">Club / Association</option>
                  <option value="Artisan / Indépendant">Artisan / Indépendant</option>
                  <option value="Entourage">Entourage</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Site actuel</label>
                <select
                  value={currentSiteStatus}
                  onChange={(e) =>
                    setCurrentSiteStatus(e.target.value as Prospect['currentSiteStatus'])
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
                >
                  <option value="Aucun site">Aucun site</option>
                  <option value="Site ancien / non mobile">Site ancien / non mobile</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Quartier</label>
                <input
                  type="text"
                  value={cityArea}
                  onChange={(e) => setCityArea(e.target.value)}
                  placeholder="Centre-ville"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">E-mail & Téléphone</label>
                <div className="space-y-1.5">
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="contact@..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="06..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={addingProspect || !businessName.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{addingProspect ? 'Ajout...' : 'Ajouter'}</span>
              </button>
            </div>
          </form>

          {state.prospects.length === 0 ? (
            <div className="rounded-2xl border border-slate-200/90 bg-white py-14 px-6 text-center flex flex-col items-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 mb-3">
                <Target className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Aucun prospect pour l’instant</h3>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                Repérez 30 commerces, artisans ou associations sans site web dans votre ville et ajoutez-les ci-dessus pour suivre vos contacts et relances à J+5.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200/90 bg-white overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Prospect</th>
                    <th className="px-4 py-3 font-semibold">Catégorie & Quartier</th>
                    <th className="px-4 py-3 font-semibold">Contact</th>
                    <th className="px-4 py-3 font-semibold">Statut (Relance J+5)</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.prospects.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{p.businessName}</div>
                        <div className="text-slate-500 mt-0.5">{p.currentSiteStatus}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.category} · {p.cityArea}
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono tabular-nums">
                        <div>{p.contactEmail || '—'}</div>
                        <div className="text-slate-400">{p.phone || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={p.status}
                          onChange={(e) =>
                            onUpdateProspect(p.id, { status: e.target.value as Prospect['status'] })
                          }
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                        >
                          <option value="À contacter">À contacter</option>
                          <option value="Premier message envoyé">Premier message envoyé</option>
                          <option value="Relance J+5 à faire">Relance J+5 à faire</option>
                          <option value="RDV fixé">RDV fixé</option>
                          <option value="Devis envoyé">Devis envoyé</option>
                          <option value="Gagné">Gagné</option>
                          <option value="Perdu">Perdu</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={convertingId === p.id}
                            onClick={async () => {
                              setConvertingId(p.id);
                              try {
                                await onConvertToProject(p);
                              } catch (err: any) {
                                setProspectError(err?.message || 'Conversion en projet impossible.');
                              } finally {
                                setConvertingId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                            title="Créer un dossier projet depuis ce prospect"
                          >
                            <FolderPlus className="h-3 w-3" />
                            <span>{convertingId === p.id ? '...' : 'Créer projet'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrepareEmailForProspect(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                          >
                            <Mail className="h-3 w-3" />
                            <span>Écrire</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteProspect(p.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600"
                            title="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'gmail' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Envoyer un message via Gmail
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={draftingAi}
                  onClick={() =>
                    handleDraftWithAi('Premier contact pour montrer une maquette gratuite (15 min)')
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="h-3 w-3 text-blue-600" />
                  <span>IA : 1er contact</span>
                </button>
                <button
                  type="button"
                  disabled={draftingAi}
                  onClick={() => handleDraftWithAi('Relance polie J+5 après le premier message')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="h-3 w-3 text-blue-600" />
                  <span>IA : Relance J+5</span>
                </button>
              </div>
            </div>

            {mailStatus && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  mailStatus.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {mailStatus.text}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Destinataire</label>
              <input
                type="email"
                value={gmailTo}
                onChange={(e) => setGmailTo(e.target.value)}
                placeholder="client@commerce.fr"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Objet</label>
              <input
                type="text"
                value={gmailSubject}
                onChange={(e) => setGmailSubject(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Message (Modèle §9 du guide)
              </label>
              <textarea
                rows={7}
                value={gmailBody}
                onChange={(e) => setGmailBody(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            {workspaceToken ? (
              <button
                type="button"
                disabled={!gmailTo.trim().includes('@') || !gmailSubject.trim() || !gmailBody.trim()}
                onClick={() => setConfirmSendOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Envoyer avec mon Gmail</span>
              </button>
            ) : (
              <GoogleSignInButton onClick={onSignInGoogle} label="Connecter Gmail pour envoyer" />
            )}
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">Derniers messages Gmail</h2>
              {workspaceToken && (
                <button
                  type="button"
                  onClick={loadInbox}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingInbox ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>

            {!workspaceToken ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-xs text-slate-500">
                  Connectez votre compte Google pour consulter vos échanges clients et répondre depuis l’application.
                </p>
                <GoogleSignInButton onClick={onSignInGoogle} label="Connecter Gmail" />
              </div>
            ) : gmailInbox.length === 0 ? (
              <p className="text-xs text-slate-500 py-6">Aucun message récent chargé.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {gmailInbox.map((m) => (
                  <div key={m.id} className="py-3">
                    <div className="text-xs font-semibold text-slate-900 truncate">{m.subject}</div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">{m.from}</div>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{m.snippet}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'forms' && (
        <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ClipboardList className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Réponses Google Forms (Formulaires de contact & brief clients)
            </h2>
          </div>

          {!workspaceToken ? (
            <div className="py-6 space-y-3">
              <p className="text-xs text-slate-500">
                Connectez votre compte Google pour lire directement les réponses de vos formulaires Google Forms dans le tableau de bord.
              </p>
              <GoogleSignInButton onClick={onSignInGoogle} label="Connecter Google Forms" />
            </div>
          ) : (
            <form onSubmit={handleLoadGoogleForm} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ID du formulaire Google Forms (trouvable dans l’URL /forms/d/<strong>ID</strong>/edit)
                </label>
                <input
                  type="text"
                  value={formIdInput}
                  onChange={(e) => setFormIdInput(e.target.value)}
                  placeholder="Ex : 1FAIpQLSc..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={loadingForm || !formIdInput.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {loadingForm ? 'Chargement...' : 'Charger les réponses'}
              </button>
            </form>
          )}

          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {formError}
            </div>
          )}

          {formSummary && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="text-sm font-semibold text-slate-900">
                {formSummary.title} ({formSummary.responses.length} réponse(s))
              </div>
              {formSummary.responses.length === 0 ? (
                <p className="text-xs text-slate-500">Aucune réponse enregistrée pour le moment.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {formSummary.responses.map((r) => (
                    <div key={r.responseId} className="py-3 text-xs">
                      <div className="font-mono text-slate-400">
                        {new Date(r.lastSubmittedTime).toLocaleString('fr-FR')}
                      </div>
                      <div className="mt-1 text-slate-800">{r.answersSummary.join(' · ')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
