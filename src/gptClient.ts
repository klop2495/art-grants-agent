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
  title: z.string().min(3).max(280),
  summary: z.string().min(50).max(600),
  content: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val.join('\n\n') : val))
    .pipe(z.string().min(200)),
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
  link_to_apply: z
    .string()
    .refine(
      (val) => {
        if (!val || val === 'Not specified') return true;
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'link_to_apply must be valid URL or "Not specified"' },
    )
    .optional(),
  contact_email: z
    .string()
    .refine(
      (val) => {
        if (!val || val === '' || val === 'Not specified') return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      },
      { message: 'contact_email must be valid email or empty string' },
    )
    .optional(),
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
You are a specialized AI agent that extracts structured information about art grants and residencies from web pages.

YOUR TASK:
Extract the following information and return it as valid JSON.

CRITICAL FORMAT REQUIREMENTS:
1. "content" MUST be a SINGLE STRING, NOT an array
2. "content" must be at least 200 characters long
3. "summary" must be at least 50 characters long
4. "link_to_apply" must be a COMPLETE URL starting with http:// or https://, OR "Not specified"
5. "contact_email" must be a VALID email format (user@domain.com), OR empty string if not found
6. NEVER return arrays in string fields
7. NEVER return empty strings for required fields - use "Not specified" instead

FIELDS TO EXTRACT:
{
  "title": "Grant/Residency name (string)",
  "summary": "Brief description (minimum 50 characters, string)",
  "content": "Full detailed description as a SINGLE STRING (minimum 200 characters). Merge all paragraphs into ONE continuous string with \\n\\n between paragraphs.",
  "program_type": "grant|residency|open_call|fellowship|competition|fair_exhibition",
  "organization_name": "Organization name (string)",
  "country": "Country (string or null)",
  "city": "City (string or null)",
  "location": "Full location string (string or null)",
  "funding_amount": "Grant amount (e.g., '€1,200/month', '$50,000', 'Free') or 'Not specified'",
  "participation_cost": "Application/residency fees (e.g., '$30 application fee', 'Free') or 'Not specified'",
  "application_deadline": "ISO 8601 date (YYYY-MM-DD) or 'TBD'",
  "program_dates": {
    "start_date": "ISO 8601 date or null",
    "end_date": "ISO 8601 date or null",
    "timezone": "string or null"
  },
  "eligibility": ["requirement1", "requirement2"] or [],
  "disciplines": ["visual arts", "music", etc.] or [],
  "requirements": ["requirement1"] or [],
  "benefits": ["benefit1"] or [],
  "link_to_apply": "FULL URL (https://...) or 'Not specified'",
  "contact_email": "valid@email.com or empty string",
  "language": "en",
  "source": {
    "name": "Organization name",
    "url": "Source URL"
  },
  "fact_check": {
    "confidence": "verified" | "official_single_source" | "low_confidence",
    "notes": "optional notes"
  }
}

EXTRACTION RULES:
1. FUNDING (funding_amount):
   - Look for: grant amounts, stipends, allowances, scholarships
   - Examples: "€1,200/month", "$50,000 total", "£2,000-£10,000"
   - If "free" or "no cost" → "Free"
   - If not found → "Not specified"

2. PARTICIPATION COST (participation_cost):
   - Look for: application fee, residency fee, rent
   - Distinguish: application fee vs accommodation cost
   - If "no fee" or "free" → "Free"
   - If not found → "Not specified"

3. APPLICATION LINK (link_to_apply):
   - Look for: "Apply", "Submit", "Application Form" buttons/links
   - MUST be complete URL starting with http:// or https://
   - If you see "Apply" mentioned but no URL, return "Not specified"
   - If not found → "Not specified"

4. CONTACT EMAIL (contact_email):
   - Search for: info@, contact@, applications@, admissions@, enquiries@
   - MUST be valid email format
   - If not found → return empty string ""

5. CONTENT formatting:
   - Merge all paragraphs into ONE string
   - Use \\n\\n to separate paragraphs
   - Remove excessive whitespace
   - Minimum 200 characters

