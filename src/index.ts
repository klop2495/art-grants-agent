import 'dotenv/config';
import fs from 'fs';
import { fetchRawOpportunities } from './fetchSources.js';
import { generateOpportunityPayload } from './gptClient.js';
import { sendOpportunityToPlatform } from './ingestClient.js';
import type { OpportunityPayload } from './types.js';

const PROCESSED_FILE = 'processed-grants.json';
const DELETED_FILE = 'deleted-grants.json'; // Track deleted records

function loadProcessed(): Set<string> {
  if (!fs.existsSync(PROCESSED_FILE)) {
    return new Set();
  }
  try {
    const data = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'));
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveProcessed(ids: Set<string>) {
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...ids], null, 2));
}

function loadDeleted(): Set<string> {
  if (!fs.existsSync(DELETED_FILE)) {
    return new Set();
  }
  try {
    const data = JSON.parse(fs.readFileSync(DELETED_FILE, 'utf8'));
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveDeleted(ids: Set<string>) {
  fs.writeFileSync(DELETED_FILE, JSON.stringify([...ids], null, 2));
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === 'TBD') {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function isRelevant(
  payload: OpportunityPayload,
): { relevant: boolean; reason?: string; note?: string } {
  const today = startOfToday();
  const deadline = parseDate(payload.application_deadline);
  const programStart = parseDate(payload.program_dates?.start_date);
  const programEnd = parseDate(payload.program_dates?.end_date);

  const deadlineUpcoming = !!deadline && deadline >= today;
  const programUpcoming =
    (!!programStart && programStart >= today) || (!!programEnd && programEnd >= today);

  if (deadlineUpcoming || programUpcoming) {
    return { relevant: true };
  }

  if (!deadline && !programStart && !programEnd) {
    return { relevant: true, note: 'No explicit deadline/program dates; keeping for manual review' };
  }

  return {
    relevant: false,
    reason: `Outdated opportunity (deadline: ${deadline?.toISOString() ?? 'n/a'})`,
  };
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 Art Grants Agent - Run Started');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔧 Model: ${process.env.OPENAI_MODEL ?? 'gpt-4o'}`);
  console.log(
    `🎯 Max opportunities: ${process.env.MAX_OPPORTUNITIES_PER_RUN ?? '20'}`,
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const processed = loadProcessed();
  const deleted = loadDeleted();
  const stats = {
    fetched: 0,
    skipped: 0,
    processed: 0,
    created: 0,
    updated: 0,
    deletedSkipped: 0,
    stale: 0,
    errors: 0,
  };

  try {
    const raw = await fetchRawOpportunities();
    stats.fetched = raw.length;
    console.log(`\n📊 Fetched ${stats.fetched} sources\n`);

    if (raw.length === 0) {
      return;
    }

    const apiDelay = parseInt(process.env.API_DELAY_MS ?? '1000', 10);

    for (const item of raw) {
      console.log('\n' + '═'.repeat(60));
      console.log(`📄 Processing: ${item.sourceName}`);
      console.log(`   URL: ${item.url}`);

      // Check if previously deleted by user
      if (deleted.has(item.externalId)) {
        console.log('   ⏭️  Previously deleted by user, skipping');
        stats.deletedSkipped++;
        continue;
      }

      if (processed.has(item.externalId)) {
        console.log('   ⭐ Already processed recently, skipping');
        stats.skipped++;
        continue;
      }

      try {
        const payload = await generateOpportunityPayload(item);
        if (!payload) {
          stats.errors++;
          continue;
        }

        stats.processed++;

        const relevance = isRelevant(payload);
        if (!relevance.relevant) {
          console.log(`   ⚠️  Skipping ${relevance.reason}`);
          stats.stale++;
          continue;
        }

        if (relevance.note) {
          console.log(`   ℹ️  ${relevance.note}`);
        }

        const result = await sendOpportunityToPlatform(payload);
        
        if (result.action === 'skipped') {
          // Record was deleted by user, add to deleted list
          deleted.add(item.externalId);
          saveDeleted(deleted);
          stats.deletedSkipped++;
        } else {
          // Record created or updated
          processed.add(item.externalId);
          saveProcessed(processed);
          
          if (result.action === 'created') {
            stats.created++;
          } else if (result.action === 'updated') {
            stats.updated++;
          }
        }

        if (apiDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, apiDelay));
        }
      } catch (error: any) {
        console.error(`   ❌ Error: ${error.message}`);
        stats.errors++;
      }
    }
  } catch (error: any) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📊 RUN SUMMARY');
  console.log('─'.repeat(60));
  console.log(`   Fetched:          ${stats.fetched}`);
  console.log(`   Already Skipped:  ${stats.skipped}`);
  console.log(`   Processed:        ${stats.processed}`);
  console.log(`   Created:          ${stats.created}`);
  console.log(`   Updated:          ${stats.updated}`);
  console.log(`   Deleted Skipped:  ${stats.deletedSkipped}`);
  console.log(`   Stale Skipped:    ${stats.stale}`);
  console.log(`   Errors:           ${stats.errors}`);
  console.log('═'.repeat(60) + '\n');

  if (stats.errors === 0) {
    console.log('✅ Grants agent run completed successfully\n');
  } else {
    console.log('⚠️  Grants agent run completed with errors\n');
  }
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

