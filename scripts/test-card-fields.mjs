#!/usr/bin/env node
/**
 * Test which fields actually work for the card model in Codecks API
 */

import { CodecksClient } from '../dist/services/codecks-client.js';

const client = new CodecksClient(process.env.CODECKS_AUTH_TOKEN, process.env.CODECKS_ACCOUNT_SUBDOMAIN);

// Fields commonly used in card queries
const cardFields = [
  'id',
  'accountSeq',
  'title',
  'content',
  'derivedStatus',
  'effort',
  'priority',
  'createdAt',
  'lastUpdatedAt',
  'status',
  'assigneeId',
  'deckId',
  'milestoneId',
  'sprintId',
  'isDoc',
  'version'
];

console.log('Testing card fields...\n');

for (const field of cardFields) {
  try {
    const query = {_root: [{account: [{cards: [field]}]}]};
    await client.query(query);
    console.log(`✓ ${field}`);
  } catch (e) {
    console.error(`✗ ${field} - ${e.message.slice(0, 60)}`);
  }
}

console.log('\n--- Testing combinations ---\n');

const combinations = [
  ['id'],
  ['id', 'title'],
  ['id', 'title', 'content'],
  ['id', 'title', 'derivedStatus'],
];

for (const combo of combinations) {
  try {
    const query = {_root: [{account: [{cards: combo}]}]};
    const result = await client.query(query);
    console.log(`✓ [${combo.join(', ')}] - ${Object.keys(result.card || {}).length} cards found`);
  } catch (e) {
    console.error(`✗ [${combo.join(', ')}] - ${e.message.slice(0, 60)}`);
  }
}
