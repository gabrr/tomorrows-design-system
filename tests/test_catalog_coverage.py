import unittest
from tds.catalog import catalog
from tds.simulation import validate, simulate

class CatalogCoverageTests(unittest.TestCase):
    def test_agreed_component_families_are_available_and_declared(self):
        entries=catalog()['components'];by_type={entry['type']:entry for entry in entries}
        required={'desktop_client','server','mobile_client','cdn','graph_database','wide_column_database','time_series_database','embedded_database','connection_pooler','priority_queue','worker_pool','model_router','inference_server','agent','tool_execution','sms_provider','restore','namespace'}
        self.assertTrue(required<=by_type.keys())
        self.assertEqual(len(by_type),len(entries))
        self.assertEqual(len({entry['category'] for entry in entries}),18)
        for entry in entries:
            project={'nodes':[{'id':'component','type':entry['type'],'config':entry['defaults']}], 'edges':[], 'scenario':{'duration':1,'rps':0,'events':[]}}
            self.assertEqual(validate(project),[],entry['type'])
            self.assertTrue(entry['model']);self.assertTrue(entry['limitations'])
        result=simulate({'nodes':[{'id':'desktop','type':'desktop_client'}],'edges':[],'scenario':{'duration':1,'rps':1,'events':[]}})
        self.assertEqual(result['catalog_version'],catalog()['catalog_version'])
