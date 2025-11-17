import * as cheerio from 'cheerio';

export interface PreprocessedHTML {
  cleanText: string;
  extractedLinks: {
    applyLinks: string[];
    contactLinks: string[];
  };
  extractedEmails: string[];
  keyBlocks: {
    funding?: string;
    fees?: string;
    deadline?: string;
  };
}

/**
 * Извлекает email-адреса из текста
 */
export function extractEmails(text: string): string[] {
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = text.match(emailPattern) || [];

  // Приоритизация: admissions, applications, residency, grants, info
  const priorityKeywords = ['admissions', 'applications', 'residency', 'grants', 'info'];

  const prioritized = emails.filter((email) =>
    priorityKeywords.some((keyword) => email.toLowerCase().includes(keyword)),
  );

  return prioritized.length > 0 ? prioritized : emails;
}

/**
 * Извлекает ссылки на формы заявок и контакты
 */
export function extractLinks(html: string, baseUrl: string): PreprocessedHTML['extractedLinks'] {
  const $ = cheerio.load(html);
  const applyLinks: string[] = [];
  const contactLinks: string[] = [];

  const applyKeywords = ['apply', 'application', 'submit', 'call', 'register', 'enrollment'];
  const contactKeywords = ['contact', 'email', 'reach', 'inquiries'];

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const text = $(element).text().toLowerCase();

    if (!href) return;

    // Преобразование относительных ссылок
    let fullUrl = href;
    if (!href.startsWith('http')) {
      try {
        fullUrl = new URL(href, baseUrl).toString();
      } catch {
        return;
      }
    }

    // Проверка на ключевые слова в тексте или URL
    const isApplyLink = applyKeywords.some(
      (keyword) => text.includes(keyword) || fullUrl.toLowerCase().includes(keyword),
    );
    const isContactLink = contactKeywords.some(
      (keyword) => text.includes(keyword) || fullUrl.toLowerCase().includes(keyword),
    );

    if (isApplyLink && !applyLinks.includes(fullUrl)) {
      applyLinks.push(fullUrl);
    }
    if (isContactLink && !contactLinks.includes(fullUrl)) {
      contactLinks.push(fullUrl);
    }
  });

  return { applyLinks, contactLinks };
}

/**
 * Извлекает ключевые блоки с финансовой информацией
 */
export function extractKeyBlocks(html: string): PreprocessedHTML['keyBlocks'] {
  const $ = cheerio.load(html);
  const keyBlocks: PreprocessedHTML['keyBlocks'] = {};

  // Паттерны для поиска
  const fundingKeywords = [
    'stipend',
    'grant',
    'funding',
    'allowance',
    'support',
    'scholarship',
    'award',
    'prize',
  ];
  const feeKeywords = ['fee', 'cost', 'rent', 'subsidized', 'free', 'no charge', 'no fee'];
  const deadlineKeywords = ['deadline', 'due date', 'closing date', 'apply by', 'submit by'];

  // Ищем параграфы и секции с ключевыми словами
  $('p, div, section, li').each((_, element) => {
    const text = $(element).text().toLowerCase();

    // Funding
    if (
      !keyBlocks.funding &&
      fundingKeywords.some((keyword) => text.includes(keyword)) &&
      /[\$€£]\s*\d+|^\d+\s*[\$€£]/.test(text)
    ) {
      keyBlocks.funding = $(element).text().trim().substring(0, 500);
    }

    // Fees
    if (
      !keyBlocks.fees &&
      feeKeywords.some((keyword) => text.includes(keyword)) &&
      (text.includes('free') || /[\$€£]\s*\d+|^\d+\s*[\$€£]/.test(text))
    ) {
      keyBlocks.fees = $(element).text().trim().substring(0, 500);
    }

    // Deadline
    if (
      !keyBlocks.deadline &&
      deadlineKeywords.some((keyword) => text.includes(keyword)) &&
      /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(
        text,
      )
    ) {
      keyBlocks.deadline = $(element).text().trim().substring(0, 300);
    }
  });

  return keyBlocks;
}

/**
 * Очищает HTML и извлекает текст
 */
export function cleanHTML(html: string): string {
  const $ = cheerio.load(html);

  // Удаляем скрипты, стили, навигацию, футеры
  $('script, style, nav, footer, header, .menu, .navigation, .sidebar').remove();

  // Извлекаем текст
  const text = $('body').text();

  // Очистка: убираем лишние пробелы и переносы
  const lines = text.split('\n').map((line) => line.trim());
  const cleaned = lines.filter((line) => line.length > 0).join('\n');

  return cleaned;
}

/**
 * Главная функция предобработки HTML
 */
export function preprocessHTML(html: string, url: string): PreprocessedHTML {
  const cleanText = cleanHTML(html);
  const extractedLinks = extractLinks(html, url);
  const extractedEmails = extractEmails(cleanText);
  const keyBlocks = extractKeyBlocks(html);

  return {
    cleanText,
    extractedLinks,
    extractedEmails,
    keyBlocks,
  };
}

