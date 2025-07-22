// 📦 Robust Angular Job Notifier Bot v1.3
// ✅ Fixed API issues with enhanced headers
// ✅ Added proxy support and exponential backoff
// ✅ Comprehensive error handling and logging

const Parser = require('rss-parser');
const axios = require('axios');

const parser = new Parser({
  customFetch: async (url) => {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    return {
      ok: true,
      status: response.status,
      text: async () => response.data
    };
  }
});

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
  MAX_JOB_AGE_MINUTES: 180,  // 3 hour window
  MAX_JOBS_PER_RUN: 30,
  REQUEST_RETRIES: 3,
  REQUEST_TIMEOUT: 15000,    // 15 seconds
  PROXY: null,               // 'http://user:pass@host:port'
  REQUIRED_KEYWORDS: ['angular', 'frontend', 'typescript'],
  EXCLUDED_KEYWORDS: [
    'react', 'vue', 'backend', 
    'node.js', 'python', 'java',
    'php', 'wordpress', 'django'
  ],
  SOURCES: {
    REMOTEOK: true,
    REMOTIVE: false,         // Disabled due to API issues
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
    console.error('❌ Error loading job log:', err.message);
  }
}

function saveSeenJobs() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify([...seenJobs], null, 2));
    console.log(`💾 Saved ${seenJobs.size} jobs to log file`);
  } catch (err) {
    console.error('❌ Error saving job log:', err.message);
  }
}

// --- 🛡️ REQUEST HELPER ---------------------------------------------------
async function fetchWithRetry(url, options = {}, retries = CONFIG.REQUEST_RETRIES) {
  try {
    const config = {
      url,
      timeout: CONFIG.REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...options.headers
      },
      ...options
    };

    // Proxy configuration
    if (CONFIG.PROXY) {
      const proxyParts = new URL(CONFIG.PROXY);
      config.proxy = {
        protocol: proxyParts.protocol,
        host: proxyParts.hostname,
        port: proxyParts.port,
        auth: {
          username: proxyParts.username,
          password: proxyParts.password
        }
      };
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (retries > 0) {
      const delay = Math.pow(2, CONFIG.REQUEST_RETRIES - retries) * 1000;
      console.log(`🔄 Retrying ${url} (${retries} left) in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
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
    console.error('📡 Telegram send error:', err.response?.data || err.message);
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
    console.log('🔍 Checking RemoteOK...');
    const data = await fetchWithRetry('https://remoteok.io/api', {
      headers: {
        'Referer': 'https://remoteok.io/',
        'Origin': 'https://remoteok.io'
      }
    });
    
    const jobs = Array.isArray(data) ? data.slice(1) : [];
    console.log(`ℹ️ Found ${jobs.length} jobs on RemoteOK`);
    
    let newJobs = 0;
    for (const job of jobs) {
      if (seenJobs.size >= CONFIG.MAX_JOBS_PER_RUN) break;
      
      const jobId = `remoteok-${job.id}`;
      if (seenJobs.has(jobId)) continue;
      
      const content = `${job.position} ${job.company} ${job.tags?.join(' ') || ''} ${job.description || ''}`;
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
          newJobs++;
        }
      }
    }
    
    if (newJobs > 0) {
      saveSeenJobs();
      console.log(`✅ Sent ${newJobs} new jobs from RemoteOK`);
    }
  } catch (err) {
    console.error('❌ RemoteOK fetch error:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Headers:', err.response.headers);
    }
  }
}

async function checkWeWorkRemotely() {
  if (!CONFIG.SOURCES.WEWORKREMOTELY) return;
  
  try {
    console.log('🔍 Checking WeWorkRemotely...');
    const feed = await parser.parseURL(
      'https://weworkremotely.com/categories/remote-programming-jobs.rss',
      {
        headers: {
          'Referer': 'https://weworkremotely.com/',
          'Accept': 'application/rss+xml'
        }
      }
    );
    
    const items = feed.items || [];
    console.log(`ℹ️ Found ${items.length} jobs on WeWorkRemotely`);
    
    let newJobs = 0;
    for (const item of items) {
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
          newJobs++;
        }
      }
    }
    
    if (newJobs > 0) {
      saveSeenJobs();
      console.log(`✅ Sent ${newJobs} new jobs from WeWorkRemotely`);
    }
  } catch (err) {
    console.error('❌ WeWorkRemotely fetch error:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
    }
  }
}

// --- 🚀 INITIALIZATION & SCHEDULING --------------------------------------
async function runJobCheck() {
  console.log(`\n⏳ [${new Date().toISOString()}] Starting job check...`);
  const startTime = Date.now();
  
  try {
    await Promise.allSettled([
      checkRemoteOK(),
      checkWeWorkRemotely()
    ]);
  } catch (err) {
    console.error('⚠️ Unhandled error in job check:', err);
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`🏁 Check completed in ${duration.toFixed(2)}s`);
  console.log(`📊 Total tracked jobs: ${seenJobs.size}`);
}

function startBot() {
  // Load previous job IDs
  loadSeenJobs();
  
  // Initial run with delay
  setTimeout(() => {
    runJobCheck().catch(err => 
      console.error('⚠️ Initial run error:', err.message)
    );
  }, 5000);
  
  // Scheduled runs
  cron.schedule(CONFIG.SCHEDULE, () => {
    runJobCheck().catch(err => 
      console.error('⚠️ Scheduled run error:', err.message)
    );
  });
  
  console.log('\n🚀 Angular Job Notifier Bot is running');
  console.log(`⏰ Next check in 30 minutes`);
  console.log('----------------------------------------');
}

// Start the bot
startBot();