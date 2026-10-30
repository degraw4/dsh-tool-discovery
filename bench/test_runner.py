import tempfile
import unittest
from pathlib import Path
import run


class AccountingTests(unittest.TestCase):
    def usage(self):
        return {
            "inputTokens": 100,
            "cacheReadTokens": 200,
            "cacheWriteTokens": 0,
            "outputTokens": 10,
        }

    def test_rejects_unknown_usage(self):
        with self.assertRaises(ValueError):
            run.account_usage({"calls": [{"usage": self.usage()}, {"usage": None}]})

    def test_correct_token_rates(self):
        _, fee = run.account_usage({"calls": [{"usage": self.usage()}]})
        self.assertAlmostEqual(fee, 0.000288)

    def test_rejects_invalid_token_counts(self):
        for value in [-1, float("nan"), True, 0.5]:
            u = self.usage()
            u["inputTokens"] = value
            with self.assertRaises(ValueError):
                run.validate_token_usage(u)

    def test_pair_schedule_and_order(self):
        jobs = run.make_jobs(["one", "two"], 10)
        self.assertEqual(len(jobs), 40)
        for a, b in zip(jobs[::2], jobs[1::2]):
            self.assertEqual((a["taskId"], a["repeat"]), (b["taskId"], b["repeat"]))
            self.assertNotEqual(a["arm"], b["arm"])

    def test_lf_record_parser_preserves_unicode_separator(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "events"
            p.write_text('{"text":"a\u0085b"}\n')
            self.assertEqual(run.read_events(p), [{"text": "a\u0085b"}])


if __name__ == "__main__":
    unittest.main()
