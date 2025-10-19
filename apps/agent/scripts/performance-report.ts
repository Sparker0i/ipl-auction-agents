#!/usr/bin/env tsx
/**
 * Performance Report CLI Script
 * Generates performance analysis from profiler data
 */

import * as fs from 'fs';
import * as path from 'path';

const REPORTS_DIR = path.join(process.cwd(), 'reports');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npm run performance <profiler-data.json>');
    console.log('');
    console.log('Example:');
    console.log('  npm run performance reports/profiler-ABCD12.json');
    process.exit(1);
  }

  const dataFile = args[0];

  if (!fs.existsSync(dataFile)) {
    console.error(`❌ File not found: ${dataFile}`);
    process.exit(1);
  }

  console.log(`📊 Loading profiler data: ${dataFile}`);

  try {
    // Load profiler data
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    // Generate report
    console.log('📝 Generating performance report...');
    const report = generatePerformanceReport(data);

    // Create reports directory
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // Save report
    const basename = path.basename(dataFile, '.json');
    const reportFile = path.join(REPORTS_DIR, `${basename}-report.md`);
    fs.writeFileSync(reportFile, report, 'utf-8');

    console.log(`✅ Report saved: ${reportFile}`);

    // Print key metrics
    console.log('');
    console.log('📊 Key Performance Metrics:');
    console.log(`   Total Decisions: ${data.systemMetrics.totalDecisions}`);
    console.log(
      `   Avg Decision Time: ${Math.round(data.systemMetrics.averageSystemDecisionTime)}ms`
    );
    console.log(
      `   Peak Concurrent Agents: ${data.systemMetrics.peakConcurrentAgents}`
    );
    console.log(
      `   LLM Cache Hit Rate: ${calculateCacheHitRate(data.systemMetrics)}%`
    );
    console.log(
      `   Memory Usage: ${data.systemMetrics.memoryUsageMB}MB`
    );
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function generatePerformanceReport(data: any): string {
  const duration = data.endTime
    ? new Date(data.endTime).getTime() - new Date(data.startTime).getTime()
    : Date.now() - new Date(data.startTime).getTime();

  const durationMinutes = Math.round(duration / 60000);

  let report = '# Performance Report\n\n';
  report += `**Generated**: ${new Date().toISOString()}\n`;
  report += `**Duration**: ${durationMinutes} minutes\n`;
  report += `**Start**: ${data.startTime}\n`;
  if (data.endTime) {
    report += `**End**: ${data.endTime}\n`;
  }

  report += '\n## System Metrics\n\n';
  report += `- **Total Decisions**: ${data.systemMetrics.totalDecisions}\n`;
  report += `- **Average Decision Time**: ${Math.round(data.systemMetrics.averageSystemDecisionTime)}ms\n`;
  report += `- **Peak Concurrent Agents**: ${data.systemMetrics.peakConcurrentAgents}\n`;
  report += `- **Total LLM Calls**: ${data.systemMetrics.totalLLMCalls}\n`;
  report += `- **LLM Cache Hit Rate**: ${calculateCacheHitRate(data.systemMetrics)}%\n`;
  report += `- **Memory Usage**: ${data.systemMetrics.memoryUsageMB}MB\n`;

  report += '\n## Agent Performance\n\n';
  report += '| Team | Decisions | Avg Time (ms) | Min/Max (ms) | LLM Success | Bids | Won | Spent (L) | Squad |\n';
  report += '|------|-----------|---------------|--------------|-------------|------|-----|-----------|-------|\n';

  // Convert Map to array for sorting
  const agents = Array.from(Object.entries(data.agentMetrics)).map(
    ([_, value]) => value as any
  );

  // Sort by team code
  agents.sort((a, b) => a.teamCode.localeCompare(b.teamCode));

  for (const agent of agents) {
    const avgTime = Math.round(agent.averageDecisionTime);
    const minTime =
      agent.minDecisionTime === Infinity
        ? 0
        : Math.round(agent.minDecisionTime);
    const maxTime = Math.round(agent.maxDecisionTime);
    const llmSuccess = (agent.llmSuccessRate * 100).toFixed(1);

    report += `| ${agent.teamCode} | ${agent.decisionsCount} | ${avgTime} | ${minTime}/${maxTime} | ${llmSuccess}% | ${agent.bidsPlaced} | ${agent.bidsWon} | ${agent.totalSpent} | ${agent.squadSize} |\n`;
  }

  report += '\n## Reliability Metrics\n\n';
  report += '| Team | Browser Crashes | Agent Restarts | LLM Timeouts | LLM Errors |\n';
  report += '|------|----------------|----------------|--------------|------------|\n';

  for (const agent of agents) {
    report += `| ${agent.teamCode} | ${agent.browserCrashes} | ${agent.restartCount} | ${agent.llmTimeouts} | ${agent.llmErrors} |\n`;
  }

  report += '\n## Decision Time Distribution\n\n';

  // Calculate percentiles
  const allTimings: number[] = [];
  for (const agent of agents) {
    if (agent.decisionTimings && Array.isArray(agent.decisionTimings)) {
      allTimings.push(...agent.decisionTimings);
    }
  }

  if (allTimings.length > 0) {
    allTimings.sort((a, b) => a - b);

    const p50 = calculatePercentile(allTimings, 50);
    const p95 = calculatePercentile(allTimings, 95);
    const p99 = calculatePercentile(allTimings, 99);

    report += `- **P50 (Median)**: ${Math.round(p50)}ms\n`;
    report += `- **P95**: ${Math.round(p95)}ms\n`;
    report += `- **P99**: ${Math.round(p99)}ms\n`;
  }

  report += '\n## Performance Analysis\n\n';

  // Decision speed analysis
  const avgDecisionTime = data.systemMetrics.averageSystemDecisionTime;
  if (avgDecisionTime < 3000) {
    report += '✅ **Decision Speed**: Excellent (<3s average)\n';
  } else if (avgDecisionTime < 5000) {
    report += '⚠️ **Decision Speed**: Good (3-5s average)\n';
  } else {
    report += '❌ **Decision Speed**: Needs improvement (>5s average)\n';
  }

  // LLM performance
  const cacheHitRate = calculateCacheHitRate(data.systemMetrics);
  if (cacheHitRate > 50) {
    report += '✅ **LLM Caching**: Effective (>50% hit rate)\n';
  } else if (cacheHitRate > 20) {
    report += '⚠️ **LLM Caching**: Moderate (20-50% hit rate)\n';
  } else {
    report += '❌ **LLM Caching**: Low (<20% hit rate)\n';
  }

  // Reliability
  const totalCrashes = agents.reduce(
    (sum, a) => sum + (a.browserCrashes || 0),
    0
  );
  const totalRestarts = agents.reduce(
    (sum, a) => sum + (a.restartCount || 0),
    0
  );

  if (totalCrashes === 0 && totalRestarts === 0) {
    report += '✅ **Reliability**: Perfect (no crashes or restarts)\n';
  } else if (totalCrashes + totalRestarts < 5) {
    report += '⚠️ **Reliability**: Good (few crashes/restarts)\n';
  } else {
    report += '❌ **Reliability**: Needs improvement (multiple crashes/restarts)\n';
  }

  report += '\n## Recommendations\n\n';

  if (avgDecisionTime > 4000) {
    report += '- Consider optimizing LLM query or increasing timeout threshold\n';
  }

  if (cacheHitRate < 30) {
    report += '- Implement LLM response caching to improve performance\n';
  }

  if (totalCrashes > 0) {
    report += '- Investigate browser stability issues\n';
  }

  const memUsage = data.systemMetrics.memoryUsageMB;
  if (memUsage > 2000) {
    report += '- High memory usage detected, consider optimization\n';
  }

  return report;
}

function calculateCacheHitRate(systemMetrics: any): number {
  const total = systemMetrics.totalLLMCalls || 0;
  if (total === 0) return 0;

  const hitRate = ((systemMetrics.llmCacheHits || 0) / total) * 100;
  return Math.round(hitRate * 10) / 10;
}

function calculatePercentile(sortedArray: number[], percentile: number): number {
  if (sortedArray.length === 0) return 0;

  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

main();