EXAMPLE VALID OUTPUT:
{
  "title": "DYCP - Develop Your Creative Practice",
  "summary": "The Develop Your Creative Practice grant supports individuals to take time to focus on their creative development and research.",
  "content": "The Develop Your Creative Practice (DYCP) grant is designed for individual creative practitioners to take time out to research, develop skills, explore new ideas, and develop their creative practice.\\n\\nYou can apply for between £2,000 and £10,000 to support a specific period of development and research activity. The funding can be used for training, research trips, mentorships, or time to develop new work.",
  "program_type": "grant",
  "organization_name": "Arts Council England",
  "country": "United Kingdom",
  "city": "London",
  "funding_amount": "£2,000 - £10,000",
  "participation_cost": "Free",
  "application_deadline": "2025-01-28",
  "link_to_apply": "https://www.artscouncil.org.uk/apply-for-a-grant",
  "contact_email": "enquiries@artscouncil.org.uk",
  "disciplines": ["visual arts", "performing arts", "literature"],
  "eligibility": ["Individual creative practitioners in England"],
  "source": {
    "name": "Arts Council England",
    "url": "https://www.artscouncil.org.uk"
  },
  "fact_check": {
    "confidence": "official_single_source"
  }
}

Return ONLY valid JSON, no markdown, no explanations.
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

      // ENRICHMENT STEP 1: Fix content if it's an array
      if (Array.isArray(parsed.content)) {
        parsed.content = parsed.content.join('\n\n');
      }

      // ENRICHMENT STEP 2: Ensure minimum content length
      if (!parsed.content || parsed.content.length < 200) {
        const fallbackText = preprocessed.cleanText.substring(0, 1000);
        parsed.content = fallbackText || 'Details to be confirmed. Please visit the source URL.';
      }

      // ENRICHMENT STEP 3: Fix link_to_apply
      if (!parsed.link_to_apply || parsed.link_to_apply === 'Not specified') {
        if (preprocessed.extractedLinks.applyLinks.length > 0) {
          parsed.link_to_apply = preprocessed.extractedLinks.applyLinks[0];
        } else {
          // Try to construct from base URL
          try {
            const baseUrl = new URL(rawOpportunity.url);
            const commonPaths = ['/apply', '/application', '/submit', '/how-to-apply'];
            // Check if any common path exists in HTML
            const htmlLower = rawOpportunity.html.toLowerCase();
            for (const path of commonPaths) {
              if (htmlLower.includes(`href="${path}"`) || htmlLower.includes(`href='${path}'`)) {
                parsed.link_to_apply = `${baseUrl.origin}${path}`;
                break;
              }
            }
          } catch {
            // Keep as "Not specified"
          }
        }
      }

      // ENRICHMENT STEP 4: Fix contact_email
      if (!parsed.contact_email || parsed.contact_email === 'Not specified') {
        if (preprocessed.extractedEmails.length > 0) {
          parsed.contact_email = preprocessed.extractedEmails[0];
        } else {
          // Try to construct from domain
          try {
            const domain = new URL(rawOpportunity.url).hostname;
            const commonPrefixes = ['info', 'contact', 'enquiries', 'applications', 'admissions'];
            // Check if any common email pattern exists in HTML
            for (const prefix of commonPrefixes) {
              const emailPattern = `${prefix}@${domain}`;
              if (rawOpportunity.html.includes(emailPattern)) {
                parsed.contact_email = emailPattern;
                break;
              }
            }
          } catch {
            // Leave empty
            parsed.contact_email = '';
          }
        }
      }

      // ENRICHMENT STEP 5: Ensure link_to_apply is a complete URL
      if (parsed.link_to_apply && parsed.link_to_apply !== 'Not specified') {
        if (!parsed.link_to_apply.startsWith('http')) {
          try {
            const baseUrl = new URL(rawOpportunity.url);
            parsed.link_to_apply = `${baseUrl.origin}${parsed.link_to_apply}`;
          } catch {
            parsed.link_to_apply = 'Not specified';
          }
        }
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

