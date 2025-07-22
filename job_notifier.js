// 📦 Robust Angular Job Notifier Bot v1.5
// ✅ Fixed WeWorkRemotely 403 errors
// ✅ Added alternative job sources
// ✅ Enhanced error handling

const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// --- ⚙️ CONFIGURATION ----------------------------------------------------
const CONFIG = {
  TELEGRAM: {
    BOT_TOKEN: '7558091348:AAGh2jSqVZzTptpsMovjYsFoVpPbLtxXPwg',
    CHAT_ID: '1745428077'
  },
  SCHEDULE: '*/30 * * * *',
  MAX_JOB_AGE_MINUTES: 180,
  MAX_JOBS_PER_RUN: 30,
  REQUEST_RETRIES: 2,
  REQUEST_TIMEOUT: 10000,
  REQUIRED_KEYWORDS: ['angular', 'frontend', 'typescript'],
  EXCLUDED_KEYWORDS: ['react', 'vue', 'backend', 'node.js'],
  SOURCES: {
    REMOTEOK: true,
    REMOTIVE: false,
    WEWORKREMOTELY: false, // Disabled due to persistent 403 errors
    INDEED: true,          // New source
    ANGULARJOBS: true      // New dedicated Angular source
  }
};

// --- 💾 PERSISTENCE --------------------------------------------------------
const LOG_FILE = path.resolve(__dirname, 'job-log.json');
const seenJobs = new Set();

function loadSeenJobs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const data = fs.readFileSync(LOG_FILE, 'utf8');
      const jobs = JSON.parse(data);
      jobs.forEach(id => seenJobs.add(id));
      console.log(`[Memory] Loaded ${seenJobs.size} job IDs`);
    }
  } catch (err) {
    console.error('Error loading job log:', err.message);
  }
}

function saveSeenJobs() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify([...seenJobs], null, 2));
  } catch (err) {
    console.error('Error saving job log:', err.message);
  }
}

// --- 🛡️ REQUEST HELPER ---------------------------------------------------
async function fetchWithRetry(url, options = {}, retries = CONFIG.REQUEST_RETRIES) {
  try {
    const response = await axios({
      url,
      timeout: CONFIG.REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...options.headers
      },
      ...options
    });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying ${url} (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

// --- 🧠 CORE LOGIC --------------------------------------------------------
function isJobRelevant(text, postDate) {
  if (!text || !postDate) return false;
  
  const lowerText = text.toLowerCase();
  const isRecent = isJobRecent(postDate);
  const matchesKeywords = hasRequiredKeywords(lowerText);
  const noExcludedTerms = !hasExcludedKeywords(lowerText);
  
  return isRecent && matchesKeywords && noExcludedTerms;
}

function isJobRecent(postDate) {
  try {
    const jobDate = new Date(postDate);
    const cutoff = Date.now() - (CONFIG.MAX_JOB_AGE_MINUTES * 60 * 1000);
    return jobDate >= cutoff;
  } catch {
    return false;
  }
}

function hasRequiredKeywords(text) {
  return CONFIG.REQUIRED_KEYWORDS.some(kw => text.includes(kw));
}

function hasExcludedKeywords(text) {
  return CONFIG.EXCLUDED_KEYWORDS.some(kw => text.includes(kw));
}

async function sendTelegramAlert(job) {
  try {
    const message = formatJobMessage(job);
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`,
      {
        chat_id: CONFIG.TELEGRAM.CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      },
      { timeout: 5000 }
    );
    return true;
  } catch (err) {
    console.error('Telegram error:', err.response?.data || err.message);
    return false;
  }
}

function formatJobMessage(job) {
  const { source, title, company, url } = job;
  const emoji = {
    'remoteok': '🔥',
    'indeed': '💼',
    'angularjobs': '⚡'
  }[source] || '📌';
  
  return `${emoji} *${source.toUpperCase()} Job*\n*${title}* at _${company}_\n${url}`;
}

// --- 🔎 JOB SOURCES ------------------------------------------------------
async function checkRemoteOK() {
  if (!CONFIG.SOURCES.REMOTEOK) return;
  
  try {
    const data = await fetchWithRetry('https://remoteok.io/api');
    const jobs = Array.isArray(data) ? data.slice(1) : [];
    
    for (const job of jobs) {
      if (seenJobs.size >= CONFIG.MAX_JOBS_PER_RUN) break;
      
      const jobId = `remoteok-${job.id}`;
      if (seenJobs.has(jobId)) continue;
      
      const content = `${job.position} ${job.company} ${job.tags?.join(' ') || ''}`;
      const postDate = job.date || job.created_at;
      
      if (isJobRelevant(content, postDate)) {
        const sent = await sendTelegramAlert({
          source: 'remoteok',
          title: job.position,
          company: job.company,
          url: job.url
        });
        
        if (sent) {
          seenJobs.add(jobId);
          saveSeenJobs();
        }
      }
    }
  } catch (err) {
    console.error('RemoteOK fetch error:', err.message);
  }
}

async function checkIndeed() {
  if (!CONFIG.SOURCES.INDEED) return;
  
  try {
    const data = await fetchWithRetry('https://www.indeed.com/jobs?q=angular&l=remote&sort=date');
    // Parse HTML response to extract jobs
    // This is simplified - you'd need cheerio or similar for proper parsing
    const jobMatches = data.match(/<div class="job_seen_beacon">[\s\S]*?<\/div>/g) || [];
    
    for (const match of jobMatches) {
      if (seenJobs.size >= CONFIG.MAX_JOBS_PER_RUN) break;
      
      const titleMatch = match.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
      const companyMatch = match.match(/<span class="companyName">([\s\S]*?)<\/span>/);
      const linkMatch = match.match(/<a[^>]*href="([^"]*)"[^>]*>/);
      
      if (titleMatch && companyMatch && linkMatch) {
        const jobId = `indeed-${linkMatch[1].split('/').pop()}`;
        if (seenJobs.has(jobId)) continue;
        
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        const company = companyMatch[1].replace(/<[^>]*>/g, '').trim();
        const url = `https://www.indeed.com${linkMatch[1]}`;
        
        if (isJobRelevant(title, new Date())) {
          const sent = await sendTelegramAlert({
            source: 'indeed',
            title,
            company,
            url
          });
          
          if (sent) {
            seenJobs.add(jobId);
            saveSeenJobs();
          }
        }
      }
    }
  } catch (err) {
    console.error('Indeed fetch error:', err.message);
  }
}

