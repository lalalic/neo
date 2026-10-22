"""Portable frontmatter fallback must work without a PyYAML installation."""
import runpy
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/list-xchat-skills'
parse_subset = runpy.run_path(str(SCRIPT))['parse_frontmatter_subset']

class PortableFrontmatterTests(unittest.TestCase):
    def test_single_quoted_yaml_with_metadata(self):
        content = "name: autoresearch\ndescription: 'Karpathy''s research'\nmetadata:\n  author: test\n  source: example\n"
        self.assertEqual(parse_subset(content), {'name':'autoresearch','description':"Karpathy's research"})

    def test_requires_skills_stays_explicit(self):
        parsed = parse_subset('name: needs-x\ndescription: test\nrequires:\n  skills:\n    - browser\n    - events\n')
        self.assertEqual(parsed['requires'], {'skills':['browser','events']})

    def test_unsupported_dependency_metadata_is_rejected(self):
        self.assertIsNone(parse_subset('name: needs-x\ndescription: test\nrequires: [browser]\n'))

    def test_folded_description(self):
        parsed=parse_subset('name: example\ndescription: >-\n  A useful skill\n  for experiments\n')
        self.assertEqual(parsed['description'],'A useful skill for experiments')

if __name__=='__main__':unittest.main()
