const crypto = require('crypto');

// Generate a secure random secret
const secret = crypto.randomBytes(32).toString('hex');

console.log('\n=== CRON_SECRET (Plaintext) ===\n');
console.log(secret);
console.log('\n📋 Copy this EXACT value and paste it into DigitalOcean CRON_SECRET:\n');
console.log(secret);
console.log('\n✅ This is a plaintext secret - no encryption needed!\n');
console.log('⚠️  Make sure this SAME value is set in both:');
console.log('   1. App environment variables (CRON_SECRET)');
console.log('   2. Cron job environment variables (CRON_SECRET)');
console.log('\n');

