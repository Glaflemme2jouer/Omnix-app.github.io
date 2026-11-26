import React from 'react';
import { Scale, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import type { HostingProviderPreset, LegalFormType, ProjectLegalInfo } from '../types';
import {
  HOSTING_PRESETS,
  LEGAL_FORM_OPTIONS,
  SOCIETE_FORMS_REQUIRING_CAPITAL,
  cleanDigits,
  evaluateProjectLegalCompliance,
} from '../lib/legalCompliance';

interface LegalQuestionnaireFormProps {
  clientName: string;
  isDemo: boolean;
  contactEmail: string;
  contactPhone: string;
  legal: ProjectLegalInfo;
  onChange: (nextLegal: ProjectLegalInfo) => void;
  onBlurSave?: () => void;
  compact?: boolean;
}

const HOSTING_OPTIONS: HostingProviderPreset[] = [
  'Netlify',
  'GitHub Pages',
  'Cloudflare Pages',
  'Framer',
  'OVHcloud',
  'Render',
  'Autre',
];

export const LegalQuestionnaireForm: React.FC<LegalQuestionnaireFormProps> = ({
  clientName,
  isDemo,
  contactEmail,
  contactPhone,
  legal,
  onChange,
  onBlurSave,
  compact = false,
}) => {
  const report = evaluateProjectLegalCompliance({
    clientName,
    isDemo,
    contactEmail,
    contactPhone,
    legal,
  });

  const requiresCapital = SOCIETE_FORMS_REQUIRING_CAPITAL.includes(legal.legalForm);
  const isAssociation = legal.legalForm === 'Association loi 1901';

  const patch = (partial: Partial<ProjectLegalInfo>) => {
    onChange({ ...legal, ...partial });
  };

  const handleSiretChange = (val: string) => {
    const digits = cleanDigits(val).slice(0, 14);
    const next: Partial<ProjectLegalInfo> = { siret: val };
    if (digits.length >= 9 && !cleanDigits(legal.siren)) {
      next.siren = digits.slice(0, 9);
    }
    patch(next);
  };

  const handleHostingChange = (provider: HostingProviderPreset) => {
    const preset = HOSTING_PRESETS[provider];
    if (provider === 'Autre') {
      patch({ hostingProvider: provider });
    } else {
      patch({
        hostingProvider: provider,
        hostingProviderName: preset.name,
        hostingProviderAddress: preset.address,
        hostingProviderPhone: preset.phone,
      });
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none';
  const labelClass = 'block text-xs font-medium text-slate-700 mb-1';

  return (
    <div className="space-y-5">
      {/* Live French Law Compliance Bar */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Scale className="h-4 w-4 text-blue-600 shrink-0" />
            <span>
              Conformité légale du site (LCEN · Code conso · RGPD / CNIL)
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold font-mono tabular-nums ${
              report.isFullyCompliant ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {report.isFullyCompliant ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            <span>
              {report.score}/{report.total} points prêts ({report.percent}%)
            </span>
          </span>
        </div>

        <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full transition-all ${
              report.isFullyCompliant ? 'bg-emerald-600' : 'bg-blue-600'
            }`}
            style={{ width: `${report.percent}%` }}
          />
        </div>

        {!compact && (
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
            {report.checks.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border px-3 py-2 text-[11px] ${
                  c.ok
                    ? 'border-emerald-200/80 bg-white text-slate-700'
                    : 'border-amber-200 bg-amber-50/70 text-amber-900'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  {c.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  )}
                  <span>{c.label}</span>
                </div>
                <p className="mt-0.5 text-[11px] opacity-85 leading-snug">{c.detail}</p>
              </div>
            ))}
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-slate-500 leading-relaxed">
          <Info className="h-3.5 w-3.5 shrink-0 text-blue-600 mt-0.5" />
          <span>
            Astuce RDV patron : s’il n’a pas son SIREN/SIRET ou RCS sous la main, retrouvez-les gratuitement en 10 secondes sur{' '}
            <a
              href="https://annuaire-entreprises.data.gouv.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:underline"
            >
              annuaire-entreprises.data.gouv.fr
            </a>
            .
          </span>
        </p>
      </div>

      {/* Bloc 1 : Identité légale du patron & de l'entreprise */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-slate-900 border-b border-slate-100 pb-2">
          1. Identité officielle de l’éditeur (à poser au patron)
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>Forme juridique *</label>
            <select
              value={legal.legalForm}
              onChange={(e) => {
                const form = e.target.value as LegalFormType;
                patch({ legalForm: form });
              }}
              onBlur={onBlurSave}
              className={inputClass}
            >
              {LEGAL_FORM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>
              {legal.legalForm === 'EI / Micro-entrepreneur'
                ? 'Nom & Prénom du patron (+ EI) *'
                : 'Raison sociale officielle *'}
            </label>
            <input
              type="text"
              value={legal.legalCompanyName}
              onChange={(e) => patch({ legalCompanyName: e.target.value })}
              onBlur={onBlurSave}
              placeholder={clientName ? `Ex : ${clientName}` : 'Ex : SARL Boulangerie Dupont'}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Directeur de la publication *</label>
            <input
              type="text"
              value={legal.publicationDirector}
              onChange={(e) => patch({ publicationDirector: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Nom du gérant, président ou patron"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>
              {isAssociation ? 'Numéro RNA (W...) ou SIREN *' : 'Numéro SIREN (9 chiffres) *'}
            </label>
            <input
              type="text"
              value={legal.siren}
              onChange={(e) => patch({ siren: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Ex : 123 456 789"
              className={`${inputClass} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label className={labelClass}>Numéro SIRET (14 chiffres) *</label>
            <input
              type="text"
              value={legal.siret}
              onChange={(e) => handleSiretChange(e.target.value)}
              onBlur={onBlurSave}
              placeholder="Ex : 123 456 789 00012"
              className={`${inputClass} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label className={labelClass}>
              {isAssociation ? 'N° RNA & Préfecture' : 'RCS + Ville ou RNE / Métiers *'}
            </label>
            <input
              type="text"
              value={legal.registrationNumber}
              onChange={(e) => patch({ registrationNumber: e.target.value })}
              onBlur={onBlurSave}
              placeholder={
                isAssociation
                  ? 'Ex : RNA W751234567 (Préfecture...)'
                  : 'Ex : RCS Lyon 123 456 789 ou RNE'
              }
              className={inputClass}
            />
          </div>

          {requiresCapital && (
            <div>
              <label className={labelClass}>Capital social (€) *</label>
              <input
                type="text"
                value={legal.shareCapitalEur}
                onChange={(e) => patch({ shareCapitalEur: e.target.value })}
                onBlur={onBlurSave}
                placeholder="Ex : 5 000"
                className={`${inputClass} font-mono tabular-nums`}
              />
            </div>
          )}

          <div>
            <label className={labelClass}>N° TVA intracommunautaire (ou franchise)</label>
            <input
              type="text"
              value={legal.vatNumber}
              onChange={(e) => patch({ vatNumber: e.target.value })}
              onBlur={onBlurSave}
              placeholder="FRXX... ou TVA non applicable, art. 293 B du CGI"
              className={inputClass}
            />
          </div>

          <div className={requiresCapital ? 'sm:col-span-2 lg:col-span-1' : 'sm:col-span-2'}>
            <label className={labelClass}>Adresse officielle du siège / établissement *</label>
            <input
              type="text"
              value={legal.registeredAddress}
              onChange={(e) => patch({ registeredAddress: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Ex : 12 rue de la République, 69001 Lyon"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass}>
              Activité réglementée / Assurances (si artisan BTP, coiffeur, santé, coach, alimentation...)
            </label>
            <input
              type="text"
              value={legal.regulatedProfessionDetails}
              onChange={(e) => patch({ regulatedProfessionDetails: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Ex : RC Pro / Décennale AXA France (couverture France métropolitaine) · Titre / diplôme..."
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Bloc 2 : Hébergeur & Nom de domaine (LCEN) */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-slate-900 border-b border-slate-100 pb-2">
          2. Hébergeur du site & Nom de domaine (obligatoire LCEN)
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>Plateforme d’hébergement</label>
            <select
              value={legal.hostingProvider}
              onChange={(e) => handleHostingChange(e.target.value as HostingProviderPreset)}
              onBlur={onBlurSave}
              className={inputClass}
            >
              {HOSTING_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Nom légal de l’hébergeur *</label>
            <input
              type="text"
              value={legal.hostingProviderName}
              onChange={(e) => patch({ hostingProviderName: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Ex : Netlify, Inc."
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Contact / Tél. de l’hébergeur *</label>
            <input
              type="text"
              value={legal.hostingProviderPhone}
              onChange={(e) => patch({ hostingProviderPhone: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Téléphone ou support officiel"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <label className={labelClass}>Adresse postale de l’hébergeur *</label>
            <input
              type="text"
              value={legal.hostingProviderAddress}
              onChange={(e) => patch({ hostingProviderAddress: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Adresse complète de la société d’hébergement"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Nom de domaine visé (si existant ou à acheter)</label>
            <input
              type="text"
              value={legal.customDomain}
              onChange={(e) => patch({ customDomain: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Ex : www.mon-commerce.fr"
              className={`${inputClass} font-mono`}
            />
          </div>

          <div>
            <label className={labelClass}>Registrar & boîtes e-mail (attention MX !)</label>
            <input
              type="text"
              value={legal.domainRegistrar}
              onChange={(e) => patch({ domainRegistrar: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Ex : OVHcloud (MX conservés)"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Bloc 3 : RGPD, Cookies, Médiateur B2C & Droits images */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-slate-900 border-b border-slate-100 pb-2">
          3. RGPD, Cookies (CNIL), Médiation B2C & Droits des visuels
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-xs cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={legal.b2cAudience}
              onChange={(e) => patch({ b2cAudience: e.target.checked })}
              onBlur={onBlurSave}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-slate-900">
                Clientèle de particuliers (B2C)
              </div>
              <div className="text-[11px] text-slate-500">
                Active l’obligation du médiateur de la consommation (Art. L.616-1 Code conso).
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-xs cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={legal.hasContactForm}
              onChange={(e) => patch({ hasContactForm: e.target.checked })}
              onBlur={onBlurSave}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-slate-900">
                Formulaire de contact / devis sur le site
              </div>
              <div className="text-[11px] text-slate-500">
                Impose une politique de confidentialité RGPD et mention d’information sous le formulaire.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-xs cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={legal.usesCookiesOrTrackers}
              onChange={(e) =>
                patch({
                  usesCookiesOrTrackers: e.target.checked,
                  analyticsTool: e.target.checked
                    ? 'Traceurs avec bandeau consentement CNIL'
                    : 'Cloudflare Web Analytics (sans cookies)',
                })
              }
              onBlur={onBlurSave}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-slate-900">
                Utilise des cookies ou traceurs tiers (Analytics/Maps)
              </div>
              <div className="text-[11px] text-slate-500">
                Laissez décoché avec Cloudflare Web Analytics sans cookies pour éviter le bandeau CNIL.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-xs cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={legal.mediaRightsConfirmed}
              onChange={(e) => patch({ mediaRightsConfirmed: e.target.checked })}
              onBlur={onBlurSave}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-slate-900">
                Droits photos & logo confirmés par le patron *
              </div>
              <div className="text-[11px] text-slate-500">
                Le patron garantit avoir les droits sur ses photos/textes (ou images libres Unsplash/Pexels).
              </div>
            </div>
          </label>
        </div>

        {legal.b2cAudience && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <div>
              <label className={labelClass}>Nom du médiateur de la consommation *</label>
              <input
                type="text"
                value={legal.consumerMediatorName}
                onChange={(e) => patch({ consumerMediatorName: e.target.value })}
                onBlur={onBlurSave}
                placeholder="Ex : CM2C, AME Conso, Médiation Commerce..."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Site web du médiateur *</label>
              <input
                type="text"
                value={legal.consumerMediatorWebsite}
                onChange={(e) => patch({ consumerMediatorWebsite: e.target.value })}
                onBlur={onBlurSave}
                placeholder="https://www.cm2c.net"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Adresse postale du médiateur</label>
              <input
                type="text"
                value={legal.consumerMediatorAddress}
                onChange={(e) => patch({ consumerMediatorAddress: e.target.value })}
                onBlur={onBlurSave}
                placeholder="Ex : 49 rue de Ponthieu, 75008 Paris"
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>E-mail pour exercer les droits RGPD *</label>
            <input
              type="email"
              value={legal.privacyControllerEmail}
              onChange={(e) => patch({ privacyControllerEmail: e.target.value })}
              onBlur={onBlurSave}
              placeholder={contactEmail || 'rgpd@commerce.fr'}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Durée de conservation des données</label>
            <input
              type="text"
              value={legal.dataRetentionMonths}
              onChange={(e) => patch({ dataRetentionMonths: e.target.value })}
              onBlur={onBlurSave}
              placeholder="36 mois"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Outil de mesure d’audience</label>
            <input
              type="text"
              value={legal.analyticsTool}
              onChange={(e) => patch({ analyticsTool: e.target.value })}
              onBlur={onBlurSave}
              placeholder="Cloudflare Web Analytics (sans cookies)"
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={legal.hasEcommerceOrPrices}
              onChange={(e) => patch({ hasEcommerceOrPrices: e.target.checked })}
              onBlur={onBlurSave}
            />
            <span>Affiche des prix / vente en ligne (CGV requises)</span>
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={legal.portfolioAuthorization}
              onChange={(e) => patch({ portfolioAuthorization: e.target.checked })}
              onBlur={onBlurSave}
            />
            <span>Accord écrit du patron pour afficher le site dans notre portfolio</span>
          </label>
        </div>
      </div>
    </div>
  );
};
