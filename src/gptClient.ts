import OpenAI from 'openai';
import { z } from 'zod';
import type { OpportunityPayload, RawOpportunity } from './types.js';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const ApplicationDeadlineSchema = z
  .string()
  .transform((value) => value.trim())
  .superRefine((value, ctx) => {
    if (value.toUpperCase() === 'TBD') {
      return;
    }

    if (Number.isNaN(Date.parse(value))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'application_deadline must be ISO 8601 date or "TBD"',
      });
    }
  });

const OpportunitySchema = z.object({
  external_id: z.string().optional(), // will be injected after parsing
  title: z.string().min(10).max(280),
  summary: z.string().min(50).max(600),
  content: z.string().min(200),
  program_type: z.enum([
    'grant',
    'residency',
    'open_call',
    'fellowship',
    'competition',
    'fair_exhibition',
  ]),
  organization_name: z.string().min(3),
  location: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  funding_amount: z.string().optional(),
  participation_cost: z.string().optional(),
  application_deadline: ApplicationDeadlineSchema,
  program_dates: z
    .object({
      start_date: z
        .string()
        .refine((value) => !Number.isNaN(Date.parse(value)), {
          message: 'start_date must be ISO 8601 date',
        })
        .optional(),
      end_date: z
        .string()
        .refine((value) => !Number.isNaN(Date.parse(value)), {
          message: 'end_date must be ISO 8601 date',
        })
        .optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  eligibility: z.array(z.string()).optional(),
  disciplines: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  link_to_apply: z.string().url().optional(),
  contact_email: z.string().email().optional(),
  language: z.string().optional(),
  source: z.object({
    name: z.string(),
    url: z.string().url(),
  }),
  fact_check: z
    .object({
      confidence: z.enum(['verified', 'official_single_source', 'low_confidence']),
      notes: z.string().optional(),
    })
    .optional(),
});

const SYSTEM_PROMPT = `
You are an editorial assistant collecting professional opportunities for artists and cultural workers.

Your job:
1. Transform opportunity announcements (grants, residencies, fairs, open calls) into structured English-language briefs.
2. Preserve all factual information: eligibility, deadlines, location, funding, fees, organisers, how to apply.
3. Output STRICT JSON matching the OpportunityPayload schema.

CRITICAL RULES
- NEVER invent details, amounts, or dates.
- ALWAYS include application_deadline.
- Preferred format is ISO 8601 (YYYY-MM-DD). If the source does not state a deadline at all, output the literal string "TBD".
- If deadline text is ambiguous, infer the closest precise date (e.g., "15 January 2026") using the source context.
- Highlight whether the programme requires fees or offers funding.
- Use neutral tone; remove promotional language.
- Extract eligibility (individuals / collectives / by region) as bullet points.
- Source info (name + URL) must reference the originating organisation page.
- If the announcement is clearly outdated (deadline in the past), set fact_check.notes = "outdated" and leave other fields as-is.
- fact_check.confidence MUST be one of: "verified", "official_single_source", "low_confidence". Default to "official_single_source" when unsure.
- Examine ALL sections of the provided HTML (not just the opening paragraphs); opportunities can appear anywhere on the page.

CATEGORY MAPPING
- grants, funds, awards → "grant"
- residencies, labs, studios → "residency"
- general call for artists, proposals → "open_call"
- scholarships, fellowships → "fellowship"
- contests, prizes → "competition"
- art fairs, biennials, showcase slots → "fair_exhibition"

OUTPUT QUALITY
- Title: informative headline summarising the offering and organisation.
- Summary: 2–3 sentences summarising eligibility and key benefits.
- Content: full article-style description (HTML paragraphs <p>...).
- Use English even if the source is another language (translate neutrally).
`;

export async function generateOpportunityPayload(
  rawOpportunity: RawOpportunity,
  retries = 3,
): Promise<OpportunityPayload | null> {
  const defaultLanguage = process.env.DEFAULT_LANGUAGE ?? 'en';
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  const userPrompt = `
Transform the opportunity announcement below into JSON.

Context:
- Source: ${rawOpportunity.sourceName}
- URL: ${rawOpportunity.url}
- Target language: ${defaultLanguage}

REQUIRED FIELDS:
- title, summary, content (HTML paragraphs)
- program_type, organization_name
- application_deadline (ISO)
- source { name, url }

IMPORTANT:
- Use ISO 8601 dates (YYYY-MM-DD). If no deadline is provided, return "TBD".
- If programme dates are mentioned, fill program_dates.start/end.
- Provide list arrays for eligibility/requirements/benefits when possible.
- link_to_apply should be the explicit application URL if present.
- fact_check.confidence MUST be "verified", "official_single_source", or "low_confidence" (no other values).
- Ensure the entire document is scanned; opportunities might be embedded deep in the page.

Raw HTML (truncated to 30k chars):
---
${rawOpportunity.html.substring(0, 30000)}${rawOpportunity.html.length > 30000 ? '\n...(truncated)' : ''}
---

Return ONLY valid JSON.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        console.error('[GPT] Empty response');
        return null;
      }

      const parsed = JSON.parse(content);
      parsed.external_id = rawOpportunity.externalId;
      const validated = OpportunitySchema.parse(parsed) as OpportunityPayload;

      console.log(
        `   [GPT] ✓ Validated: "${validated.title.slice(0, 60)}..." deadline ${validated.application_deadline}`,
      );
      return validated;
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error('   [GPT] Validation errors:', error.issues);
      } else {
        console.error(`   [GPT] Error (attempt ${attempt}/${retries}):`, error.message);
      }

      if (attempt === retries) {
        return null;
      }

      const wait = Math.pow(2, attempt) * 1000;
      console.warn(`   [GPT] Retrying in ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  return null;
}

