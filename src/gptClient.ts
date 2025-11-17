import OpenAI from 'openai';
import { z } from 'zod';
import type { OpportunityPayload, RawOpportunity } from './types.js';
import { preprocessHTML } from './htmlPreprocessor.js';

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
You are a specialized agent for extracting structured information about grants and residencies for artists from web pages.

YOUR TASK:
Analyze HTML content from organization pages and extract the following data:

1. FUNDING (funding_amount):
   - Look for mentions of grant amounts, stipends, allowances
   - Formats: €1,200/month, $50,000 total, £15,000 grant
   - Keywords: stipend, grant, funding, allowance, support, scholarship, award
   - If "free", "no fee", "no cost" → "Free"
   - If no information → "Not specified"

2. PARTICIPATION COST (participation_cost):
   - Look for: application fee, residency fee, rent, cost
   - Distinguish: application fee (submission fee) vs residency fee (accommodation cost)
   - Keywords: fee, cost, rent, subsidized, free, no charge
   - If "no fee" or "free" → "Free"
   - If no information → "Not specified"

3. APPLICATION LINK (link_to_apply):
   - Look for buttons/links: "Apply", "Submit", "Application Form", "Call for Applications"
   - Check text for URL mentions
   - Priority: direct links to application forms
   - If none → "Not specified"

4. CONTACT EMAIL (contact_email):
   - Extract all email addresses, especially those related to:
     * applications, admissions, residency, info, contact
   - Format: example@domain.com
   - If multiple emails - choose most relevant (admissions > info)
   - If none → leave empty

5. DEADLINE (application_deadline):
   - REQUIRED field
   - Preferred format: ISO 8601 (YYYY-MM-DD)
   - If no deadline stated, return "TBD"

6. DURATION:
   - Look for program length: "3 months", "6 weeks", "1 year"
   - Include in content or as separate note

7. ELIGIBILITY:
   - Extract requirements: age, nationality, experience level
   - Format as array of strings

CRITICAL RULES:
- If information is not explicitly found → write "Not specified" (for funding/fees/link), DO NOT invent
- Distinguish application fee from residency costs
- Consider context: "no fee" for residency ≠ "no stipend"
- If amount is a range ("up to $5,000") - specify this
- Scan the ENTIRE document; opportunities can be anywhere on the page
- fact_check.confidence: 1.0 = explicitly stated, 0.5 = extracted from context, 0.0 = not found

CATEGORY MAPPING:
- grants, funds, awards → "grant"
- residencies, labs, studios → "residency"
- general call for artists, proposals → "open_call"
- scholarships, fellowships → "fellowship"
- contests, prizes → "competition"
- art fairs, biennials, showcase slots → "fair_exhibition"

OUTPUT FORMAT:
Always return JSON with:
- title, summary, content (HTML paragraphs)
- program_type, organization_name
- funding_amount, participation_cost, link_to_apply, contact_email
- application_deadline (ISO or "TBD")
- eligibility, disciplines, requirements, benefits (arrays)
- source { name, url }
- fact_check { confidence: "verified" | "official_single_source" | "low_confidence", notes }

Use English even if source is in another language (translate neutrally).
`;

export async function generateOpportunityPayload(
  rawOpportunity: RawOpportunity,
  retries = 3,
): Promise<OpportunityPayload | null> {
  const defaultLanguage = process.env.DEFAULT_LANGUAGE ?? 'en';
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  // Предобработка HTML
  const preprocessed = preprocessHTML(rawOpportunity.html, rawOpportunity.url);

  // Формируем дополнительный контекст для GPT
  let additionalContext = '';

  if (preprocessed.extractedLinks.applyLinks.length > 0) {
    additionalContext += `\n\nEXTRACTED APPLICATION LINKS:\n${preprocessed.extractedLinks.applyLinks.join('\n')}`;
  }

  if (preprocessed.extractedEmails.length > 0) {
    additionalContext += `\n\nEXTRACTED EMAILS:\n${preprocessed.extractedEmails.join(', ')}`;
  }

  if (preprocessed.keyBlocks.funding) {
    additionalContext += `\n\nFUNDING INFO BLOCK:\n${preprocessed.keyBlocks.funding}`;
  }

  if (preprocessed.keyBlocks.fees) {
    additionalContext += `\n\nFEES INFO BLOCK:\n${preprocessed.keyBlocks.fees}`;
  }

  if (preprocessed.keyBlocks.deadline) {
    additionalContext += `\n\nDEADLINE INFO BLOCK:\n${preprocessed.keyBlocks.deadline}`;
  }

  const userPrompt = `
