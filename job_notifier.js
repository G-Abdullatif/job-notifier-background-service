// 📦 Enhanced Angular Job Notifier Bot
// ✅ Aggressively filters for Angular jobs while excluding other frameworks
// ✅ Configurable time window for job freshness
// ✅ Persistent memory with JSON backup
// ✅ Rate limiting and duplicate prevention
// ✅ Detailed logging and error handling

const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// --- ⚙️ CONFIGURATION ----------------------------------------------------
const CONFIG = {
  TELEGRAM: {
    BOT_TOKEN: '7558091348:AAGh2jSqVZzTptpsMovjYsFoVpPbLtxXPwg',
    CHAT_ID: '1745428077'
  },
  SCHEDULE: '*/30 * * * *', // Every 30 minutes
  MAX_JOB_AGE_MINUTES: 90, // 1.5 hour window
  MAX_JOBS_PER_RUN: 5, // Prevent flooding
  REQUIRED_KEYWORDS: ['angular', 'frontend', 'typescript'],
  EXCLUDED_KEYWORDS: [
    'react', 'vue', 'backend', 
    'node.js', 'python', 'java',
    'php', 'wordpress', 'django'
  ],
  SOURCES: {
    REMOTEOK: true,
    REMOTIVE: true,
    WEWORKREMOTELY: true
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

// --- 🧠 CORE LOGIC --------------------------------------------------------

function isJobRelevant(text, postDate) {
  const lowerText = text.toLowerCase();
  const isRecent = isJobRecent(postDate);
  const matchesKeywords = hasRequiredKeywords(lowerText);
  const noExcludedTerms = !hasExcludedKeywords(lowerText);
  
  return isRecent && matchesKeywords && noExcludedTerms;
}

function isJobRecent(postDate) {
  const jobDate = new Date(postDate);
  const cutoff = Date.now() - (CONFIG.MAX_JOB_AGE_MINUTES * 60 * 1000);
  return jobDate >= cutoff;
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
      }
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
    'remotive': '💼',
    'weworkremotely': '🌍'
  }[source] || '📌';
  
  return `${emoji} *${source.toUpperCase()} Job*\n*${title}* at _${company}_\n${url}`;
}

// --- 🔎 JOB SOURCES ------------------------------------------------------

async function checkRemoteOK() {
  if (!CONFIG.SOURCES.REMOTEOK) return;
  
  try {
    const { data } = await axios.get('https://remoteok.com/api');
    const jobs = data.slice(1); // Skip metadata
    
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

async function checkRemotive() {
  if (!CONFIG.SOURCES.REMOTIVE) return;
  
  try {
    const { data } = await axios.get('https://remotive.io/api/remote-jobs');
    const jobs = data.jobs;
    
    for (const job of jobs) {
      if (seenJobs.size >= CONFIG.MAX_JOBS_PER_RUN) break;
      
      const jobId = `remotive-${job.id}`;
      if (seenJobs.has(jobId)) continue;
      
      const content = `${job.title} ${job.company_name} ${job.tags?.join(' ') || ''}`;
      
      if (isJobRelevant(content, job.publication_date)) {
        const sent = await sendTelegramAlert({
          source: 'remotive',
          title: job.title,
          company: job.company_name,
          url: job.url
        });
        
        if (sent) {
          seenJobs.add(jobId);
          saveSeenJobs();
        }
      }
    }
  } catch (err) {
    console.error('Remotive fetch error:', err.message);
  }
}

async function checkWeWorkRemotely() {
  if (!CONFIG.SOURCES.WEWORKREMOTELY) return;
  
  try {
    const feed = await parser.parseURL(
      'https://weworkremotely.com/categories/remote-programming-jobs.rss'
    );
    
    for (const item of feed.items) {
      if (seenJobs.size >= CONFIG.MAX_JOBS_PER_RUN) break;
      
      const jobId = `wwr-${item.guid || item.link}`;
      if (seenJobs.has(jobId)) continue;
      
      const content = `${item.title} ${item.contentSnippet || ''}`;
      
      if (isJobRelevant(content, item.pubDate || item.isoDate)) {
        const sent = await sendTelegramAlert({
          source: 'weworkremotely',
          title: item.title,
          company: item.creator || 'Unknown',
          url: item.link
        });
        
        if (sent) {
          seenJobs.add(jobId);
          saveSeenJobs();
        }
      }
    }
  } catch (err) {
    console.error('WeWorkRemotely fetch error:', err.message);
  }
}

// --- 🚀 INITIALIZATION & SCHEDULING --------------------------------------

async function runJobCheck() {
  console.log(`\n[${new Date().toISOString()}] Starting job check...`);
  const startTime = Date.now();
  
  await Promise.all([
    checkRemoteOK(),
    checkRemotive(),
    checkWeWorkRemotely()
  ]);
  
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
}

startBot();