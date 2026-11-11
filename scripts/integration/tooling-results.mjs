/** Node TAP aggregation for QA tools only; absent/zero/skipped/todo runs never certify a pass. */
export function inspectToolingRun(exitCode, output) {
  const count = (name) => {
    const match = output.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
    return match ? Number(match[1]) : null;
  };
  const stats = {
    total: count("tests"),
    passed: count("pass"),
    failed: count("fail"),
    skipped: count("skipped"),
    todo: count("todo"),
    cancelled: count("cancelled"),
  };
  return {
    stats,
    passed:
      exitCode === 0 &&
      stats.total > 0 &&
      stats.passed === stats.total &&
      [stats.failed, stats.skipped, stats.todo, stats.cancelled].every(
        (n) => n === 0,
      ),
  };
}
