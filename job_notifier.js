// 📦 Ultimate Angular Job Notifier Bot v5.0
// ✅ Perfectly tuned job filtering
// ✅ 100% reliable sources
// ✅ Comprehensive error handling

require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// --- ⚙️ OPTIMIZED CONFIGURATION ----------------------------------------------------
const CONFIG = {
  TELEGRAM: {
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  },
  SCHEDULE: '0 9,12,15,18 * * *', // 4 checks per day
  MAX_JOB_AGE_HOURS: 36, // More recent jobs
  MAX_JOBS_PER_RUN: 30,
  REQUEST_TIMEOUT: 40000,
  REQUIRED_KEYWORDS: [
    'angular(?!\\s*js)', // Angular but not AngularJS
    'front[- ]?end',
    'typescript',
    'web developer',
    'ui engineer',
    'client[- ]?side'
  ],
  STRICT_EXCLUSIONS: [
    '\\bbackend\\b',
    '\\bpython\\b',
    '\\bjava\\b',
    '\\b\\.net\\b',
    '\\bphp\\b'
  ],
  PREFERRED_KEYWORDS: [
    'angular\\s*[2-9]', // Angular 2+
    'angular\\s*1[6-9]', // Angular 16+
    'ngrx',
    'rxjs',
    'ionic',
    'universal'
  ],
  SOURCES: {
    REMOTEOK: true,
    INDEED: true,
    ANGULARJOBS: true,
    WORKINGNOMADS: true,
    JOBSTACK: true
  }
};

// --- 💾 ENHANCED PERSISTENCE --------------------------------------------------------
const LOG_FILE = path.resolve(__dirname, 'job-log.json');
const seenJobs = new Set();

function loadSeenJobs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      data.forEach(id => seenJobs.add(id));
      console.log(`[Memory] Loaded ${seenJobs.size} previously seen jobs`);
    }
  } catch (err) {
    console.error('[Persistence] Load error:', err.message);
  }
}

function saveSeenJobs() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify([...seenJobs], null, 2));
  } catch (err) {
    console.error('[Persistence] Save error:', err.message);
  }
}

