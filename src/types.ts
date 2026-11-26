export type AgencyRole =
  | 'Chef de projet'
  | 'Designer'
  | 'Développeur'
  | 'Commercial'
  | 'Rédacteur';

export type ProjectStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type OfferTier = 'Départ' | 'Standard' | 'Suivi';

export type TaskColumn = 'À faire' | 'En cours' | 'À valider' | 'Terminé';

export type BillingFramework =
  | 'Facturation via parent'
  | 'Micro-entreprise (accord parental)'
  | 'Association loi 1901';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  role: AgencyRole;
  weeklyHours: number;
  maxWeeklyHours: number;
  parentApproved: boolean;
  parentName: string;
  schoolPriorityOk: boolean;
}

export interface ProjectBrief {
  activitySummary: string;
  targetClients: string;
  desiredPages: string;
  inspirationSites: string;
  existingAssets: string;
  hoursAddressPhone: string;
  primaryVisitorAction: string;
  budgetRange: string;
}

export type LegalFormType =
  | 'EI / Micro-entrepreneur'
  | 'SARL'
  | 'EURL'
  | 'SAS'
  | 'SASU'
  | 'SCI'
  | 'Association loi 1901'
  | 'Autre';

export type HostingProviderPreset =
  | 'Netlify'
  | 'GitHub Pages'
  | 'Cloudflare Pages'
  | 'Framer'
  | 'OVHcloud'
  | 'Render'
  | 'Autre';

export interface ProjectLegalInfo {
  legalForm: LegalFormType;
  legalCompanyName: string;
  publicationDirector: string;
  siren: string;
  siret: string;
  shareCapitalEur: string;
  registrationNumber: string;
  vatNumber: string;
  registeredAddress: string;
  b2cAudience: boolean;
  consumerMediatorName: string;
  consumerMediatorWebsite: string;
  consumerMediatorAddress: string;
  regulatedProfessionDetails: string;
  hostingProvider: HostingProviderPreset;
  hostingProviderName: string;
  hostingProviderAddress: string;
  hostingProviderPhone: string;
  domainRegistrar: string;
  customDomain: string;
  hasContactForm: boolean;
  privacyControllerEmail: string;
  dataRetentionMonths: string;
  usesCookiesOrTrackers: boolean;
  analyticsTool: string;
  hasEcommerceOrPrices: boolean;
  mediaRightsConfirmed: boolean;
  portfolioAuthorization: boolean;
}

export interface ProjectQualityChecks {
  aiCopyReviewed: boolean;
  mobileTested: boolean;
  imageRightsVerified: boolean;
  legalMentionsAdded: boolean;
  privacyPolicyAdded: boolean;
  cookieComplianceChecked: boolean;
  mediatorAddedIfB2C: boolean;
  seoLocalMetaReady: boolean;
}

export interface ProjectIntegrations {
  githubRepo?: string;
  netlifySiteId?: string;
  netlifyUrl?: string;
  figmaFileKey?: string;
  driveFolderId?: string;
  googleFormId?: string;
  discordChannelName?: string;
  googleBusinessReady?: boolean;
}

export interface ClientProject {
  id: string;
  clientName: string;
  sector: string;
  isDemo: boolean;
  step: ProjectStep;
  offerTier: OfferTier;
  totalPriceEur: number;
  depositPaidEur: number;
  balancePaidEur: number;
  revisionsIncluded: number;
  deliveryTargetDate: string;
  ownerMemberId: string;
  commercialMemberId: string;
  contactEmail: string;
  contactPhone: string;
  brief: ProjectBrief;
  legal: ProjectLegalInfo;
  qualityChecks: ProjectQualityChecks;
  integrations: ProjectIntegrations;
  generatedHtml: string;
  followUp30Done: boolean;
  googleReviewRequested: boolean;
  notes: string;
  updatedAt: string;
}

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  column: TaskColumn;
  assigneeMemberId: string;
  dueDate: string;
}

export interface AgencyAppointment {
  id: string;
  title: string;
  type: 'Client (20 min)' | 'Maquette' | 'Livraison' | 'Réunion Lundi (15 min)' | 'Point Discord Mercredi (5 min)' | 'Bilan Dimanche';
  dateIso: string;
  durationMin: number;
  projectId?: string;
  attendeeIds: string[];
  notes: string;
  googleCalendarEventId?: string;
}

export interface Prospect {
  id: string;
  businessName: string;
  category: 'Commerce' | 'Club / Association' | 'Artisan / Indépendant' | 'Entourage';
  cityArea: string;
  currentSiteStatus: 'Aucun site' | 'Site ancien / non mobile';
  contactChannel: 'Sur place' | 'E-mail' | 'Téléphone' | 'Entourage';
  contactEmail: string;
  phone: string;
  status: 'À contacter' | 'Premier message envoyé' | 'Relance J+5 à faire' | 'RDV fixé' | 'Devis envoyé' | 'Gagné' | 'Perdu';
  lastContactDate: string;
  assignedMemberId: string;
  notes: string;
}

export interface FinanceEntry {
  id: string;
  projectId: string;
  clientName: string;
  label: string;
  amountEur: number;
  type: 'Acompte 30 %' | 'Solde' | 'Suivi mensuel' | 'Dépense caisse commune';
  status: 'Devis signé' | 'Payé' | 'En attente';
  invoiceRef: string;
  billingParentOrEntity: string;
  commercialMemberId?: string;
  date: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface RoadmapWeek {
  id: string;
  weekNumber: 1 | 2 | 3 | 4;
  title: string;
  tasks: ChecklistItem[];
}

export interface AgencySettings {
  agencyName: string;
  city: string;
  billingFramework: BillingFramework;
  discordWebhookUrl: string;
  defaultGoogleFormId: string;
  defaultDriveFolderId: string;
  teamRulesAccepted: boolean;
  revenueSplitWritten: boolean;
  currentMonthLabel: string;
  allowedEmails: string[];
  adminEmails: string[];
  lockEnabled: boolean;
}

export interface AgencyState {
  settings: AgencySettings;
  members: TeamMember[];
  projects: ClientProject[];
  tasks: KanbanTask[];
  appointments: AgencyAppointment[];
  prospects: Prospect[];
  finances: FinanceEntry[];
  preSaleChecklist: ChecklistItem[];
  roadmap: RoadmapWeek[];
}

export interface ThirdPartyProviderStatus {
  provider: 'github' | 'discord' | 'figma' | 'netlify';
  configured: boolean;
  connected: boolean;
  accountName?: string;
  accountHandle?: string;
  avatarUrl?: string;
  callbackUrlDev: string;
  callbackUrlShared: string;
}
