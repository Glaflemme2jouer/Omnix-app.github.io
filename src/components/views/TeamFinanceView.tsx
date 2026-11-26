import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Users,
  Wallet,
  Copy,
  Check,
  Trash2,
  Lock,
  KeyRound,
  Download,
  Upload,
} from 'lucide-react';
import type {
  AgencyRole,
  AgencyState,
  BillingFramework,
  FinanceEntry,
  TeamMember,
} from '../../types';

interface AccessMemberStatus {
  email: string;
  isAdmin: boolean;
  hasPassword: boolean;
}

interface TeamFinanceViewProps {
  state: AgencyState;
  currentUserEmail: string;
  onUpdateMember: (id: string, updates: Partial<TeamMember>) => Promise<void>;
  onAddMember: (payload: Partial<TeamMember>) => Promise<void>;
  onDeleteMember: (id: string) => Promise<void>;
  onAddFinance: (payload: Partial<FinanceEntry>) => Promise<void>;
  onUpdateFinance: (id: string, updates: Partial<FinanceEntry>) => Promise<void>;
  onDeleteFinance: (id: string) => Promise<void>;
  onUpdateSettings: (updates: Partial<AgencyState['settings']>) => Promise<void>;
  onStateReplaced: (nextState: AgencyState) => void;
}

const ROLES: AgencyRole[] = [
  'Chef de projet',
  'Designer',
  'Développeur',
  'Commercial',
  'Rédacteur',
];

const FREQUENT_ERRORS = [
  'Travailler sans devis signé.',
  'Promettre un délai impossible pour décrocher la vente.',
  'Laisser une seule personne porter tout le projet.',
  'Copier des textes ou des images protégés.',
  'Oublier les mentions légales.',
  'Garder les accès du client pour toi sans le prévenir.',
  'Négliger l’école. Si les notes baissent, l’équipe réduit le rythme.',
];