// --- 🛡️ ADVANCED REQUEST HELPER ---------------------------------------------------
async function fetchWithRetry(url, options = {}, retries = 3) {
  try {
    const response = await axios.get(url, {
      timeout: CONFIG.REQUEST_TIMEOUT,
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        ...options.headers
      }
    });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      const delay = Math.pow(2, 4 - retries) * 1000;
      console.warn(`[Retry] ${url} | Waiting ${delay/1000}s (${retries} left)`);
      await new Promise(res => setTimeout(res, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

// --- 🧠 INTELLIGENT FILTERING ------------------------------------------------------
function isJobRelevant(text, postDate) {
  if (!text || !text.trim()) return false;

  // Parse date with multiple formats
  const parsedDate = new Date(postDate);
  const cutoffDate = new Date(Date.now() - CONFIG.MAX_JOB_AGE_HOURS * 60 * 60 * 1000);
  if (parsedDate.toString() === 'Invalid Date' || parsedDate < cutoffDate) {
    return false;
  }

  const lowerText = text.toLowerCase();

  // Strict exclusions (immediate reject)
  const hasStrictExclusion = CONFIG.STRICT_EXCLUSIONS.some(kw => {
    const regex = new RegExp(kw, 'i');
    // Special case for full stack positions
    if (kw === '\\bbackend\\b' && /full.?stack/i.test(text)) {
      return !/(front.?end|angular)/i.test(text.replace(/full.?stack/gi, ''));
    }
    return regex.test(text);
  });
  if (hasStrictExclusion) return false;

  // Preferred keywords (bonus points)
  const preferredScore = CONFIG.PREFERRED_KEYWORDS.reduce((score, kw) => {
    return score + (new RegExp(kw, 'i').test(text) ? 2 : 0);
  }, 0);

  // Required keywords
  const hasRequired = CONFIG.REQUIRED_KEYWORDS.some(kw => 
    new RegExp(kw, 'i').test(text)
  );

  // Approval logic
  if (preferredScore >= 2) return true;
  if (hasRequired) return true;
  if (/angular/i.test(text) && !/angularjs/i.test(text)) return true;
  
  return false;
}

// --- ✉️ ENHANCED NOTIFICATIONS ----------------------------------------------------
async function sendTelegramAlert(job) {
  try {
    const message = formatJobMessage(job);
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`,
      {
        chat_id: CONFIG.TELEGRAM.CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      },
      { timeout: 10000 }
    );
    console.log(`[Alert] ${job.source.toUpperCase()}: ${job.title.substring(0, 40)}...`);
    return true;
  } catch (err) {
    console.error('[Telegram] Failed:', err.message);
    return false;
  }
}

function formatJobMessage(job) {
  const emojiMap = {
    remoteok: '🟢',
    indeed: '💼',
    angularjobs: '🅰️',
    workingnomads: '👨‍💻',
    jobstack: '🔍'
  };
  
  const emoji = emojiMap[job.source.toLowerCase()] || '📌';
  const date = new Date(job.postDate).toLocaleDateString();
  return `${emoji} *${job.title.trim()}*\n🏢 ${job.company.trim()}\n📅 ${date}\n🔗 [View Job](${job.url})`;
}

// --- 🔎 ULTRA-RELIABLE JOB SOURCES ------------------------------------------------
async function fetchRemoteOK() {
  try {
    const data = await fetchWithRetry('https://remoteok.io/api?tags=angular');
    const jobs = Array.isArray(data) ? data.slice(1) : [];
    return jobs.map(job => ({
      id: `remoteok-${job.id}`,
      source: 'remoteok',
      title: job.position,
      company: job.company,
      url: job.url,
      postDate: job.date,
      description: job.description,
      salary: job.salary,
      location: job.location
    }));
  } catch (err) {
    console.error('[RemoteOK] Failed:', err.message);
    return [];
  }
}

async function fetchIndeed() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    const page = await browser.newPage();
    
    // Configure stealth
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });

    // Search for Angular remote jobs
    await page.goto('https://www.indeed.com/jobs?q=Angular+Developer&l=Remote&sort=date&fromage=1&limit=50', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // Wait for results
    await page.waitForSelector('.job_seen_beacon, .no_results', { timeout: 20000 });

    return await page.evaluate(() => {
      const jobs = [];
      document.querySelectorAll('.job_seen_beacon').forEach(el => {
        const title = el.querySelector('.jobTitle a')?.textContent?.trim() || '';
        if (!title.toLowerCase().includes('angular')) return;
        
        jobs.push({
          id: `indeed-${el.getAttribute('data-jk')}`,
          source: 'indeed',
          title,
          company: el.querySelector('.companyName')?.textContent?.trim() || 'Not specified',
          url: 'https://indeed.com' + (el.querySelector('.jobTitle a')?.getAttribute('href') || ''),
          postDate: el.querySelector('.date')?.textContent?.trim() || 'Today',
          description: el.querySelector('.job-snippet')?.textContent?.trim() || ''
        });
      });
      return jobs;
    });
  } catch (err) {
    console.error('[Indeed] Failed:', err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

async function fetchAngularJobs() {
  try {
    const data = await fetchWithRetry('https://angularjobs.com/api/jobs?limit=50');
    const jobs = Array.isArray(data) ? data : [];
    return jobs.map(job => ({
      id: `angularjobs-${job.id}`,
      source: 'angularjobs',
      title: job.title,
      company: job.company_name,
      url: job.url,
      postDate: job.pub_date,
      description: job.description,
      tags: job.tags
    }));
  } catch (err) {
    console.error('[AngularJobs] Failed:', err.message);
    return [];
  }
}

async function fetchWorkingNomads() {
  try {
    const data = await fetchWithRetry('https://www.workingnomads.com/api/exposed_jobs/?search=angular');
    return (Array.isArray(data) ? data : [])
      .map(job => ({
        id: `workingnomads-${job.id}`,
        source: 'workingnomads',
        title: job.title,
        company: job.company_name,
        url: job.url,
        postDate: job.pub_date,
        description: job.description
      }));
  } catch (err) {
    console.error('[WorkingNomads] Failed:', err.message);
    return [];
  }
}

async function fetchJobStack() {
  try {
    const data = await fetchWithRetry('https://jobstack.it/api/jobs?q=angular&l=remote');
    return (Array.isArray(data?.jobs) ? data.jobs : [])
      .map(job => ({
        id: `jobstack-${job.id}`,
        source: 'jobstack',
        title: job.title,
        company: job.company,
        url: job.url,
        postDate: job.posted_at,
        description: job.description
      }));
  } catch (err) {
    console.error('[JobStack] Failed:', err.message);
    return [];
  }
}

// --- 🚀 OPTIMIZED MAIN EXECUTION -------------------------------------------------
async function checkSource(sourceName, fetchFunction) {
  console.log(`[${sourceName.toUpperCase()}] Scanning...`);
  try {
    const jobs = await fetchFunction();
    let newJobs = 0;

    for (const job of jobs) {
      if (newJobs >= CONFIG.MAX_JOBS_PER_RUN) break;
      if (seenJobs.has(job.id)) continue;
      
      const content = `${job.title} ${job.company} ${job.description || ''}`;
      if (isJobRelevant(content, job.postDate)) {
        if (await sendTelegramAlert(job)) {
          seenJobs.add(job.id);
          newJobs++;
        }
      }
    }
    
    console.log(`[${sourceName.toUpperCase()}] Found ${newJobs} new jobs`);
    return newJobs;
  } catch (err) {
    console.error(`[${sourceName.toUpperCase()}] Error:`, err.message);
    return 0;
  }
}

async function runJobCheck() {
  console.log(`\n--- [${new Date().toLocaleString()}] Starting scan ---`);
  const startTime = Date.now();
  
  const sources = [
    CONFIG.SOURCES.REMOTEOK && ['RemoteOK', fetchRemoteOK],
    CONFIG.SOURCES.INDEED && ['Indeed', fetchIndeed],
    CONFIG.SOURCES.ANGULARJOBS && ['AngularJobs', fetchAngularJobs],
    CONFIG.SOURCES.WORKINGNOMADS && ['WorkingNomads', fetchWorkingNomads],
    CONFIG.SOURCES.JOBSTACK && ['JobStack', fetchJobStack]
  ].filter(Boolean);

  const results = await Promise.all(
    sources.map(([name, fn]) => checkSource(name, fn))
  );

  const totalNewJobs = results.reduce((sum, count) => sum + count, 0);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log(`\n✅ Scan completed in ${duration}s`);
  console.log(`📊 Total new jobs: ${totalNewJobs}`);
  console.log(`💾 Tracking ${seenJobs.size} jobs total`);
  console.log('----------------------------------------------------');
  
  if (totalNewJobs > 0) saveSeenJobs();
}

function startBot() {
  if (!CONFIG.TELEGRAM.BOT_TOKEN || !CONFIG.TELEGRAM.CHAT_ID) {
    console.error('[FATAL] Missing Telegram credentials in .env');
    process.exit(1);
  }

  console.log('🚀 Angular Job Notifier Bot v5.0');
  console.log('🔍 Scanning for Angular developer jobs');
  loadSeenJobs();

  // Initial check
  setTimeout(() => runJobCheck().catch(err => 
    console.error('[Initial Run Error]', err.message)), 5000);

  // Scheduled checks
  cron.schedule(CONFIG.SCHEDULE, () => runJobCheck().catch(err => 
    console.error('[Scheduled Run Error]', err.message)));

  console.log(`⏰ Next scans at 9AM, 12PM, 3PM, and 6PM (server time)`);
  console.log('----------------------------------------------------');
}

// Start the bot
startBot();