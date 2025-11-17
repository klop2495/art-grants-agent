export type ProgramType =
  | 'grant'
  | 'residency'
  | 'open_call'
  | 'fellowship'
  | 'competition'
  | 'fair_exhibition';

export interface RawOpportunity {
  url: string;
  html: string;
  sourceName: string;
  externalId: string;
}

export interface OpportunityPayload {
  external_id: string;
  title: string;
  summary: string;
  content: string;

  program_type: ProgramType;
  organization_name: string;
  location?: string;
  country?: string;
  city?: string;

  funding_amount?: string;
  participation_cost?: string;

  application_deadline: string; // ISO 8601
  program_dates?: {
    start_date?: string;
    end_date?: string;
    timezone?: string;
  };

  eligibility?: string[];
  disciplines?: string[];
  requirements?: string[];
  benefits?: string[];

  link_to_apply?: string;
  contact_email?: string;
  language?: string;

  source?: {
    name: string;
    url: string;
  };

  fact_check?: {
    confidence: 'verified' | 'official_single_source' | 'low_confidence';
    notes?: string;
  };
}

