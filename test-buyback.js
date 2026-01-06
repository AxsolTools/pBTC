// Test script to trigger buyback cron
const https = require('https');
const http = require('http');

const url = process.env.APP_URL || 'http://localhost:3000';
const cronSecret = process.env.CRON_SECRET || '';

const endpoint = `${url}/api/admin/trigger-buyback`;

console.log(`[TEST] Triggering buyback at: ${endpoint}`);
console.log(`[TEST] Using CRON_SECRET: ${cronSecret ? '***' + cronSecret.slice(-4) : 'NOT SET'}`);

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cronSecret}`
  }
};

const client = url.startsWith('https') ? https : http;

const req = client.request(endpoint, options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`[TEST] Status: ${res.statusCode}`);
    console.log(`[TEST] Response:`, data);
    try {
      const json = JSON.parse(data);
      console.log(`[TEST] Parsed:`, JSON.stringify(json, null, 2));
    } catch (e) {
      console.log(`[TEST] Raw response:`, data);
    }
  });
});

req.on('error', (error) => {
  console.error(`[TEST] Error:`, error.message);
});

req.end();

