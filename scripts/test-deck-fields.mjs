#!/usr/bin/env node
/**
 * Test which fields actually work for the deck model in Codecks API
 */

import { CodecksClient } from '../dist/services/codecks-client.js';

const client = new CodecksClient(process.env.CODECKS_AUTH_TOKEN, process.env.CODECKS_ACCOUNT_SUBDOMAIN);

// Fields from the schema
const deckFields = [
  'id',
  'name',
  'type',
  'description',
  'isArchived',
  'coverFile',
  'createdAt',
  'lastUpdatedAt',
  'accountSeq',
  'icon',
  'heroFile',
  'sortOrder'
];

console.log('Testing deck fields...\n');

for (const field of deckFields) {
  try {
    const query = {_root: [{account: [{decks: [field]}]}]};
    await client.query(query);
    console.log(`✓ ${field}`);
  } catch (e) {
    console.error(`✗ ${field} - ${e.message}`);
  }
}

console.log('\n--- Testing combinations that should work ---\n');

// Test common combinations
const combinations = [
  ['id'],
  ['id', 'accountSeq'],
  // Add more once we know what works
];

for (const combo of combinations) {
  try {
    const query = {_root: [{account: [{decks: combo}]}]};
    const result = await client.query(query);
    console.log(`✓ [${combo.join(', ')}] - ${Object.keys(result.deck || {}).length} decks found`);
  } catch (e) {
    console.error(`✗ [${combo.join(', ')}] - ${e.message}`);
  }
}
