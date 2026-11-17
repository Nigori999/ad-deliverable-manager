"""Exercise the real SQLite schema/migrations without building the .NET application."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class CategoryStorageTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript((ROOT / 'Data/schema.sql').read_text())
        for migration in sorted((ROOT / 'Data/migrations').glob('*.sql')):
            self.db.executescript(migration.read_text())
        self.ids = dict(self.db.execute("SELECT i.ItemCode,i.Id FROM DictionaryItems i JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId WHERE d.Code='JIRA_ISSUE_CATEGORY'"))

    def tearDown(self):
        self.db.close()

    def test_seed_hierarchy_and_confirmed_aliases(self):
        self.assertEqual(len(self.ids), 5)
        self.assertEqual(self.db.execute('SELECT ParentItemId FROM DictionaryItems WHERE Id=?', (self.ids['LIDAR'],)).fetchone()[0], self.ids['SENSOR'])
        names = list(self.db.execute('SELECT DictionaryItemId,MatchValue FROM JiraCategoryMappings ORDER BY MatchValue'))
        self.assertEqual(names, [(self.ids['ADS'], 'ADCU'), (self.ids['ADS'], 'ADS'), (self.ids['LIDAR'], 'LiDAR')])
        self.assertEqual(self.db.execute("SELECT StructureMode,IsSystem FROM DictionaryTypes WHERE Code='JIRA_ISSUE_CATEGORY'").fetchone(), ('TREE', 1))

    def test_mapping_uniqueness_and_transaction_rollback(self):
        original = self.db.execute('SELECT ItemName FROM DictionaryItems WHERE Id=?', (self.ids['LIDAR'],)).fetchone()[0]
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.db.execute('UPDATE DictionaryItems SET ItemName=? WHERE Id=?', ('编辑中', self.ids['LIDAR']))
                self.db.execute('DELETE FROM JiraCategoryMappings WHERE DictionaryItemId=?', (self.ids['LIDAR'],))
                self.db.execute("INSERT INTO JiraCategoryMappings VALUES(?,'','NAME','ADS')", (self.ids['LIDAR'],))
        self.assertEqual(self.db.execute('SELECT ItemName FROM DictionaryItems WHERE Id=?', (self.ids['LIDAR'],)).fetchone()[0], original)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM JiraCategoryMappings WHERE MatchValue='LiDAR'").fetchone()[0], 1)

    def test_id_mapping_requires_field_and_fields_are_isolated(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO JiraCategoryMappings VALUES(?,'','ID','100')", (self.ids['ADS'],))
        self.db.execute("INSERT INTO JiraCategoryMappings VALUES(?,'customfield_101','ID','100')", (self.ids['ADS'],))
        self.db.execute("INSERT INTO JiraCategoryMappings VALUES(?,'customfield_102','ID','100')", (self.ids['LIDAR'],))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM JiraCategoryMappings WHERE MatchType='ID'").fetchone()[0], 2)

    def test_delete_cascades_mappings_and_parent_is_protected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('DELETE FROM DictionaryItems WHERE Id=?', (self.ids['SENSOR'],))
        self.db.execute('DELETE FROM DictionaryItems WHERE Id=?', (self.ids['LIDAR'],))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM JiraCategoryMappings WHERE DictionaryItemId=?', (self.ids['LIDAR'],)).fetchone()[0], 0)
        self.assertEqual(list(self.db.execute('PRAGMA foreign_key_check')), [])

    def test_upgrade_does_not_reseed_or_touch_other_dictionaries(self):
        # Application reapplies schema.sql on every start; applied migrations are skipped.
        self.db.execute('DELETE FROM DictionaryItems WHERE Id=?', (self.ids['CAMERA'],))
        self.db.executescript((ROOT / 'Data/schema.sql').read_text())
        self.assertIsNone(self.db.execute('SELECT Id FROM DictionaryItems WHERE Id=?', (self.ids['CAMERA'],)).fetchone())
        self.assertGreater(self.db.execute("SELECT COUNT(*) FROM DictionaryItems i JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId WHERE d.Code='DELIVERABLE_CATEGORY'").fetchone()[0], 0)

if __name__ == '__main__':
    unittest.main()