export const TeamFinanceView: React.FC<TeamFinanceViewProps> = ({
  state,
  currentUserEmail,
  onUpdateMember,
  onAddMember,
  onDeleteMember,
  onAddFinance,
  onUpdateFinance,
  onDeleteFinance,
  onUpdateSettings,
  onStateReplaced,
}) => {
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<AgencyRole>('Chef de projet');
  const [addingMember, setAddingMember] = useState(false);

  const [finClient, setFinClient] = useState('');
  const [finAmount, setFinAmount] = useState(150);
  const [finType, setFinType] = useState<FinanceEntry['type']>('Acompte 30 %');
  const [finStatus, setFinStatus] = useState<FinanceEntry['status']>('Payé');
  const [finProjectId, setFinProjectId] = useState('');
  const [addingFinance, setAddingFinance] = useState(false);

  const [teamFinanceFeedback, setTeamFinanceFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteAsAdmin, setInviteAsAdmin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const [accessMembers, setAccessMembers] = useState<AccessMemberStatus[]>([]);
  const [accessMessage, setAccessMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [editingPasswordEmail, setEditingPasswordEmail] = useState<string | null>(null);
  const [editingPasswordValue, setEditingPasswordValue] = useState('');
  const [myNewPassword, setMyNewPassword] = useState('');
  const [savingAccess, setSavingAccess] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedUserEmail = currentUserEmail.trim().toLowerCase();
  const isAdmin =
    state.settings.adminEmails.length === 0 ||
    (normalizedUserEmail !== '' && state.settings.adminEmails.includes(normalizedUserEmail));

  const sharedAppUrl =
    typeof window !== 'undefined'
      ? window.location.origin.replace('ais-dev-', 'ais-pre-')
      : '';

  const fetchAccessStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agency/access/status');
      if (!res.ok) return;
      const data = (await res.json()) as { members: AccessMemberStatus[] };
      setAccessMembers(data.members || []);
    } catch {
      // Ignore background fetch error
    }
  }, []);

  useEffect(() => {
    fetchAccessStatus();
  }, [fetchAccessStatus, state.settings.allowedEmails.length, state.settings.adminEmails.length]);

  const handleCopyShareLink = async () => {
    if (!sharedAppUrl) return;
    try {
      await navigator.clipboard.writeText(sharedAppUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setAccessMessage({
        type: 'err',
        text: 'Copie automatique bloquée. Sélectionnez et copiez le lien manuellement.',
      });
    }
  };

  const handleAddAllowedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inviteEmail.trim().toLowerCase();
    if (!cleaned || !cleaned.includes('@')) return;
    if (invitePassword && invitePassword.trim().length < 6) {
      setAccessMessage({
        type: 'err',
        text: 'Le mot de passe doit contenir au moins 6 caractères.',
      });
      return;
    }

    setSavingAccess(true);
    setAccessMessage(null);
    try {
      const res = await fetch('/api/agency/access/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleaned,
          password: invitePassword.trim() || undefined,
          isAdmin: inviteAsAdmin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessMessage({ type: 'err', text: data.error || 'Impossible d’autoriser ce membre.' });
        return;
      }
      if (data.state) onStateReplaced(data.state);
      if (data.accessMembers) setAccessMembers(data.accessMembers);
      setInviteEmail('');
      setInvitePassword('');
      setInviteAsAdmin(false);
      setAccessMessage({
        type: 'ok',
        text: invitePassword.trim()
          ? `Accès créé pour ${cleaned} avec mot de passe.`
          : `Adresse ${cleaned} autorisée.`,
      });
    } catch (err: any) {
      setAccessMessage({ type: 'err', text: err?.message || 'Erreur réseau.' });
    } finally {
      setSavingAccess(false);
    }
  };

  const handleSetMemberPassword = async (email: string) => {
    if (editingPasswordValue.trim().length < 6) {
      setAccessMessage({
        type: 'err',
        text: 'Le mot de passe doit contenir au moins 6 caractères.',
      });
      return;
    }
    setSavingAccess(true);
    setAccessMessage(null);
    try {
      const res = await fetch('/api/agency/access/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: editingPasswordValue.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessMessage({ type: 'err', text: data.error || 'Erreur lors de la mise à jour.' });
        return;
      }
      if (data.state) onStateReplaced(data.state);
      if (data.accessMembers) setAccessMembers(data.accessMembers);
      setEditingPasswordEmail(null);
      setEditingPasswordValue('');
      setAccessMessage({ type: 'ok', text: `Mot de passe mis à jour pour ${email}.` });
    } catch (err: any) {
      setAccessMessage({ type: 'err', text: err?.message || 'Erreur réseau.' });
    } finally {
      setSavingAccess(false);
    }
  };

  const handleToggleAdmin = async (email: string) => {
    const isCurrentlyAdmin = state.settings.adminEmails.includes(email);
    if (isCurrentlyAdmin && state.settings.adminEmails.length <= 1) return;
    setSavingAccess(true);
    setAccessMessage(null);
    try {
      const res = await fetch('/api/agency/access/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, isAdmin: !isCurrentlyAdmin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessMessage({ type: 'err', text: data.error || 'Modification impossible.' });
        return;
      }
      if (data.state) onStateReplaced(data.state);
      if (data.accessMembers) setAccessMembers(data.accessMembers);
    } catch (err: any) {
      setAccessMessage({ type: 'err', text: err?.message || 'Erreur réseau.' });
    } finally {
      setSavingAccess(false);
    }
  };

  const handleRemoveAllowedEmail = async (email: string) => {
    setSavingAccess(true);
    setAccessMessage(null);
    try {
      const res = await fetch('/api/agency/access/member', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessMessage({ type: 'err', text: data.error || 'Suppression impossible.' });
        return;
      }
      if (data.state) onStateReplaced(data.state);
      if (data.accessMembers) setAccessMembers(data.accessMembers);
    } catch (err: any) {
      setAccessMessage({ type: 'err', text: err?.message || 'Erreur réseau.' });
    } finally {
      setSavingAccess(false);
    }
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (myNewPassword.trim().length < 6) {
      setAccessMessage({
        type: 'err',
        text: 'Votre mot de passe doit contenir au moins 6 caractères.',
      });
      return;
    }
    setSavingAccess(true);
    setAccessMessage(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: myNewPassword.trim(), email: normalizedUserEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessMessage({ type: 'err', text: data.error || 'Impossible de modifier le mot de passe.' });
        return;
      }
      setMyNewPassword('');
      await fetchAccessStatus();
      setAccessMessage({
        type: 'ok',
        text: 'Votre mot de passe Omnix est enregistré. Vous pourrez l’utiliser à la prochaine connexion.',
      });
    } catch (err: any) {
      setAccessMessage({ type: 'err', text: err?.message || 'Erreur réseau.' });
    } finally {
      setSavingAccess(false);
    }
  };

  const handleExportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnix-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/agency/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessMessage({ type: 'err', text: data.error || 'Import impossible.' });
        return;
      }
      if (data.state) onStateReplaced(data.state);
      await fetchAccessStatus();
      setAccessMessage({ type: 'ok', text: 'Sauvegarde restaurée avec succès.' });
    } catch {
      setAccessMessage({ type: 'err', text: 'Fichier JSON invalide.' });
    } finally {
      e.target.value = '';
    }
  };

  const paidRevenue = state.finances
    .filter((f) => f.status === 'Payé' && f.type !== 'Dépense caisse commune')
    .reduce((sum, f) => sum + f.amountEur, 0);
  const expenses = state.finances
    .filter((f) => f.type === 'Dépense caisse commune')
    .reduce((sum, f) => sum + f.amountEur, 0);

  const poolHours70 = paidRevenue * 0.7;
  const commonPot20 = Math.max(0, paidRevenue * 0.2 - expenses);
  const commercialBonus10 = paidRevenue * 0.1;

  const totalWeeklyHours = state.members.reduce((sum, m) => sum + (m.weeklyHours || 0), 0);

  const handleAddTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim() || addingMember) return;
    setAddingMember(true);
    setTeamFinanceFeedback(null);
    try {
      await onAddMember({ name: newMemberName.trim(), role: newMemberRole });
      setNewMemberName('');
      setTeamFinanceFeedback({ type: 'ok', text: 'Membre ajouté à l’équipe.' });
    } catch (err: any) {
      setTeamFinanceFeedback({
        type: 'err',
        text: err?.message || 'Impossible d’ajouter ce membre.',
      });
    } finally {
      setAddingMember(false);
    }
  };

  const handleAddFinanceEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const linkedProject = state.projects.find((p) => p.id === finProjectId);
    const clientLabel = finClient.trim() || linkedProject?.clientName || '';
    if (!clientLabel || addingFinance) return;
    setAddingFinance(true);
    setTeamFinanceFeedback(null);
    try {
      await onAddFinance({
        projectId: finProjectId || '',
        clientName: clientLabel,
        label: `${finType} — ${clientLabel}`,
        amountEur: finAmount,
        type: finType,
        status: finStatus,
        billingParentOrEntity: state.settings.billingFramework,
        commercialMemberId: linkedProject?.commercialMemberId || undefined,
      });
      setFinClient('');
      setFinProjectId('');
      setTeamFinanceFeedback({ type: 'ok', text: 'Écriture enregistrée.' });
    } catch (err: any) {
      setTeamFinanceFeedback({
        type: 'err',
        text: err?.message || 'Impossible d’enregistrer cette écriture.',
      });
    } finally {
      setAddingFinance(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-900">
                Accès sécurisé & partage d’équipe (anti-inconnus)
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Vos coéquipiers se connectent directement avec leur e-mail et leur mot de passe Omnix (sans blocage Google).
            </p>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => onUpdateSettings({ lockEnabled: !state.settings.lockEnabled })}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                state.settings.lockEnabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              <span>
                {state.settings.lockEnabled
                  ? 'Protection active (liste blanche)'
                  : 'Protection désactivée'}
              </span>
            </button>
          )}
        </div>

        {accessMessage && (
          <div
            className={`rounded-lg border px-3.5 py-2.5 text-xs ${
              accessMessage.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {accessMessage.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-800">
                1. Lien partagé à envoyer à votre fils et ses potes
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={sharedAppUrl}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedLink ? 'Copié' : 'Copier'}</span>
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Tous les membres connectés sur ce lien travaillent sur le même espace Omnix (mêmes projets, tâches, caisse et Jarvis). Le bouton Google reste optionnel uniquement pour synchroniser Calendar, Drive ou Gmail.
              </p>
            </div>

            {normalizedUserEmail && (
              <form
                onSubmit={handleChangeMyPassword}
                className="space-y-2 border-t border-slate-100 pt-4"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <KeyRound className="h-3.5 w-3.5 text-blue-600" />
                  <span>Mon mot de passe Omnix ({normalizedUserEmail})</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    minLength={6}
                    required
                    value={myNewPassword}
                    onChange={(e) => setMyNewPassword(e.target.value)}
                    placeholder="Nouveau mot de passe (min. 6 car.)"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={savingAccess}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            )}

            {isAdmin && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="text-xs font-semibold text-slate-800">
                  Sauvegarde Render / PC (.json)
                </div>
                <p className="text-[11px] text-slate-500">
                  Sur Render gratuit, les données locales peuvent se réinitialiser lors d’un redémarrage : exportez une copie de secours ou restaurez-la ici.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Exporter (.json)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Restaurer (.json)</span>
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-800">
              2. Comptes d’équipe autorisés ({state.settings.allowedEmails.length})
            </div>

            {isAdmin && (
              <form onSubmit={handleAddAllowedEmail} className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="prenom.pote@gmail.com"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    minLength={6}
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    placeholder="Mot de passe (min. 6 car.)"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteAsAdmin}
                      onChange={(e) => setInviteAsAdmin(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Droits administrateur</span>
                  </label>
                  <button
                    type="submit"
                    disabled={savingAccess}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Créer / Autoriser</span>
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50">
              {state.settings.allowedEmails.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-slate-500">
                  Aucun e-mail enregistré pour l’instant.
                </p>
              ) : (
                state.settings.allowedEmails.map((email) => {
                  const isItemAdmin = state.settings.adminEmails.includes(email);
                  const isLastAdmin = isItemAdmin && state.settings.adminEmails.length <= 1;
                  const statusEntry = accessMembers.find((m) => m.email === email);
                  const hasPassword = statusEntry?.hasPassword ?? false;
                  const isEditingThis = editingPasswordEmail === email;

                  return (
                    <div key={email} className="px-3 py-2.5 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800 truncate">{email}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <span>{isItemAdmin ? 'Admin' : 'Membre'}</span>
                            <span aria-hidden="true">·</span>
                            <span className={hasPassword ? 'text-emerald-700' : 'text-amber-700'}>
                              {hasPassword ? 'Mot de passe actif' : 'Aucun mot de passe'}
                            </span>
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-2.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPasswordEmail(isEditingThis ? null : email);
                                setEditingPasswordValue('');
                              }}
                              className="text-[11px] font-medium text-slate-700 hover:underline whitespace-nowrap"
                            >
                              {isEditingThis ? 'Fermer' : hasPassword ? 'Changer MDP' : 'Définir MDP'}
                            </button>
                            <button
                              type="button"
                              disabled={isLastAdmin || savingAccess}
                              onClick={() => handleToggleAdmin(email)}
                              className="text-[11px] font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline whitespace-nowrap"
                            >
                              {isItemAdmin ? 'Retirer admin' : 'Passer admin'}
                            </button>
                            {!isLastAdmin && (
                              <button
                                type="button"
                                disabled={savingAccess}
                                onClick={() => handleRemoveAllowedEmail(email)}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Retirer l’accès"
                                aria-label={`Retirer ${email}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {isAdmin && isEditingThis && (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            minLength={6}
                            value={editingPasswordValue}
                            onChange={(e) => setEditingPasswordValue(e.target.value)}
                            placeholder="Nouveau mot de passe (min. 6 car.)"
                            className="flex-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs"
                          />
                          <button
                            type="button"
                            disabled={savingAccess}
                            onClick={() => handleSetMemberPassword(email)}
                            className="rounded bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            Valider
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200/90 bg-white p-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Cadre légal, parents & partage de l’argent (Guide §2 & §5)
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Règle de départ : un parent doit connaître chaque vente et valider le cadre d’encaissement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={state.settings.billingFramework}
            onChange={(e) =>
              onUpdateSettings({ billingFramework: e.target.value as BillingFramework })
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="Facturation via parent">Facturation au nom d’un parent</option>
            <option value="Micro-entreprise (accord parental)">
              Micro-entreprise (accord écrit des représentants légaux)
            </option>
            <option value="Association loi 1901">Association loi 1901</option>
          </select>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Total encaissé</p>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {paidRevenue.toFixed(0)} €
          </p>
          <p className="mt-1 text-xs text-slate-500">Devis signés & preuves conservées</p>
        </div>
        <div className="rounded-xl border border-slate-200/90 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">70 % · Partagés selon les heures</p>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {poolHours70.toFixed(2)} €
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Base {totalWeeklyHours.toFixed(1)}h cumulées
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/90 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">20 % · Caisse commune (frais)</p>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {commonPot20.toFixed(2)} €
          </p>
          <p className="mt-1 text-xs text-slate-500">Noms de domaine, cartes, outils</p>
        </div>
        <div className="rounded-xl border border-slate-200/90 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">10 % · Prime commercial</p>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {commercialBonus10.toFixed(2)} €
          </p>
          <p className="mt-1 text-xs text-slate-500">Pour celui qui a trouvé le client</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Équipe & rotation mensuelle des rôles
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Chaque personne qui se connecte (mot de passe ou Google) apparaît ici automatiquement, ou ajoutez un membre manuellement.
            </p>
          </div>

          <form onSubmit={handleAddTeamMember} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="Prénom du membre..."
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
            />
            <select
              value={newMemberRole}
              onChange={(e) => setNewMemberRole(e.target.value as AgencyRole)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={addingMember || !newMemberName.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{addingMember ? 'Ajout...' : 'Ajouter'}</span>
            </button>
          </form>
        </div>

        {teamFinanceFeedback && (
          <div
            className={`rounded-lg border px-3.5 py-2 text-xs ${
              teamFinanceFeedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {teamFinanceFeedback.text}
          </div>
        )}

        {state.members.length === 0 ? (
          <div className="py-10 text-center flex flex-col items-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 mb-3">
              <Users className="h-5 w-5" />
            </div>
            <p className="text-xs font-semibold text-slate-900">Aucun membre inscrit pour le moment</p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Ajoutez vos prénoms ci-dessus ou connectez vos coéquipiers avec leur mot de passe pour attribuer les 5 rôles du mois.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Membre</th>
                  <th className="px-4 py-3 font-semibold">Rôle du mois</th>
                  <th className="px-4 py-3 font-semibold">Heures cette semaine</th>
                  <th className="px-4 py-3 font-semibold text-right">Part estimée (70 %)</th>
                  <th className="px-4 py-3 font-semibold">Parent référent & Accord</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.members.map((m) => {
                  const shareEur =
                    totalWeeklyHours > 0 ? (m.weeklyHours / totalWeeklyHours) * poolHours70 : 0;
                  const overLimit = m.weeklyHours > m.maxWeeklyHours;
                  return (
                    <tr key={m.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{m.name}</div>
                        <div className="text-slate-400">{m.email || 'Ajouté manuellement'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={m.role}
                          onChange={(e) =>
                            onUpdateMember(m.id, { role: e.target.value as AgencyRole })
                          }
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-mono tabular-nums">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="20"
                            value={m.weeklyHours}
                            onChange={(e) =>
                              onUpdateMember(m.id, { weeklyHours: Number(e.target.value) || 0 })
                            }
                            className="w-16 rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                          <span className={overLimit ? 'text-amber-700 font-semibold' : 'text-slate-500'}>
                            / {m.maxWeeklyHours}h {overLimit ? '(Attention école)' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {shareEur.toFixed(2)} €
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            key={`${m.id}-${m.parentName}`}
                            type="text"
                            defaultValue={m.parentName}
                            onBlur={(e) => {
                              const nextName = e.target.value.trim() || 'À renseigner';
                              if (nextName !== m.parentName) {
                                onUpdateMember(m.id, { parentName: nextName }).catch(() => {});
                              }
                            }}
                            placeholder="Nom du parent"
                            className="w-28 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateMember(m.id, { parentApproved: !m.parentApproved })
                            }
                            className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${
                              m.parentApproved ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {m.parentApproved ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Validé</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>En attente</span>
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeleteMember(m.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Retirer de la liste d’équipe"
                          aria-label={`Retirer ${m.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-xl border border-slate-200/90 bg-white p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Journal des ventes & caisse commune
          </h3>

          <form onSubmit={handleAddFinanceEntry} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Client / Libellé</label>
              <input
                type="text"
                required={!finProjectId}
                value={finClient}
                onChange={(e) => setFinClient(e.target.value)}
                placeholder="Ex : Premier client"
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Projet (optionnel)</label>
              <select
                value={finProjectId}
                onChange={(e) => {
                  const pId = e.target.value;
                  setFinProjectId(pId);
                  const found = state.projects.find((p) => p.id === pId);
                  if (found && !finClient.trim()) {
                    setFinClient(found.clientName);
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Hors projet / Libre</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type & Statut</label>
              <div className="space-y-1.5">
                <select
                  value={finType}
                  onChange={(e) => setFinType(e.target.value as FinanceEntry['type'])}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="Acompte 30 %">Acompte 30 %</option>
                  <option value="Solde">Solde</option>
                  <option value="Suivi mensuel">Suivi mensuel</option>
                  <option value="Dépense caisse commune">Dépense caisse commune</option>
                </select>
                <select
                  value={finStatus}
                  onChange={(e) => setFinStatus(e.target.value as FinanceEntry['status'])}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="Payé">Payé (encaissé)</option>
                  <option value="Devis signé">Devis signé</option>
                  <option value="En attente">En attente</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Montant (€)</label>
              <input
                type="number"
                min={0}
                value={finAmount}
                onChange={(e) => setFinAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono tabular-nums"
              />
            </div>
            <button
              type="submit"
              disabled={addingFinance}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {addingFinance ? 'Ajout...' : 'Enregistrer'}
            </button>
          </form>

          {state.finances.length === 0 ? (
            <div className="py-10 text-center flex flex-col items-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 mb-3">
                <Wallet className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-slate-800">Aucune écriture comptable</p>
              <p className="mt-1 text-xs text-slate-500">
                Chaque acompte, solde ou dépense enregistré ici calculera automatiquement le partage 70 / 20 / 10.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {state.finances.map((f) => (
                <div key={f.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{f.label}</div>
                    <div className="text-slate-500 mt-0.5 font-mono tabular-nums">
                      {f.invoiceRef} · {f.date} · {f.billingParentOrEntity}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <select
                      value={f.status}
                      onChange={(e) =>
                        onUpdateFinance(f.id, { status: e.target.value as FinanceEntry['status'] })
                      }
                      className={`rounded border px-2 py-1 text-[11px] font-medium ${
                        f.status === 'Payé'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      <option value="Payé">Payé</option>
                      <option value="Devis signé">Devis signé</option>
                      <option value="En attente">En attente</option>
                    </select>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 w-20 text-right">
                      {f.type === 'Dépense caisse commune' ? '-' : '+'}
                      {f.amountEur} €
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteFinance(f.id)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Supprimer cette écriture"
                      aria-label={`Supprimer ${f.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-6 space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              7 erreurs fréquentes à éviter (Guide §10)
            </h3>
          </div>
          <ul className="space-y-2.5 text-xs text-slate-600">
            {FREQUENT_ERRORS.map((err, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="font-mono tabular-nums text-slate-400">0{i + 1}.</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
};
