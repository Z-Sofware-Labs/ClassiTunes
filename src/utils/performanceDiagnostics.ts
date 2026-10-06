import { logToFile } from './tauriWindow';

const PERFORMANCE_THRESHOLD_MS = 50;
const REPORT_INTERVAL_MS = 10_000;
const MEMORY_SAMPLE_INTERVAL_MS = 60_000;

interface PerformanceAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
  maxContext?: string;
}

interface ChromiumPerformanceMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

const aggregates = new Map<string, PerformanceAggregate>();
let enabled = true;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let memoryTimer: ReturnType<typeof setInterval> | null = null;
let longTaskObserver: PerformanceObserver | null = null;
let reportedUnavailableMemoryMetric = false;

export function recordPerformanceSample(name: string, durationMs: number, context?: string): void {
  if (!enabled || !Number.isFinite(durationMs) || durationMs < PERFORMANCE_THRESHOLD_MS) return;

  const aggregate = aggregates.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
  aggregate.count += 1;
  aggregate.totalMs += durationMs;
  if (durationMs > aggregate.maxMs) {
    aggregate.maxMs = durationMs;
    aggregate.maxContext = context;
  }
  aggregates.set(name, aggregate);
}

function flushPerformanceReport(): void {
  if (!enabled || aggregates.size === 0) return;

  const reports: string[] = [];
  aggregates.forEach((aggregate, name) => {
    const averageMs = aggregate.totalMs / aggregate.count;
    reports.push(
      `${name}: count=${aggregate.count}, avg=${averageMs.toFixed(1)}ms, max=${aggregate.maxMs.toFixed(1)}ms` +
        (aggregate.maxContext ? `, context=${aggregate.maxContext}` : ''),
    );
  });
  aggregates.clear();
  void logToFile(`[PERF] Operations over ${PERFORMANCE_THRESHOLD_MS}ms (last ${REPORT_INTERVAL_MS / 1000}s): ${reports.join(' | ')}`);
}

function logMemorySample(): void {
  if (!enabled) return;
  const memory = (performance as ChromiumPerformanceMemory).memory;
  if (!memory) {
    if (!reportedUnavailableMemoryMetric) {
      reportedUnavailableMemoryMetric = true;
      void logToFile('[PERF] JS heap metric is unavailable in this WebView; use Task Manager for total process memory.');
    }
    return;
  }

  const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
  void logToFile(
    `[PERF] JS heap: used=${toMb(memory.usedJSHeapSize)}MB, allocated=${toMb(memory.totalJSHeapSize)}MB, limit=${toMb(memory.jsHeapSizeLimit)}MB`,
  );
}

function startDiagnostics(): void {
  if (!reportTimer) {
    reportTimer = setInterval(flushPerformanceReport, REPORT_INTERVAL_MS);
  }
  if (!memoryTimer) {
    memoryTimer = setInterval(logMemorySample, MEMORY_SAMPLE_INTERVAL_MS);
  }
  if (!longTaskObserver && typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          recordPerformanceSample('Main-thread long task', entry.duration);
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: false });
    } catch {
      longTaskObserver = null;
    }
  }
}

function stopDiagnostics(): void {
  if (reportTimer) clearInterval(reportTimer);
  if (memoryTimer) clearInterval(memoryTimer);
  reportTimer = null;
  memoryTimer = null;
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  aggregates.clear();
}

export function configurePerformanceDiagnostics(shouldEnable: boolean): void {
  enabled = shouldEnable;
  if (enabled) {
    startDiagnostics();
    logMemorySample();
  } else {
    stopDiagnostics();
  }
}

export function recordReactCommit(
  id: string,
  phase: string,
  actualDuration: number,
): void {
  recordPerformanceSample(`React ${phase}: ${id}`, actualDuration);
}
