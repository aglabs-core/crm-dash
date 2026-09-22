"""Real PostgreSQL offline fixture; synthetic identities, no provider data.

WARNING: drops public.contacts in the disposable maia-index-review-test container.
Never point this fixture at a shared or production database. Provision it with:
  sudo -n docker run -d --name maia-index-review-test --network none \
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine
Wait for `sudo -n docker exec maia-index-review-test pg_isready -U postgres`, then:
  python3 scripts/test_identity_indexes.py
Cleanup:
  sudo -n docker rm -fv maia-index-review-test
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'maia-index-review-test'

def sql(text, check=True):
    r = subprocess.run(['sudo','-n','docker','exec','-i',CONTAINER,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'], input=text, text=True, capture_output=True)
    if check and r.returncode: raise AssertionError(r.stderr)
    return r

class IdentityIndexes(unittest.TestCase):
    def setUp(self):
        sql("DROP TABLE IF EXISTS public.contacts; CREATE TABLE public.contacts(id serial primary key,user_id text NOT NULL,phone text,whatsapp varchar);")
        # Exact defective regex bytes from the live index expression.
        sql("CREATE UNIQUE INDEX uq_contacts_user_phone ON public.contacts(user_id,regexp_replace(phone,'" + chr(92)*2 + "D','','g')) WHERE phone IS NOT NULL AND phone<>'';")
        sql("CREATE UNIQUE INDEX uq_contacts_user_whatsapp ON public.contacts(user_id,regexp_replace(whatsapp::text,'" + chr(92)*2 + "D','','g')) WHERE whatsapp IS NOT NULL AND whatsapp::text<>'';")
        self.baseline = sql("SELECT indexname||':'||indexdef FROM pg_indexes WHERE tablename='contacts' ORDER BY indexname").stdout
        candidate = ROOT/'supabase/migrations/20260917160523_fix_contact_phone_whatsapp_digit_uniqueness.sql'
        if candidate.exists(): sql(candidate.read_text())
    def test_phone_formatted_duplicate_is_rejected(self):
        sql("INSERT INTO contacts(user_id,phone) VALUES('test-tenant','+55 (11) 91234-5678');")
        duplicate = sql("INSERT INTO contacts(user_id,phone) VALUES('test-tenant','5511912345678');",check=False)
        self.assertNotEqual(duplicate.returncode,0,'Formatted phone duplicate was accepted')
        self.assertIn('uq_contacts_user_phone',duplicate.stderr)
        self.assertEqual(sql('SELECT count(*) FROM contacts').stdout.strip(),'1')

    def test_whatsapp_formatted_duplicate_is_rejected(self):
        sql("INSERT INTO contacts(user_id,whatsapp) VALUES('test-tenant','+55 (11) 91234-5678');")
        duplicate = sql("INSERT INTO contacts(user_id,whatsapp) VALUES('test-tenant','5511912345678');",check=False)
        self.assertNotEqual(duplicate.returncode,0,'Formatted WhatsApp duplicate was accepted')
        self.assertIn('uq_contacts_user_whatsapp',duplicate.stderr)
        self.assertEqual(sql('SELECT count(*) FROM contacts').stdout.strip(),'1')

    def test_existing_behavior_tenant_isolation_and_nulls(self):
        sql("INSERT INTO contacts(user_id,phone,whatsapp) VALUES ('tenant-a','5511912345678','5511912345678'),('tenant-b','5511912345678','5511912345678'),('tenant-a',NULL,NULL),('tenant-a',NULL,NULL);")
        self.assertEqual(sql('SELECT count(*) FROM contacts').stdout.strip(),'4')

    def test_concurrent_duplicates_leave_one_row(self):
        from concurrent.futures import ThreadPoolExecutor
        queries = ["INSERT INTO contacts(user_id,phone,whatsapp) VALUES('tenant-a','%s','%s');" % (v,v) for v in ['5511912345678','+55 (11) 91234-5678']*4]
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda q:sql(q,check=False),queries))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertEqual(sql('SELECT count(*) FROM contacts').stdout.strip(),'1')

    def test_failed_rebuild_rolls_back_both_indexes_without_data_loss(self):
        sql("DROP INDEX uq_contacts_user_whatsapp; CREATE UNIQUE INDEX uq_contacts_user_whatsapp ON public.contacts(user_id,regexp_replace(whatsapp::text,'"+chr(92)*2+"D','','g')) WHERE whatsapp IS NOT NULL AND whatsapp::text<>'';")
        sql("INSERT INTO contacts(user_id,whatsapp) VALUES('tenant-a','5511912345678'),('tenant-a','+55 (11) 91234-5678');")
        before=sql("SELECT indexname||':'||indexdef FROM pg_indexes WHERE tablename='contacts' ORDER BY indexname").stdout
        r=sql((ROOT/'supabase/migrations/20260917160523_fix_contact_phone_whatsapp_digit_uniqueness.sql').read_text(),check=False)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('uq_contacts_user_whatsapp',r.stderr)
        self.assertEqual(sql("SELECT indexname||':'||indexdef FROM pg_indexes WHERE tablename='contacts' ORDER BY indexname").stdout,before)
        self.assertEqual(sql('SELECT count(*) FROM contacts').stdout.strip(),'2')

if __name__=='__main__': unittest.main(verbosity=2)
