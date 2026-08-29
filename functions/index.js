import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) {
  initializeApp();
}

export { scheduledSync } from './src/scheduled-sync.js';
export { onScrapeRequest } from './src/on-scrape-request.js';
export { scheduledVideoSync } from './src/scheduled-video-sync.js';
