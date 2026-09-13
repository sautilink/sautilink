import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] || 'android/app/google-services.json');
if (!fs.existsSync(target)) throw new Error(`Firebase Android config not found: ${target}`);

const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
if (parsed?.project_info?.project_id !== 'sautilink') {
  throw new Error('Firebase project_id must be sautilink');
}

const clients = Array.isArray(parsed?.client) ? parsed.client : [];
const androidClient = clients.find((client) => client?.client_info?.android_client_info?.package_name === 'com.sautilink.app');
if (!androidClient?.client_info?.mobilesdk_app_id) {
  throw new Error('Firebase config does not contain the com.sautilink.app Android client');
}

if (!Array.isArray(androidClient.api_key) || !androidClient.api_key.some((entry) => String(entry?.current_key || '').trim())) {
  throw new Error('Firebase Android config does not contain an API key');
}

console.log('Firebase Android config verified for project sautilink / com.sautilink.app');