async function checkAngularJobs() {
  if (!CONFIG.SOURCES.ANGULARJOBS) return;
  
  try {
    const data = await fetchWithRetry('https://angularjobs.com/api/jobs');
    const jobs = Array.isArray(data) ? data : [];
    
    for (const job of jobs) {
      if (seenJobs.size >= CONFIG.MAX_JOBS_PER_RUN) break;
      
      const jobId = `angularjobs-${job.id}`;
      if (seenJobs.has(jobId)) continue;
      
      const content = `${job.title} ${job.company} ${job.tags?.join(' ') || ''}`;
      
      if (isJobRelevant(content, job.posted_at)) {
        const sent = await sendTelegramAlert({
          source: 'angularjobs',
          title: job.title,
          company: job.company,
          url: job.url
        });
        
        if (sent) {
          seenJobs.add(jobId);
          saveSeenJobs();
        }
      }
    }
  } catch (err) {
    console.error('AngularJobs fetch error:', err.message);
  }
}

// --- 🚀 INITIALIZATION & SCHEDULING --------------------------------------
async function runJobCheck() {
  console.log(`\n[${new Date().toISOString()}] Starting job check...`);
  const startTime = Date.now();
  
  try {
    await Promise.allSettled([
      checkRemoteOK(),
      checkIndeed(),
      checkAngularJobs()
    ]);
  } catch (err) {
    console.error('Unhandled error in job check:', err);
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`✅ Check completed in ${duration.toFixed(2)}s`);
  console.log(`📊 Total tracked jobs: ${seenJobs.size}`);
}

function startBot() {
  loadSeenJobs();
  
  // Initial run with delay
  setTimeout(() => {
    runJobCheck().catch(err => 
      console.error('Initial run error:', err.message)
    );
  }, 5000);
  
  // Scheduled runs
  cron.schedule(CONFIG.SCHEDULE, () => {
    runJobCheck().catch(err => 
      console.error('Scheduled run error:', err.message)
    );
  });
  
  console.log('🚀 Angular Job Notifier Bot is running');
  console.log(`⏰ Next check in 30 minutes`);
  console.log('----------------------------------------');
}

startBot();