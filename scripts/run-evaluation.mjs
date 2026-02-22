#!/usr/bin/env node

/**
 * MCP Evaluation Test Runner
 * 
 * Runs the evaluation suite against the Codecks MCP server and generates a report.
 * 
 * Usage:
 *   node scripts/run-evaluation.mjs [--verbose]
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXML = promisify(parseString);

const VERBOSE = process.argv.includes('--verbose');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function loadEvaluation() {
  const xml = readFileSync('./evaluations/codecks-mcp-eval.xml', 'utf-8');
  const parsed = await parseXML(xml);
  return parsed.evaluation;
}

async function callMCPTool(toolName, params = {}) {
  return new Promise((resolve, reject) => {
    const mcp = spawn('node', ['dist/index.js'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    mcp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    mcp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    mcp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MCP server exited with code ${code}: ${stderr}`));
      } else {
        try {
          // Parse MCP protocol response
          const lines = stdout.split('\n').filter(l => l.trim());
          const jsonLine = lines.find(l => l.startsWith('{'));
          if (jsonLine) {
            resolve(JSON.parse(jsonLine));
          } else {
            reject(new Error('No JSON response from MCP server'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse MCP response: ${e.message}`));
        }
      }
    });

    // Send tool call request via MCP protocol
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    };

    mcp.stdin.write(JSON.stringify(request) + '\n');
    mcp.stdin.end();
  });
}

async function runQuestion(qa, index) {
  const question = qa.question[0];
  const answerMeta = qa.answer[0];
  const notes = qa.notes ? qa.notes[0] : '';

  log(`\n[${ index + 1}] ${question}`, 'blue');
  if (VERBOSE && notes) {
    log(`   Notes: ${notes}`, 'gray');
  }

  try {
    const meta = JSON.parse(answerMeta);
    
    if (meta.tool) {
      // Single tool call
      if (VERBOSE) {
        log(`   Calling: ${meta.tool}`, 'gray');
      }
      
      const result = await callMCPTool(meta.tool, meta.params || {});
      
      if (VERBOSE) {
        log(`   Result: ${JSON.stringify(result).slice(0, 200)}...`, 'gray');
      }
      
      // Simple validation
      if (meta.contains) {
        const hasAll = meta.contains.every(field => 
          JSON.stringify(result).includes(field)
        );
        if (hasAll) {
          log('   ✓ PASS', 'green');
          return { pass: true, question, result };
        } else {
          log('   ✗ FAIL - Missing expected fields', 'red');
          return { pass: false, question, error: 'Missing fields' };
        }
      }
      
      log('   ✓ PASS (no validation)', 'green');
      return { pass: true, question, result };
      
    } else if (meta.tools) {
      // Multi-step tool calls
      log('   ⚠ SKIP - Multi-step evaluations require manual verification', 'yellow');
      return { pass: null, question, skipped: true };
    }
  } catch (error) {
    log(`   ✗ FAIL - ${error.message}`, 'red');
    return { pass: false, question, error: error.message };
  }
}

async function main() {
  log('╔═══════════════════════════════════════════╗', 'blue');
  log('║  Codecks MCP Server Evaluation Runner    ║', 'blue');
  log('╚═══════════════════════════════════════════╝', 'blue');

  try {
    const evaluation = await loadEvaluation();
    const metadata = evaluation.metadata[0];
    
    log(`\nTitle: ${metadata.title[0]}`);
    log(`Description: ${metadata.description[0]}`);
    log(`Version: ${metadata.version[0]}\n`);

    const qaList = evaluation.qa_pair;
    const results = [];

    for (let i = 0; i < qaList.length; i++) {
      const result = await runQuestion(qaList[i], i);
      results.push(result);
      
      // Small delay between tests
      await new Promise(r => setTimeout(r, 100));
    }

    // Summary
    log('\n╔═══════════════════════════════════════════╗', 'blue');
    log('║            EVALUATION SUMMARY             ║', 'blue');
    log('╚═══════════════════════════════════════════╝', 'blue');

    const passed = results.filter(r => r.pass === true).length;
    const failed = results.filter(r => r.pass === false).length;
    const skipped = results.filter(r => r.pass === null).length;
    const total = results.length;

    log(`\nTotal Questions: ${total}`);
    log(`Passed: ${passed}`, 'green');
    log(`Failed: ${failed}`, failed > 0 ? 'red' : 'reset');
    log(`Skipped: ${skipped}`, skipped > 0 ? 'yellow' : 'reset');
    
    const passRate = total > 0 ? ((passed / (total - skipped)) * 100).toFixed(1) : 0;
    log(`\nPass Rate: ${passRate}%`, passRate >= 80 ? 'green' : 'yellow');

    if (failed > 0) {
      log('\n Failed Questions:', 'red');
      results.filter(r => r.pass === false).forEach((r, i) => {
        log(`  ${i + 1}. ${r.question}`, 'red');
        log(`     Error: ${r.error}`, 'gray');
      });
    }

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    log(`\nFatal error: ${error.message}`, 'red');
    if (VERBOSE) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
