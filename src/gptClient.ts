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
  external_id: z.string().optional(),
  title: z.string().min(3).max(280),
  summary: z.string().min(50).max(600),
  content: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => {
      if (Array.isArray(val)) {
        return val.filter((s) => s && s.trim().length > 0).join('\n\n');
      }
      return val;
    })
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
  location: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  funding_amount: z.string().nullable().optional(),
  participation_cost: z.string().nullable().optional(),
  application_deadline: ApplicationDeadlineSchema,
  program_dates: z
    .object({
      start_date: z
        .string()
        .nullable()
        .refine(
          (value) => {
            if (value === null) return true;
            return !Number.isNaN(Date.parse(value));
          },
          {
            message: 'start_date must be ISO 8601 date or null',
          },
        )
        .optional(),
      end_date: z
        .string()
        .nullable()
        .refine(
          (value) => {
            if (value === null) return true;
            return !Number.isNaN(Date.parse(value));
          },
          {
            message: 'end_date must be ISO 8601 date or null',
          },
        )
        .optional(),
      timezone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  eligibility: z.array(z.string()).nullable().optional(),
  disciplines: z.array(z.string()).nullable().optional(),
  requirements: z.array(z.string()).nullable().optional(),
  benefits: z.array(z.string()).nullable().optional(),
  link_to_apply: z
    .string()
    .nullable()
    .transform((val) => {
      if (!val || val === '' || val === 'Not specified') return 'Not specified';
      // Ensure it's a complete URL
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        return 'Not specified';
      }
      return val;
    })
    .refine(
      (val) => {
        if (val === 'Not specified') return true;
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
    .nullable()
    .transform((val) => {
      if (!val || val === 'Not specified') return '';
      return val.trim();
    })
    .refine(
      (val) => {
        if (!val || val === '') return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      },
      { message: 'contact_email must be valid email or empty string' },
    )
    .optional(),
  language: z.string().nullable().optional(),
  source: z.object({
    name: z.string(),
    url: z.string().url(),
  }),
  fact_check: z
    .object({
      confidence: z.enum(['verified', 'official_single_source', 'low_confidence']),
      notes: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const SYSTEM_PROMPT = `
You are a specialized AI agent that extracts structured information about art grants and residencies from web pages.

YOUR TASK:
Extract the following information and return it as valid JSON.

CRITICAL FORMAT REQUIREMENTS:
1. "content" can be either:
   - A SINGLE STRING with paragraphs separated by \\n\\n
   - OR an array of strings (each paragraph) - we will merge them
2. "content" must have at least 200 characters total
3. "summary" must be at least 50 characters long
4. "link_to_apply": 
   - MUST start with http:// or https://
   - If not found or incomplete URL, return "Not specified"
5. "contact_email": 
   - MUST be valid format (user@domain.com)
   - If not found, return empty string "" or null
   - Do NOT return "Not specified" for email
6. For optional fields you cannot find:
   - Return null (not "Not specified", not empty string, just null)
   - Exception: link_to_apply → "Not specified"
   - Exception: contact_email → "" (empty string)

IMPORTANT: Use null for missing optional data:
- funding_amount: null if not found
- participation_cost: null if not found
- country, city, location: null if not found
- program_dates: null if not found
- eligibility, disciplines, requirements, benefits: null if not found (NOT empty arrays [])

EXTRACTION PRIORITY:
1. Look for EXPLICIT information first
2. If not found, look in common locations:
   - Application links: look for buttons, "Apply", "Submit", "How to Apply"
   - Emails: look for info@, contact@, applications@, admissions@, enquiries@
   - Funding: look for $, €, £ symbols with numbers
   - Fees: look for "fee", "cost", "free", "no charge"

FIELDS TO EXTRACT:
{
  "title": "string (required)",
  "summary": "string, min 50 chars (required)",
  "content": "string or array of strings, min 200 chars total (required)",
  "program_type": "grant|residency|open_call|fellowship|competition|fair_exhibition (required)",
  "organization_name": "string (required)",
  "country": "string or null",
  "city": "string or null",
  "location": "string or null",
  "funding_amount": "string like '€1,200/month' or 'Free' or null",
  "participation_cost": "string like '$30 fee' or 'Free' or null",
  "application_deadline": "ISO 8601 date (YYYY-MM-DD) or 'TBD' (required)",
  "program_dates": {
    "start_date": "ISO 8601 date or null",
    "end_date": "ISO 8601 date or null",
    "timezone": "string or null"
  } or null,
  "eligibility": ["string", "string"] or null,
  "disciplines": ["string", "string"] or null,
  "requirements": ["string", "string"] or null,
  "benefits": ["string", "string"] or null,
  "link_to_apply": "complete URL or 'Not specified'",
  "contact_email": "email@domain.com or empty string ''",
  "language": "string or null",
  "source": {
    "name": "string",
    "url": "string"
  } (required),
  "fact_check": {
    "confidence": "verified|official_single_source|low_confidence",
    "notes": "string or null"
  } or null
}

EXAMPLE VALID OUTPUT 1 (content as string):
{
  "title": "DYCP - Develop Your Creative Practice",
  "summary": "Arts Council England grant supporting creative practitioners to develop their practice through research and skills development.",
  "content": "The Develop Your Creative Practice (DYCP) grant is designed for individual creative practitioners to take time out to research, develop skills, explore new ideas, and develop their creative practice.\\n\\nYou can apply for between £2,000 and £10,000 to support a specific period of development and research activity. The funding can be used for training, research trips, mentorships, or time to develop new work.\\n\\nThe grant is open to individual artists, creative practitioners and individuals working in the creative industries in England.",
  "program_type": "grant",
  "organization_name": "Arts Council England",
  "country": "United Kingdom",
  "city": "London",
  "funding_amount": "£2,000 - £10,000",
  "participation_cost": "Free",
  "application_deadline": "2025-01-28",
  "link_to_apply": "https://www.artscouncil.org.uk/apply-for-a-grant",
  "contact_email": "enquiries@artscouncil.org.uk",
  "disciplines": ["visual arts", "performing arts", "literature", "music"],
  "eligibility": ["Individual creative practitioners in England", "Minimum 2 years professional practice"],
  "source": {
    "name": "Arts Council England",
    "url": "https://www.artscouncil.org.uk"
  },
  "fact_check": {
    "confidence": "official_single_source"
  }
}

EXAMPLE VALID OUTPUT 2 (content as array - will be merged):
{
  "title": "MacDowell Fellowship",
  "summary": "Artist residency program in New Hampshire providing time, space and support for creative work across all disciplines.",
  "content": [
    "MacDowell offers residencies of 2-8 weeks for artists in all disciplines including architecture, visual arts, film/video, interdisciplinary arts, literature, music composition, theatre, and more.",
    "Fellows receive private studios, three meals a day, and housing at no cost. The sole criterion for acceptance is artistic excellence.",
    "About 300 artists are awarded Fellowships each year. Need-based stipends and travel reimbursement grants are available.",
    "Apply by February 10, 2026 for Fall/Winter 2026-2027 residencies (September 1, 2026 - February 28, 2027)."
  ],
  "program_type": "residency",
  "organization_name": "MacDowell",
  "country": "United States",
  "city": "Peterborough",
  "location": "Peterborough, New Hampshire, United States",
  "funding_amount": "Free (stipends up to $1,500 available based on need)",
  "participation_cost": "$30 application fee (waivers available)",
  "application_deadline": "2026-02-10",
  "program_dates": {
    "start_date": "2026-09-01",
    "end_date": "2027-02-28"
  },
  "link_to_apply": "https://www.macdowell.org/apply/apply-for-fellowship",
  "contact_email": "admissions@macdowell.org",
  "disciplines": ["architecture", "visual arts", "film", "literature", "music", "theatre"],
  "eligibility": ["Professional artists from all countries", "Emerging and established artists welcome"],
  "benefits": ["Private studio", "Accommodation", "Three meals daily", "Travel grants available"],
  "source": {
    "name": "MacDowell",
    "url": "https://www.macdowell.org"
  },
  "fact_check": {
    "confidence": "official_single_source"
  }
}

EXTRACTION RULES:
1. FUNDING (funding_amount):
   - Look for: grant amounts, stipends, allowances, scholarships
   - Examples: "€1,200/month", "$50,000 total", "£2,000-£10,000"
   - If "free" or "no cost" → "Free"
   - If not found → "Not specified"

2. PARTICIPATION COST (participation_cost):
   - Look for: application fee, residency fee, rent, subsidized cost
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
   - If not found → return empty string "" (NOT "Not specified")

5. CONTENT formatting:
   - Can return as string OR array of strings
   - If array: each item = one paragraph/section
   - Minimum 200 characters total
   - Remove excessive whitespace

Return ONLY valid JSON, no markdown, no explanations, no code blocks.
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
    additionalContext += `\n\nEXTRACTED APPLICATION LINKS:\n${preprocessed.extractedLinks.applyLinks.slice(0, 5).join('\n')}`;
  }

  if (preprocessed.extractedEmails.length > 0) {
    additionalContext += `\n\nEXTRACTED EMAILS:\n${preprocessed.extractedEmails.slice(0, 3).join(', ')}`;
  }

  if (preprocessed.keyBlocks.funding) {
    additionalContext += `\n\nFUNDING INFO BLOCK:\n${preprocessed.keyBlocks.funding.substring(0, 300)}`;
  }

  if (preprocessed.keyBlocks.fees) {
    additionalContext += `\n\nFEES INFO BLOCK:\n${preprocessed.keyBlocks.fees.substring(0, 300)}`;
  }

  if (preprocessed.keyBlocks.deadline) {
    additionalContext += `\n\nDEADLINE INFO BLOCK:\n${preprocessed.keyBlocks.deadline.substring(0, 300)}`;
  }

  const userPrompt = `
Analyze this web page and extract opportunity information into JSON.

Context:
- Source: ${rawOpportunity.sourceName}
- URL: ${rawOpportunity.url}
- Target language: ${defaultLanguage}

IMPORTANT EXTRACTION INSTRUCTIONS:

1. CONTENT field:
   - Can return as EITHER a string OR array of strings
   - If array: each item = one paragraph
   - Total must be 200+ characters
   - Merge multiple sections if needed

2. FINANCIAL FIELDS:
   funding_amount: Look for grant/stipend/scholarship amounts
   - Examples: "€1,200/month", "$50,000", "£2,000-£10,000"
   - If "free" or "no cost" → "Free"
   - If not found → "Not specified"

   participation_cost: Look for fees
   - Examples: "$30 application fee", "€411/month rent"
   - If "no fee" or "free" → "Free"
   - If not found → "Not specified"

3. APPLICATION LINK:
   - Must be COMPLETE URL: https://example.com/apply
   - Look for: Apply, Submit, Application Form buttons
   - If found but no URL → "Not specified"
   - If not found → "Not specified"

4. CONTACT EMAIL:
   - Must be VALID email: user@domain.com
   - Look for: info@, contact@, applications@, admissions@
   - If not found → return empty string "" (NOT "Not specified")

5. DEADLINE:
   - Must be ISO 8601: YYYY-MM-DD
   - If unclear → "TBD"

6. DISCIPLINES & ELIGIBILITY:
   - Return as arrays of strings
   - Examples: ["visual arts", "music"], ["emerging artists", "UK residents"]

7. FACT CHECK:
   - confidence must be EXACTLY one of: "verified", "official_single_source", "low_confidence"
   - Use "official_single_source" for direct organization pages

EXTRACTED DATA FROM HTML PREPROCESSOR:
${preprocessed.extractedLinks.applyLinks.length > 0 ? `
Application Links Found:
${preprocessed.extractedLinks.applyLinks.slice(0, 3).join('\n')}
` : ''}
${preprocessed.extractedEmails.length > 0 ? `
Emails Found:
${preprocessed.extractedEmails.slice(0, 3).join(', ')}
` : ''}
${preprocessed.keyBlocks.funding ? `
Funding Context:
${preprocessed.keyBlocks.funding.substring(0, 200)}
` : ''}
${preprocessed.keyBlocks.fees ? `
Fees Context:
${preprocessed.keyBlocks.fees.substring(0, 200)}
` : ''}
${preprocessed.keyBlocks.deadline ? `
Deadline Context:
${preprocessed.keyBlocks.deadline.substring(0, 200)}
` : ''}

HTML Content (first 20k chars):
---
${rawOpportunity.html.substring(0, 20000)}${rawOpportunity.html.length > 20000 ? '\n...(truncated)' : ''}
---

Return ONLY valid JSON, no markdown, no code blocks, no explanations.
`;

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

      // ========== ENRICHMENT SECTION ==========

      // STEP 1: Fix content if it's an array
      if (Array.isArray(parsed.content)) {
        parsed.content = parsed.content
          .filter((s: string) => s && s.trim().length > 0)
          .join('\n\n');
      }

      // STEP 2: Ensure minimum content length
      if (!parsed.content || parsed.content.length < 200) {
        const fallbackText = preprocessed.cleanText.substring(0, 1000);
        if (fallbackText.length >= 200) {
          parsed.content = fallbackText;
        } else {
          // Try to use summary as base
          const base = parsed.summary || 'Details available on website.';
          parsed.content = `${base}\n\n${fallbackText}`.substring(0, 1000);
          
          // Ensure minimum length
          if (parsed.content.length < 200) {
            parsed.content = parsed.content + '\n\nFor complete information, please visit the organization\'s official website.';
          }
        }
      }

      // STEP 3: Fix link_to_apply
      if (!parsed.link_to_apply || parsed.link_to_apply === 'Not specified' || !parsed.link_to_apply.startsWith('http')) {
        if (preprocessed.extractedLinks.applyLinks.length > 0) {
          // Use first extracted link
          parsed.link_to_apply = preprocessed.extractedLinks.applyLinks[0];
        } else {
          // Try to find link in HTML
          try {
            const baseUrl = new URL(rawOpportunity.url);
            const htmlLower = rawOpportunity.html.toLowerCase();
            const commonPaths = ['/apply', '/application', '/submit', '/how-to-apply', '/open-call'];
            
            let foundPath = false;
            for (const path of commonPaths) {
              if (htmlLower.includes(`href="${path}"`) || htmlLower.includes(`href='${path}'`) || htmlLower.includes(`href=".${path}"`)) {
                parsed.link_to_apply = `${baseUrl.origin}${path}`;
                foundPath = true;
                break;
              }
            }
            
            if (!foundPath) {
              // Last resort: use source URL
              parsed.link_to_apply = rawOpportunity.url;
            }
          } catch {
            parsed.link_to_apply = 'Not specified';
          }
        }
      }

      // STEP 4: Fix contact_email
      if (!parsed.contact_email || parsed.contact_email === 'Not specified') {
        if (preprocessed.extractedEmails.length > 0) {
          parsed.contact_email = preprocessed.extractedEmails[0];
        } else {
          // Try to construct from domain
          try {
            const domain = new URL(rawOpportunity.url).hostname;
            const commonPrefixes = ['info', 'contact', 'enquiries', 'applications', 'admissions'];
            
            // Search for common email patterns in HTML
            for (const prefix of commonPrefixes) {
              const emailPattern = `${prefix}@${domain}`;
              if (rawOpportunity.html.includes(emailPattern)) {
                parsed.contact_email = emailPattern;
                break;
              }
            }
            
            // If still not found, leave empty
            if (!parsed.contact_email || parsed.contact_email === 'Not specified') {
              parsed.contact_email = '';
            }
          } catch {
            parsed.contact_email = '';
          }
        }
      }

      // STEP 5: Normalize email (remove "Not specified")
      if (parsed.contact_email === 'Not specified') {
        parsed.contact_email = '';
      }

      // STEP 6: Normalize null/empty values for optional fields
      if (parsed.funding_amount === null || parsed.funding_amount === '' || parsed.funding_amount === 'Not specified') {
        parsed.funding_amount = null;
      }
      if (parsed.participation_cost === null || parsed.participation_cost === '' || parsed.participation_cost === 'Not specified') {
        parsed.participation_cost = null;
      }
      if (parsed.country === null || parsed.country === '') {
        parsed.country = null;
      }
      if (parsed.city === null || parsed.city === '') {
        parsed.city = null;
      }
      if (parsed.location === null || parsed.location === '') {
        parsed.location = null;
      }

      // STEP 7: Convert empty arrays to null
      if (parsed.eligibility && Array.isArray(parsed.eligibility) && parsed.eligibility.length === 0) {
        parsed.eligibility = null;
      }
      if (parsed.disciplines && Array.isArray(parsed.disciplines) && parsed.disciplines.length === 0) {
        parsed.disciplines = null;
      }
      if (parsed.requirements && Array.isArray(parsed.requirements) && parsed.requirements.length === 0) {
        parsed.requirements = null;
      }
      if (parsed.benefits && Array.isArray(parsed.benefits) && parsed.benefits.length === 0) {
        parsed.benefits = null;
      }

      // STEP 8: Ensure source is set
      if (!parsed.source) {
        parsed.source = {
          name: rawOpportunity.sourceName,
          url: rawOpportunity.url,
        };
      }

      // STEP 9: Set default fact_check if missing
      if (!parsed.fact_check) {
        parsed.fact_check = {
          confidence: 'official_single_source' as const,
          notes: null,
        };
      }

      // ========== END ENRICHMENT ==========

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
  if (payload.contact_email && payload.contact_email !== '') {
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