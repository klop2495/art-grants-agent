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

/**
 * Checks if opportunity exists and whether it was deleted by user
 */
async function checkOpportunityStatus(
  externalId: string,
  endpoint: string,
  apiKey: string,
): Promise<{ exists: boolean; isDeleted: boolean; id?: string }> {
  try {
    // Remove /ingest from endpoint for GET request
    const baseEndpoint = endpoint.replace(/\/ingest$/, '');
    const checkUrl = `${baseEndpoint}/ingest?external_id=${encodeURIComponent(externalId)}`;

    const res = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (res.status === 404) {
      return { exists: false, isDeleted: false };
    }

    if (!res.ok) {
      console.warn(`   [Ingest] Warning: Could not check status (${res.status}), will attempt to send`);
      return { exists: false, isDeleted: false };
    }

    const json = await res.json();
    
    // Check if record was deleted
    if (json.opportunity) {
      const isDeleted = json.opportunity.deleted_at !== null;
      return {
        exists: true,
        isDeleted: isDeleted,
        id: json.opportunity.id,
      };
    }

    return { exists: false, isDeleted: false };
  } catch (error: any) {
    console.warn(`   [Ingest] Warning: Status check failed: ${error.message}`);
    return { exists: false, isDeleted: false };
  }
}

export async function sendOpportunityToPlatform(payload: OpportunityPayload): Promise<{
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
  id?: string;
}> {
  const endpoint = process.env.GRANTS_INGEST_ENDPOINT_URL;
  const apiKey = process.env.GRANTS_INGEST_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('GRANTS_INGEST_ENDPOINT_URL or GRANTS_INGEST_API_KEY is missing');
  }

  // STEP 1: Check if record exists and was deleted
  const status = await checkOpportunityStatus(payload.external_id, endpoint, apiKey);

  if (status.exists && status.isDeleted) {
    console.log(`   [Ingest] ⏭️  Skipped - Record was deleted by user (ID: ${status.id ?? 'unknown'})`);
    return {
      success: true,
      action: 'skipped',
      reason: 'deleted_by_user',
      id: status.id ?? undefined,
    };
  }

  // STEP 2: Send data (create or update)
  const body = transformPayload(payload);

  console.log(`   [Ingest] ${status.exists ? 'Updating' : 'Creating'} opportunity...`);
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
  const action = json.action ?? (status.exists ? 'updated' : 'created');
  
  console.log(
    `   [Ingest] ✅ ${action} - Opportunity ID: ${json.opportunity?.id ?? status.id ?? 'N/A'}`,
  );

  return {
    success: true,
    action: action,
    id: json.opportunity?.id ?? status.id ?? undefined,
  };
}
