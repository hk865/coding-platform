import unittest
from paths import normalize_path
class Paths(unittest.TestCase):
    def test_relative(self):
        for raw, expected in [("", "."), ("a//b/./c", "a/b/c"), ("a/b/../c", "a/c"), ("../a/../../b", "../../b"), ("a/..", ".")]:
            with self.subTest(raw=raw): self.assertEqual(normalize_path(raw), expected)
    def test_absolute(self):
        for raw, expected in [("/", "/"), ("///a//b/../", "/a"), ("/../../x", "/x"), ("/a/./b", "/a/b")]:
            with self.subTest(raw=raw): self.assertEqual(normalize_path(raw), expected)
    def test_literal_names(self):
        for raw, expected in [("a/.../b", "a/.../b"), ("a b/../中文", "中文")]:
            with self.subTest(raw=raw): self.assertEqual(normalize_path(raw), expected)
    def test_reject_non_strings(self):
        for raw in [None, 12, [], b"a"]:
            with self.subTest(raw=raw):
                with self.assertRaises(TypeError): normalize_path(raw)
    def test_reject_nul(self):
        with self.assertRaises(ValueError): normalize_path("a\0b")
if __name__ == '__main__': unittest.main()
