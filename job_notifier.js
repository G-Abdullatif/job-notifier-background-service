// 📦 Advanced Job Notifier Bot
// ✅ Fetches remote Angular-related jobs and notifies user via Telegram hourly with duplicate detection and persistent logging

const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const CHAT_ID = 'YOUR_CHAT_ID';

const KEYWORDS = [
  'angular', 'frontend', 'remote', 'typescript', 'arabic',
  'web developer', 'front-end', 'remote frontend', 'remote angular',
  'middle east', 'saudi', 'uae', 'qatar', 'kuwait', 'oman', 'bahrain', 'turkey'
];

const logFilePath = path.resolve(__dirname, 'job-log.json');

function loadSeenJobs() {
  if (!fs.existsSync(logFilePath)) return [];
  try {
    const data = fs.readFileSync(logFilePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading job log:', err);
    return [];
  }
}

function saveSeenJobs(jobs) {
  try {
    fs.writeFileSync(logFilePath, JSON.stringify(jobs, null, 2));
  } catch (err) {
    console.error('Error saving job log:', err);
  }
}

function matches(jobText) {
  const lower = jobText.toLowerCase();
  return KEYWORDS.some(keyword => lower.includes(keyword));
}

async function sendTelegramMessage(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}

const seenJobs = new Set(loadSeenJobs());

function recordJob(id) {
  seenJobs.add(id);
  saveSeenJobs([...seenJobs]);
}

async function checkRemoteOK() {
  try {
    const res = await axios.get('https://remoteok.com/api');
    const jobs = res.data.slice(1);
    let count = 0;
    for (const job of jobs) {
      const jobId = `remoteok-${job.id}`;
      const content = `${job.position} - ${job.company}\n${job.tags?.join(', ')}\n${job.url}`;
      if (!seenJobs.has(jobId) && matches(content)) {
        await sendTelegramMessage(`🔥 *RemoteOK Job*\n*${job.position}* at _${job.company}_\n${job.url}`);
        recordJob(jobId);
        count++;
        if (count >= 5) break;
      }
    }
  } catch (err) {
    console.error('RemoteOK error:', err.message);
  }
}

async function checkRemotive() {
  try {
    const res = await axios.get('https://remotive.io/api/remote-jobs');
    const jobs = res.data.jobs;
    let count = 0;
    for (const job of jobs) {
      const jobId = `remotive-${job.id}`;
      const content = `${job.title} - ${job.company_name}\n${job.tags?.join(', ')}\n${job.url}`;
      if (!seenJobs.has(jobId) && matches(content)) {
        await sendTelegramMessage(`💼 *Remotive Job*\n*${job.title}* at _${job.company_name}_\n${job.url}`);
        recordJob(jobId);
        count++;
        if (count >= 5) break;
      }
    }
  } catch (err) {
    console.error('Remotive error:', err.message);
  }
}

async function checkWeWorkRemotely() {
  try {
    const feed = await parser.parseURL('https://weworkremotely.com/categories/remote-programming-jobs.rss');
    let count = 0;
    for (const item of feed.items) {
      const jobId = `wwr-${item.link}`;
      const content = `${item.title}\n${item.link}`;
      if (!seenJobs.has(jobId) && matches(content)) {
        await sendTelegramMessage(`🌍 *WWR Job*\n*${item.title}*\n${item.link}`);
        recordJob(jobId);
        count++;
        if (count >= 5) break;
      }
    }
  } catch (err) {
    console.error('WWR error:', err.message);
  }
}

async function checkJobs() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking jobs...`);
  await Promise.all([
    checkRemoteOK(),
    checkRemotive(),
    checkWeWorkRemotely()
  ]);
  console.log('✅ Job check complete');
}

// Run every 15 minutes
cron.schedule('*/30 * * * *', checkJobs);

// Initial run with rate limit for first-time flood prevention
(async () => {
  console.log('Initial startup delay to prevent flood...');
  setTimeout(() => checkJobs(), 60 * 1000); // Wait 60 sec before first run
})();