Analyze this web page and extract opportunity information into JSON.

Context:
- Source: ${rawOpportunity.sourceName}
- URL: ${rawOpportunity.url}
- Target language: ${defaultLanguage}

REQUIRED FIELDS:
- title, summary, content (HTML paragraphs)
- program_type, organization_name
- application_deadline (ISO or "TBD")
- source { name, url }

CRITICAL - EXTRACT THESE FINANCIAL/CONTACT FIELDS:
1. funding_amount: Look for grant/stipend amounts (€1,200/month, $50,000, etc.)
   - If "free" or "no cost" → "Free"
   - If not found → "Not specified"

2. participation_cost: Look for application fees, residency fees, rent
   - Distinguish application fee vs accommodation cost
   - If "no fee" → "Free"
   - If not found → "Not specified"

3. link_to_apply: Find "Apply", "Submit", "Application Form" buttons/links
   - Must be actual URL
   - If not found → "Not specified"

4. contact_email: Extract email addresses (admissions@, info@, applications@)
   - Choose most relevant if multiple
   - If not found → leave empty

5. eligibility: Extract requirements (nationality, age, experience)
   - Format as array of strings

6. disciplines: Extract art disciplines (visual arts, music, literature, etc.)
   - Format as array of strings

IMPORTANT:
- Use ISO 8601 dates (YYYY-MM-DD). If no deadline is provided, return "TBD".
- If programme dates are mentioned, fill program_dates.start/end.
- Provide list arrays for eligibility/requirements/benefits/disciplines when possible.
- fact_check.confidence MUST be "verified", "official_single_source", or "low_confidence" (no other values).
- Scan the ENTIRE document; opportunities can be anywhere on the page.
- DO NOT invent data - if not found, use "Not specified" or leave empty.

Raw HTML (truncated to 25k chars):
---
${rawOpportunity.html.substring(0, 25000)}${rawOpportunity.html.length > 25000 ? '\n...(truncated)' : ''}
---
${additionalContext}

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

      // Обогащение данными из предобработки, если GPT не нашел
      if (
        (!parsed.link_to_apply || parsed.link_to_apply === 'Not specified') &&
        preprocessed.extractedLinks.applyLinks.length > 0
      ) {
        parsed.link_to_apply = preprocessed.extractedLinks.applyLinks[0];
      }

      if (!parsed.contact_email && preprocessed.extractedEmails.length > 0) {
        parsed.contact_email = preprocessed.extractedEmails[0];
      }

      const validated = OpportunitySchema.parse(parsed) as OpportunityPayload;

      // Расчет completeness_score
      const completeness = calculateCompletenessScore(validated);

      console.log(
        `   [GPT] ✓ Validated: "${validated.title.slice(0, 60)}..." deadline ${validated.application_deadline} | completeness: ${(completeness * 100).toFixed(0)}%`,
      );

      // Добавляем note, если completeness низкий
      if (completeness < 0.5 && validated.fact_check) {
        validated.fact_check.notes = `Low completeness (${(completeness * 100).toFixed(0)}%). ${validated.fact_check.notes || ''}`.trim();
      }

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

/**
 * Рассчитывает полноту данных (0.0 - 1.0)
 * Проверяет наличие ключевых полей
 */
function calculateCompletenessScore(payload: OpportunityPayload): number {
  const criticalFields = [
    'funding_amount',
    'participation_cost',
    'link_to_apply',
    'contact_email',
    'eligibility',
    'disciplines',
    'country',
    'city',
  ];

  let foundCount = 0;
  const totalFields = criticalFields.length;

  // funding_amount
  if (payload.funding_amount && payload.funding_amount !== 'Not specified') {
    foundCount++;
  }

  // participation_cost
  if (payload.participation_cost && payload.participation_cost !== 'Not specified') {
    foundCount++;
  }

  // link_to_apply
  if (payload.link_to_apply && payload.link_to_apply !== 'Not specified') {
    foundCount++;
  }

  // contact_email
  if (payload.contact_email) {
    foundCount++;
  }

  // eligibility
  if (payload.eligibility && payload.eligibility.length > 0) {
    foundCount++;
  }

  // disciplines
  if (payload.disciplines && payload.disciplines.length > 0) {
    foundCount++;
  }

  // country
  if (payload.country) {
    foundCount++;
  }

  // city
  if (payload.city) {
    foundCount++;
  }

  return foundCount / totalFields;
}

