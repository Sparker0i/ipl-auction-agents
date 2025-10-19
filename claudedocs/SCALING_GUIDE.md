# Agent Scaling Guide - 9800X3D Configuration

## Current Configuration: 9 Agents Optimized

Your system (9800X3D, 32GB RAM) can comfortably handle all 9 agents with proper staggering.

### What Changed from Default

**Before** (caused 100% CPU):
- 9 agents spawning **simultaneously** (instant spike)
- No delay between spawns
- Non-headless browsers (GPU overhead)
- All agents hitting Ollama at same time

**After** (optimized):
- 9 agents spawning with **2-second stagger** (gradual ramp-up)
- Headless browsers (reduced overhead)
- Random 0-500ms LLM delays (distributed load)
- Reduced browser slowMo (50ms instead of 100ms)

---

## Agent Spawn Timeline

With `agentStaggerDelay: 2000`:

```
t=0s    → Agent 1 (CSK) spawns
t=2s    → Agent 2 (MI) spawns
t=4s    → Agent 3 (RCB) spawns
t=6s    → Agent 4 (DC) spawns
t=8s    → Agent 5 (PBKS) spawns
t=10s   → Agent 6 (RR) spawns
t=12s   → Agent 7 (KKR) spawns
t=14s   → Agent 8 (LSG) spawns
t=16s   → Agent 9 (SRH) spawns
t=18s   → All agents running (gradual CPU ramp over 18 seconds)
```

**Expected CPU curve**:
- 0-18s: Gradual increase (10% → 50%)
- 18s+: Stable at 40-60% (during auction)
- Spikes to 70-80% during simultaneous decisions

---

## Quick Tuning Options

### If CPU Still High (>70%)

**Option 1: Increase stagger delay** (safest)
```bash
# In .env
AGENT_STAGGER_DELAY=3000  # 3 seconds instead of 2
```

**Option 2: Reduce concurrent agents**
```bash
# In .env
MAX_CONCURRENT_AGENTS=6  # Only 6 agents instead of 9
```

**Option 3: Increase browser slowdown**
```bash
# In .env
BROWSER_SLOW_MO=100  # Slower browser actions = less CPU
```

### If You Want More Performance

**Option 1: Faster spawning**
```bash
AGENT_STAGGER_DELAY=1000  # 1 second stagger
```

**Option 2: Faster browser**
```bash
BROWSER_SLOW_MO=0  # No artificial slowdown
```

---

## Environment Variable Override (Quick Testing)

You can override config without editing JSON files:

```bash
# Test with different agent counts
MAX_CONCURRENT_AGENTS=5 npm start

# Test with different stagger
AGENT_STAGGER_DELAY=4000 npm start

# Test with visible browsers (debugging)
AGENT_HEADLESS=false npm start
```

---

## CPU Usage Expectations

### Optimal Configuration (Current)
- **Idle**: ~5% (no agents running)
- **Spawning**: 10% → 50% (gradual over 18s)
- **Running**: 40-60% (all 9 agents active)
- **Decision Peaks**: 70-80% (brief spikes during LLM queries)

### If You See 100% CPU
Possible causes:
1. ❌ **Stagger delay not working** → Check logs for spawn timestamps
2. ❌ **Ollama overloaded** → Increase LLM_TIMEOUT to 10000
3. ❌ **Too many browser tabs** → Each agent opens a browser instance
4. ❌ **Background processes** → Close Chrome, VS Code, Docker, etc.

---

## Configuration Files Priority

1. **Environment variables** (`.env`) - Highest priority
2. **Config file** (`config/default.json`) - Default values
3. **Code defaults** - Fallback if nothing specified

---

## Monitoring Agent Performance

### Check Agent Logs
```bash
tail -f logs/agents/*.log
```

Look for:
- ✅ `Agent spawned successfully` (2-second intervals)
- ✅ `Querying LLM for decision` with `delay` field
- ✅ `Bid placed successfully`
- ❌ `Ollama query failed` (if too many, increase timeout)

### Check System Resources
```bash
# CPU per process
top -p $(pgrep -d',' -f "node.*agent")

# Memory usage
ps aux | grep node | awk '{sum+=$6} END {print sum/1024 "MB"}'
```

---

## Recommended Settings by System

### Your System (9800X3D, 32GB RAM) - Current
```json
{
  "maxConcurrentAgents": 9,
  "agentStaggerDelay": 2000,
  "browser": { "headless": true, "slowMo": 50 }
}
```
**Expected**: 40-60% CPU, 3-4GB RAM

### If Running Other Apps (Docker, Chrome, etc.)
```json
{
  "maxConcurrentAgents": 6,
  "agentStaggerDelay": 2000,
  "browser": { "headless": true, "slowMo": 50 }
}
```
**Expected**: 30-50% CPU, 2-3GB RAM

### Conservative (Maximum Stability)
```json
{
  "maxConcurrentAgents": 5,
  "agentStaggerDelay": 3000,
  "browser": { "headless": true, "slowMo": 100 }
}
```
**Expected**: 25-40% CPU, 2GB RAM

---

## Common Issues & Fixes

### "Only 3 agents spawn instead of 9"
**Cause**: Old config cached or env variable override
**Fix**:
```bash
# Check current config
cat config/default.json | grep maxConcurrentAgents

# Should show: "maxConcurrentAgents": 9

# Clear any env overrides
unset MAX_CONCURRENT_AGENTS

# Restart orchestrator
npm start
```

### "CPU still at 100% with stagger"
**Cause**: Agents all hitting Ollama simultaneously when new player appears
**Fix**: Already implemented - random 0-500ms delay before LLM queries
**Verify**: Check logs for `delay:` field in LLM queries

### "Agents stop after spawning"
**Cause**: Frontend URL incorrect or auction not started
**Fix**:
```bash
# Check frontend is running
curl http://localhost:8080

# Check auction code is correct
grep AUCTION_CODE .env
```

---

## Performance Benchmarks

### Spawn Time (9 agents)
- **Before**: 0s (all at once) → 100% CPU spike
- **After**: 18s (staggered) → Gradual 10% → 50%

### Memory Usage (9 agents)
- **Headless**: ~300-400MB per agent = ~3.5GB total
- **Non-headless**: ~500-600MB per agent = ~5GB total

### LLM Query Load
- **Without random delay**: All 9 agents query simultaneously → Ollama timeout
- **With random delay**: Queries spread over 0-500ms → Smooth operation

---

## Advanced: Dynamic Agent Scaling (Future Enhancement)

If you want to implement adaptive scaling:

```typescript
// Pseudo-code for future implementation
if (cpuUsage > 80%) {
  reduceSlowMo(50 → 100);  // Slow down browsers
  increaseLLMDelay(500 → 1000);  // Spread out queries
}

if (cpuUsage < 30%) {
  optimizeSlowMo(50 → 25);  // Speed up browsers
  reduceLLMDelay(500 → 250);  // Faster decisions
}
```

This could be added to the orchestrator's health monitoring system.

---

## Quick Reference

| Setting | Default | Your System | Conservative |
|---------|---------|-------------|--------------|
| Max Agents | 9 | 9 | 5 |
| Stagger Delay | 0ms | 2000ms | 3000ms |
| Headless | false | true | true |
| SlowMo | 100ms | 50ms | 100ms |
| LLM Timeout | 5000ms | 5000ms | 10000ms |

---

**Current Status**: ✅ Configured for 9 agents with optimal CPU distribution
**Expected CPU**: 40-60% during auction (peaks to 70-80%)
**Total Spawn Time**: 18 seconds (2s × 9 agents)
