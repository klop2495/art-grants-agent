import type { OpportunityPayload } from './types.js';

function transformPayload(payload: OpportunityPayload) {
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
    application_deadline: payload.application_deadline,
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

export async function sendOpportunityToPlatform(payload: OpportunityPayload): Promise<void> {
  const endpoint = process.env.GRANTS_INGEST_ENDPOINT_URL;
  const apiKey = process.env.GRANTS_INGEST_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('GRANTS_INGEST_ENDPOINT_URL or GRANTS_INGEST_API_KEY is missing');
  }

  const body = transformPayload(payload);

  console.log(`   [Ingest] Payload summary length: ${body.summary?.length || 0}`);

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
  console.log(
    `   [Ingest] ✅ ${json.action ?? 'created'} - Opportunity ID: ${json.opportunity?.id ?? 'N/A'}`,
  );
}

