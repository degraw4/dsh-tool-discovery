import copy
import unittest
import report
import run


def record(arm, attempt=1, passed=True, tokens=100):
    return {
        'runId': f'task-{arm}-r1-a{attempt}', 'taskId': 'task', 'arm': arm,
        'repeat': 1, 'attempt': attempt, 'state': 'completed', 'passed': passed,
        'modelCalls': 1, 'durationMs': 1000,
        'usage': {'inputTokens': tokens, 'cacheReadTokens': 0, 'cacheWriteTokens': 0,
                  'outputTokens': 10, 'knownCalls': 1, 'unknownCalls': 0},
    }


class FirstSuccessAccountingTests(unittest.TestCase):
    def test_first_success_selected_and_all_attempts_accounted_for(self):
        rows = [record('full'), record('selective', passed=False), record('selective', 2), record('selective', 3, tokens=1)]
        original = copy.deepcopy(rows)
        result = report.analyze(rows, 1)
        self.assertEqual(result['selection']['runIds'], ['task-full-r1-a1', 'task-selective-r1-a2'])
        self.assertEqual(result['initialAttempts']['selective']['passed'], 0)
        self.assertEqual(result['allAttempts']['selective']['runs'], 3)
        self.assertEqual(result['successfulExecutions']['selective']['usage']['inputTokens'], 100)
        self.assertEqual(rows, original)

    def test_unresolved_slots_are_not_reported_as_complete(self):
        r = report.analyze([record('full'), record('selective', passed=False)], 1)
        self.assertFalse(r['selection']['complete'])
        self.assertEqual(r['successfulExecutions']['selective']['runs'], 0)

    def test_missing_counterpart_and_duplicate_attempt_are_rejected(self):
        for rows in [[record('full')], [record('full'), record('selective'), record('selective')]]:
            with self.assertRaises(ValueError):
                report.analyze(rows, 1)

    def test_unknown_or_invalid_usage_is_rejected(self):
        for field, value in [('unknownCalls', 1), ('inputTokens', -1), ('outputTokens', True)]:
            rows = [record('full'), record('selective')]
            rows[0]['usage'][field] = value
            with self.assertRaises(ValueError):
                report.analyze(rows, 1)

    def test_unassigned_request_is_rejected(self):
        rows = [record('full'), record('selective')]
        requests = [{'runId': r['runId'], 'step': 1, 'usage': r['usage']} for r in rows]
        report.check_requests(rows, requests)
        requests.append({'runId': 'unassigned', 'step': 1, 'usage': rows[0]['usage']})
        with self.assertRaises(ValueError):
            report.check_requests(rows, requests)

    def test_budget_reserves_a_complete_attempt(self):
        previous = run.BATCH_PEAK_CNY
        try:
            run.BATCH_PEAK_CNY = 3.0
            self.assertTrue(run.budget_allows(1.5))
            self.assertFalse(run.budget_allows(1.51))
        finally:
            run.BATCH_PEAK_CNY = previous


if __name__ == '__main__':
    unittest.main()
