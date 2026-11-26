import type {
  ClientProject,
  HostingProviderPreset,
  LegalFormType,
  ProjectBrief,
  ProjectLegalInfo,
  ProjectQualityChecks,
} from '../types.ts';

export const LEGAL_FORM_OPTIONS: LegalFormType[] = [
  'EI / Micro-entrepreneur',
  'SARL',
  'EURL',
  'SAS',
  'SASU',
  'SCI',
  'Association loi 1901',
  'Autre',
];

export const SOCIETE_FORMS_REQUIRING_CAPITAL: LegalFormType[] = [
  'SARL',
  'EURL',
  'SAS',
  'SASU',
  'SCI',
];

export const HOSTING_PRESETS: Record<
  HostingProviderPreset,
  { name: string; address: string; phone: string }
> = {
  Netlify: {
    name: 'Netlify, Inc.',
    address: '512 2nd Street, Suite 200, San Francisco, CA 94107, États-Unis',
    phone: '+1 844-899-7312 · support@netlify.com',
  },
  'GitHub Pages': {
    name: 'GitHub, Inc.',
    address: '88 Colin P Kelly Jr St, San Francisco, CA 94107, États-Unis',
    phone: 'https://support.github.com',
  },
  'Cloudflare Pages': {
    name: 'Cloudflare, Inc.',
    address: '101 Townsend St, San Francisco, CA 94107, États-Unis',
    phone: '+1 888-993-5273',
  },
  Framer: {
    name: 'Framer B.V.',
    address: 'Rozengracht 207B, 1016 LZ Amsterdam, Pays-Bas',
    phone: 'support@framer.com',
  },
  OVHcloud: {
    name: 'OVH SAS',
    address: '2 rue Kellermann, 59100 Roubaix, France',
    phone: '1007 / +33 9 72 10 10 07',
  },
  Render: {
    name: 'Render Services, Inc.',
    address: '525 Brannan St, Suite 300, San Francisco, CA 94107, États-Unis',
    phone: 'support@render.com',
  },
  Autre: {
    name: '',
    address: '',
    phone: '',
  },
};

export function createDefaultBrief(overrides?: Partial<ProjectBrief>): ProjectBrief {
  return {
    activitySummary: '',
    targetClients: '',
    desiredPages: 'Accueil, Services, Horaires & Contact',
    inspirationSites: '',
    existingAssets: '',
    hoursAddressPhone: '',
    primaryVisitorAction: 'Appeler ou envoyer un message',
    budgetRange: '300 à 500 €',
    ...(overrides || {}),
  };
}

export function createDefaultQualityChecks(
  overrides?: Partial<ProjectQualityChecks>
): ProjectQualityChecks {
  return {
    aiCopyReviewed: false,
    mobileTested: false,
    imageRightsVerified: false,
    legalMentionsAdded: false,
    privacyPolicyAdded: false,
    cookieComplianceChecked: false,
    mediatorAddedIfB2C: false,
    seoLocalMetaReady: false,
    ...(overrides || {}),
  };
}

export function createDefaultLegalInfo(
  overrides?: Partial<ProjectLegalInfo>
): ProjectLegalInfo {
  const provider: HostingProviderPreset = overrides?.hostingProvider || 'Netlify';
  const preset = HOSTING_PRESETS[provider] || HOSTING_PRESETS.Netlify;
  return {
    legalForm: 'EI / Micro-entrepreneur',
    legalCompanyName: '',
    publicationDirector: '',
    siren: '',
    siret: '',
    shareCapitalEur: '',
    registrationNumber: '',
    vatNumber: 'TVA non applicable, art. 293 B du CGI',
    registeredAddress: '',
    b2cAudience: true,
    consumerMediatorName: '',
    consumerMediatorWebsite: '',
    consumerMediatorAddress: '',
    regulatedProfessionDetails: '',
    hostingProvider: provider,
    hostingProviderName: overrides?.hostingProviderName ?? preset.name,
    hostingProviderAddress: overrides?.hostingProviderAddress ?? preset.address,
    hostingProviderPhone: overrides?.hostingProviderPhone ?? preset.phone,
    domainRegistrar: '',
    customDomain: '',
    hasContactForm: true,
    privacyControllerEmail: '',
    dataRetentionMonths: '36 mois',
    usesCookiesOrTrackers: false,
    analyticsTool: 'Cloudflare Web Analytics (sans cookies)',
    hasEcommerceOrPrices: false,
    mediaRightsConfirmed: false,
    portfolioAuthorization: false,
    ...(overrides || {}),
  };
}

