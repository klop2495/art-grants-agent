import type { OpportunityPayload } from './types.js';

function normalizeDeadline(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === 'TBD') return null;
  return trimmed;
}

function transformPayload(payload: OpportunityPayload) {
  const normalizedDeadline = normalizeDeadline(payload.application_deadline);

  return {
    external_id: payload.external_id,
    title: payload.title,
    summary: payload.summary,
    content: payload.content,
    program_type: payload.program_type,
    organization_name: payload.organization_name,
    location: payload.location,
    country: payload.country,
    city: payload.city,
    funding_amount: payload.funding_amount,
    participation_cost: payload.participation_cost,
    application_deadline: normalizedDeadline,
    program_dates: payload.program_dates,
    eligibility: payload.eligibility,
    disciplines: payload.disciplines,
    requirements: payload.requirements,
    benefits: payload.benefits,
    link_to_apply: payload.link_to_apply,
    contact_email: payload.contact_email,
    language: payload.language,
    source: payload.source,
    fact_check: payload.fact_check,
  };
}

interface IngestResult {
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
  id?: string;
}

export async function sendOpportunityToPlatform(payload: OpportunityPayload): Promise<IngestResult> {
  const endpoint = process.env.GRANTS_INGEST_ENDPOINT_URL;
  const apiKey = process.env.GRANTS_INGEST_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('GRANTS_INGEST_ENDPOINT_URL or GRANTS_INGEST_API_KEY is missing');
  }

  const body = transformPayload(payload);

  console.log(`   [Ingest] Sending opportunity...`);
  console.log(`   [Ingest] Title: ${body.title}`);
  console.log(`   [Ingest] External ID: ${body.external_id}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`   [Ingest] ❌ Failed ${res.status}: ${text}`);
    throw new Error(`Ingest failed: ${res.statusText}`);
  }

  const json = await res.json().catch(() => ({}));
  const apiAction = json.action ?? 'created';

  const result: IngestResult = {
    success: true,
    action: apiAction === 'skipped' ? 'skipped' : (apiAction as 'created' | 'updated'),
  };

  if (json.reason) {
    result.reason = json.reason;
  }

  const opportunityId = json.opportunity?.id;
  if (opportunityId) {
    result.id = opportunityId;
  }

  if (result.action === 'skipped') {
    console.log(`   [Ingest] ⏭️  Skipped - ${result.reason || 'unknown reason'}`);
    return result;
  }

  console.log(`   [Ingest] ✅ ${result.action} - Opportunity ID: ${result.id ?? 'N/A'}`);

  return result;
}