export function normalizeProject(raw: Partial<ClientProject>): ClientProject {
  return {
    id: raw.id || `proj-${Date.now()}`,
    clientName: (raw.clientName || '').trim() || 'Nouveau client',
    sector: (raw.sector || '').trim() || 'Commerce local',
    isDemo: Boolean(raw.isDemo),
    step: (raw.step as ClientProject['step']) || 1,
    offerTier: raw.offerTier || 'Standard',
    totalPriceEur:
      raw.totalPriceEur !== undefined && !Number.isNaN(Number(raw.totalPriceEur))
        ? Number(raw.totalPriceEur)
        : 380,
    depositPaidEur: Number(raw.depositPaidEur) || 0,
    balancePaidEur: Number(raw.balancePaidEur) || 0,
    revisionsIncluded:
      raw.revisionsIncluded !== undefined && !Number.isNaN(Number(raw.revisionsIncluded))
        ? Number(raw.revisionsIncluded)
        : 2,
    deliveryTargetDate:
      raw.deliveryTargetDate || new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10),
    ownerMemberId: raw.ownerMemberId || '',
    commercialMemberId: raw.commercialMemberId || '',
    contactEmail: raw.contactEmail || '',
    contactPhone: raw.contactPhone || '',
    brief: createDefaultBrief(raw.brief),
    legal: createDefaultLegalInfo(raw.legal),
    qualityChecks: createDefaultQualityChecks(raw.qualityChecks),
    integrations: raw.integrations && typeof raw.integrations === 'object' ? raw.integrations : {},
    generatedHtml: raw.generatedHtml || '',
    followUp30Done: Boolean(raw.followUp30Done),
    googleReviewRequested: Boolean(raw.googleReviewRequested),
    notes: raw.notes || '',
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export function cleanDigits(val: string): string {
  return (val || '').replace(/\D/g, '');
}

export function isValidSiren(val: string): boolean {
  return cleanDigits(val).length === 9;
}

export function isValidSiret(val: string): boolean {
  return cleanDigits(val).length === 14;
}

export interface LegalComplianceCheck {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export interface LegalComplianceReport {
  score: number;
  total: number;
  percent: number;
  isFullyCompliant: boolean;
  checks: LegalComplianceCheck[];
  missingLabels: string[];
}

export function evaluateProjectLegalCompliance(
  project: Pick<ClientProject, 'clientName' | 'isDemo' | 'contactEmail' | 'contactPhone' | 'legal'>
): LegalComplianceReport {
  const legal = createDefaultLegalInfo(project.legal);
  const isAssociation = legal.legalForm === 'Association loi 1901';
  const requiresCapital = SOCIETE_FORMS_REQUIRING_CAPITAL.includes(legal.legalForm);
  const sirenDigits = cleanDigits(legal.siren);
  const siretDigits = cleanDigits(legal.siret);
  const hasValidSirenOrSiret =
    siretDigits.length === 14 ||
    sirenDigits.length === 9 ||
    (isAssociation && legal.registrationNumber.trim().length >= 5);

  const checks: LegalComplianceCheck[] = [
    {
      id: 'identity',
      label: 'Éditeur & Directeur de publication (LCEN)',
      ok: Boolean(
        (legal.legalCompanyName.trim() || project.clientName.trim()) &&
          legal.publicationDirector.trim() &&
          legal.registeredAddress.trim()
      ),
      required: true,
      detail: !legal.publicationDirector.trim()
        ? 'Indiquez le nom du directeur de publication (gérant, président ou patron).'
        : !legal.registeredAddress.trim()
          ? 'Ajoutez l’adresse complète du siège social ou de l’établissement.'
          : 'Identité et directeur de publication renseignés.',
    },
    {
      id: 'registration-ids',
      label: isAssociation
        ? 'Numéro RNA / SIREN de l’association'
        : 'Numéro SIREN (9 chiffres) ou SIRET (14 chiffres)',
      ok: hasValidSirenOrSiret,
      required: true,
      detail: hasValidSirenOrSiret
        ? `Identifiant officiel présent (${siretDigits.length === 14 ? `SIRET ${siretDigits}` : sirenDigits.length === 9 ? `SIREN ${sirenDigits}` : legal.registrationNumber}).`
        : isAssociation
          ? 'Indiquez le numéro RNA (W...) ou SIREN de l’association.'
          : 'Demandez le SIREN (9 chiffres) ou SIRET (14 chiffres) au patron (gratuit sur annuaire-entreprises.data.gouv.fr).',
    },
    {
      id: 'corporate-registry',
      label: requiresCapital
        ? 'RCS / RNE & Capital social (obligatoire en société)'
        : 'Immatriculation RCS / RNE & Régime TVA',
      ok: Boolean(
        legal.vatNumber.trim() &&
          (!requiresCapital ||
            (legal.shareCapitalEur.trim() !== '' && legal.registrationNumber.trim() !== ''))
      ),
      required: true,
      detail:
        requiresCapital && (!legal.shareCapitalEur.trim() || !legal.registrationNumber.trim())
          ? `En ${legal.legalForm}, le montant du capital social (€) et le RCS/RNE (ex : RCS Lyon) sont obligatoires.`
          : !legal.vatNumber.trim()
            ? 'Précisez le N° TVA intracommunautaire ou « TVA non applicable, art. 293 B du CGI ».'
            : 'Mentions d’immatriculation et de TVA complètes.',
    },
    {
      id: 'contact',
      label: 'Contact direct accessible (e-mail + téléphone)',
      ok: Boolean(
        (project.contactEmail.trim() || legal.privacyControllerEmail.trim()) &&
          project.contactPhone.trim()
      ),
      required: true,
      detail:
        project.contactEmail.trim() && project.contactPhone.trim()
          ? 'Coordonnées de contact direct valides.'
          : 'La LCEN impose un e-mail ET un numéro de téléphone visibles dans les mentions légales.',
    },
    {
      id: 'hosting',
      label: 'Coordonnées complètes de l’hébergeur (LCEN)',
      ok: Boolean(
        legal.hostingProviderName.trim() &&
          legal.hostingProviderAddress.trim() &&
          legal.hostingProviderPhone.trim()
      ),
      required: true,
      detail:
        legal.hostingProviderName.trim() &&
        legal.hostingProviderAddress.trim() &&
        legal.hostingProviderPhone.trim()
          ? `Hébergeur complet : ${legal.hostingProviderName}.`
          : 'Nom, adresse postale et téléphone/contact de l’hébergeur obligatoires (utilisez un préréglage).',
    },
    {
      id: 'rgpd',
      label: 'RGPD & Politique de confidentialité',
      ok:
        !legal.hasContactForm ||
        Boolean(
          (legal.privacyControllerEmail.trim() || project.contactEmail.trim()) &&
            legal.dataRetentionMonths.trim()
        ),
      required: legal.hasContactForm,
      detail: !legal.hasContactForm
        ? 'Aucun formulaire actif (pensez toutefois à informer si prise de contact par mail).'
        : legal.privacyControllerEmail.trim() || project.contactEmail.trim()
          ? `Finalité, durée (${legal.dataRetentionMonths || '36 mois'}) et e-mail droits RGPD prêts.`
          : 'Un formulaire collecte des données personnelles : précisez l’e-mail pour exercer les droits RGPD.',
    },
    {
      id: 'mediator',
      label: 'Médiateur de la consommation (obligatoire en B2C)',
      ok: !legal.b2cAudience || Boolean(legal.consumerMediatorName.trim() && legal.consumerMediatorWebsite.trim()),
      required: legal.b2cAudience,
      detail: !legal.b2cAudience
        ? 'Activité uniquement B2B (entreprises) : médiateur conso non requis.'
        : legal.consumerMediatorName.trim() && legal.consumerMediatorWebsite.trim()
          ? `Médiateur B2C renseigné : ${legal.consumerMediatorName}.`
          : 'Obligatoire si le client vend à des particuliers (Art. L.616-1 Code de la consommation, amende DGCCRF jusqu’à 3 000 € / 15 000 €).',
    },
    {
      id: 'cookies-rights',
      label: 'Cookies / Traceurs (CNIL) & Droits des visuels',
      ok: Boolean(
        (!legal.usesCookiesOrTrackers || legal.analyticsTool.trim()) &&
          legal.mediaRightsConfirmed
      ),
      required: true,
      detail: !legal.mediaRightsConfirmed
        ? 'Faites confirmer au patron qu’il possède les droits sur son logo et ses photos.'
        : legal.usesCookiesOrTrackers
          ? 'Des cookies/traceurs tiers sont utilisés : un bandeau de consentement CNIL (Accepter/Refuser) est obligatoire.'
          : 'Mesure sans cookies (conforme CNIL sans bandeau) et droits médias confirmés.',
    },
  ];

  const applicableChecks = checks.filter((c) => c.required || c.ok);
  const score = applicableChecks.filter((c) => c.ok).length;
  const total = applicableChecks.length;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;
  const missingLabels = checks.filter((c) => c.required && !c.ok).map((c) => c.label);

  return {
    score,
    total,
    percent,
    isFullyCompliant: missingLabels.length === 0,
    checks,
    missingLabels,
  };
}

export function generateLegalNoticeText(
  project: Pick<ClientProject, 'clientName' | 'contactEmail' | 'contactPhone' | 'legal'>
): string {
  const l = createDefaultLegalInfo(project.legal);
  const company = l.legalCompanyName.trim() || project.clientName.trim() || '[Raison sociale / Nom Prénom]';
  const eiSuffix =
    l.legalForm === 'EI / Micro-entrepreneur' && !company.toLowerCase().includes('entrepreneur individuel')
      ? ' (Entrepreneur individuel)'
      : '';
  const capitalPart =
    SOCIETE_FORMS_REQUIRING_CAPITAL.includes(l.legalForm) && l.shareCapitalEur.trim()
      ? ` au capital social de ${l.shareCapitalEur.trim()} €`
      : '';
  const sirenValue = cleanDigits(l.siren) || (cleanDigits(l.siret).length >= 9 ? cleanDigits(l.siret).slice(0, 9) : '');
  const siretValue = cleanDigits(l.siret);
  const contactMail = project.contactEmail.trim() || l.privacyControllerEmail.trim() || '[e-mail]';
  const rgpdMail = l.privacyControllerEmail.trim() || contactMail;
  const phone = project.contactPhone.trim() || '[téléphone]';

  const lines: string[] = [
    `MENTIONS LÉGALES — ${company.toUpperCase()}`,
    `Conformément aux dispositions de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN) :`,
    '',
    `1. ÉDITEUR DU SITE`,
    `Raison sociale / Nom : ${company}${eiSuffix}`,
    `Forme juridique : ${l.legalForm}${capitalPart}`,
    `Adresse du siège / établissement : ${l.registeredAddress.trim() || '[Adresse complète]'}`,
    `Téléphone : ${phone} · E-mail : ${contactMail}`,
    sirenValue ? `SIREN : ${sirenValue}` : 'SIREN : [9 chiffres]',
    siretValue ? `SIRET : ${siretValue}` : 'SIRET : [14 chiffres]',
    `Immatriculation (RCS / RNE / RNA) : ${l.registrationNumber.trim() || '[À compléter]'}`,
    `TVA : ${l.vatNumber.trim() || 'TVA non applicable, art. 293 B du CGI'}`,
    `Directeur de la publication : ${l.publicationDirector.trim() || '[Nom et prénom du responsable]'}`,
  ];

  if (l.regulatedProfessionDetails.trim()) {
    lines.push(`Activité réglementée / Assurance : ${l.regulatedProfessionDetails.trim()}`);
  }

  lines.push(
    '',
    `2. HÉBERGEMENT DU SITE`,
    `Hébergeur : ${l.hostingProviderName.trim() || l.hostingProvider}`,
    `Adresse : ${l.hostingProviderAddress.trim() || '[Adresse de l’hébergeur]'}`,
    `Contact : ${l.hostingProviderPhone.trim() || '[Téléphone / Support de l’hébergeur]'}`,
    '',
    `3. PROPRIÉTÉ INTELLECTUELLE`,
    `L’ensemble des contenus présents sur ce site (textes, photographies, logo, graphismes) appartient à ${company} ou fait l’objet d’une autorisation d’utilisation. Toute reproduction sans accord écrit préalable est interdite.`
  );

  if (l.b2cAudience) {
    lines.push(
      '',
      `4. MÉDIATION DE LA CONSOMMATION (ART. L.616-1 DU CODE DE LA CONSOMMATION)`,
      `En cas de litige non résolu avec notre service client, tout consommateur a le droit de recourir gratuitement à un médiateur de la consommation :`,
      `Médiateur : ${l.consumerMediatorName.trim() || '[Nom du médiateur à renseigner]'}`,
      `Site web : ${l.consumerMediatorWebsite.trim() || '[URL du médiateur]'}`,
      l.consumerMediatorAddress.trim()
        ? `Adresse postale : ${l.consumerMediatorAddress.trim()}`
        : `Adresse postale : [Adresse du médiateur]`
    );
  }

  lines.push(
    '',
    `${l.b2cAudience ? '5' : '4'}. POLITIQUE DE CONFIDENTIALITÉ (RGPD) & COOKIES`,
    `Responsable du traitement : ${company} (${rgpdMail}).`,
    l.hasContactForm
      ? `Finalité et base légale : Les données saisies dans le formulaire de contact/devis servent uniquement à répondre à votre demande (intérêt légitime / mesures précontractuelles).`
      : `Données collectées : Ce site ne comporte pas de formulaire de collecte directe.`,
    `Durée de conservation : ${l.dataRetentionMonths.trim() || '36 mois'} maximum après le dernier échange.`,
    `Vos droits : Conformément au RGPD, vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation et d’opposition en écrivant à ${rgpdMail}, ainsi que du droit d’introduire une réclamation auprès de la CNIL (cnil.fr).`,
    l.usesCookiesOrTrackers
      ? `Cookies : Ce site utilise ${l.analyticsTool.trim() || 'des traceurs de mesure d’audience'}. Vous pouvez accepter ou refuser les cookies non essentiels à tout moment via le bandeau dédié.`
      : `Cookies : Ce site utilise ${l.analyticsTool.trim() || 'une mesure d’audience sans cookies'} ne déposant aucun traceur publicitaire ou de suivi personnel sur votre appareil.`
  );

  return lines.join('\n');
}

export function generateLegalNoticeHtml(
  project: Pick<ClientProject, 'clientName' | 'contactEmail' | 'contactPhone' | 'legal'>
): string {
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const lines = generateLegalNoticeText(project).split('\n');
  const blocks = lines
    .map((line) => {
      if (!line.trim()) return '';
      if (/^(MENTIONS LÉGALES|[1-5]\. )/.test(line)) {
        return `  <h3>${escapeHtml(line)}</h3>`;
      }
      return `  <p>${escapeHtml(line)}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<section id="mentions-legales" aria-labelledby="mentions-title">\n  <h2 id="mentions-title">Mentions légales & Confidentialité</h2>\n${blocks}\n</section>`;
}
