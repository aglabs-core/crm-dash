"""Exercise web-form conversion against disposable Postgres with synthetic rows."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import subprocess
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f"crm-inbound-conversion-test-{os.getpid()}"
OWNER = "0af00833-c1f7-42f4-9543-a5e0ff6f55fc"
OTHER = "11111111-1111-4111-8111-111111111111"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(list(args), text=True, encoding="utf-8", capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr or result.stdout)
    return result


def sql(statement: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
        input=statement, text=True, encoding="utf-8", capture_output=True,
    )
    if check and result.returncode:
        raise AssertionError(result.stderr or result.stdout)
    return result


def value(statement: str) -> str:
    return sql(statement).stdout.strip().splitlines()[-1]


def as_owner(statement: str, owner: str = OWNER, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return sql(f"SET ROLE authenticated; SET request.jwt.claim.sub = '{owner}'; {statement}", check=check)


class InstitutionalConversion(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        run("docker", "run", "--rm", "-d", "--name", CONTAINER,
            "-e", "POSTGRES_PASSWORD=synthetic-only", "postgres:17-alpine")
        for _ in range(30):
            if run("docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", check=False).returncode == 0:
                break
            time.sleep(1)
        else:
            raise AssertionError("Disposable PostgreSQL did not become ready")

        sql("""
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE ROLE service_role NOLOGIN BYPASSRLS;
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
            GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

            CREATE TABLE public.contacts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
              name text, email text, phone text, whatsapp text, company text,
              produto text, status text NOT NULL DEFAULT 'Lead', origin text,
              prospecting_pool boolean NOT NULL DEFAULT false
            );
            CREATE UNIQUE INDEX uq_contacts_user_email ON public.contacts(user_id, lower(email))
              WHERE email IS NOT NULL AND email <> '';
            CREATE UNIQUE INDEX uq_contacts_user_phone ON public.contacts
              (user_id, regexp_replace(phone, '[^0-9]', '', 'g')) WHERE phone IS NOT NULL AND phone <> '';
            ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
            CREATE POLICY owner_contacts ON public.contacts FOR ALL TO authenticated
              USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
            GRANT ALL ON public.contacts TO authenticated;

            CREATE TABLE public.leads_institucional (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead text, email text,
              whatsapp text, produto text, status text NOT NULL DEFAULT 'novo',
              contact_id uuid REFERENCES public.contacts(id)
            );
            ALTER TABLE public.leads_institucional ENABLE ROW LEVEL SECURITY;
            CREATE POLICY inbox_leads ON public.leads_institucional FOR ALL TO authenticated
              USING (true) WITH CHECK (true);
            GRANT ALL ON public.leads_institucional TO authenticated;

            CREATE TABLE public.activities (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
              contact_id uuid REFERENCES public.contacts(id), type text, content text
            );
            ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
            CREATE POLICY owner_activities ON public.activities FOR ALL TO authenticated
              USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
            GRANT ALL ON public.activities TO authenticated;
        """)
        migration = next((ROOT / "supabase" / "migrations").glob("*_atomic_institutional_lead_conversion.sql"))
        sql(migration.read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls) -> None:
        run("docker", "rm", "-f", CONTAINER, check=False)

    def setUp(self) -> None:
        sql("TRUNCATE public.activities, public.leads_institucional, public.contacts CASCADE;")

    def test_reuses_prospect_and_preserves_history(self) -> None:
        existing = value(f"""INSERT INTO public.contacts(user_id,name,phone,status,origin,prospecting_pool)
            VALUES('{OWNER}','Existing','(11) 99999-9999','Arquivado','prospeccao',true) RETURNING id;""")
        lead = value("""INSERT INTO public.leads_institucional(lead,email,whatsapp)
            VALUES('Web Name','web@example.test','11999999999') RETURNING id;""")
        statement = f"SELECT public.convert_institutional_lead('{lead}','Web Name','web@example.test','11999999999',NULL,'barberias');"
        linked = as_owner(statement).stdout.strip().splitlines()[-1]
        self.assertEqual(linked, existing)
        self.assertEqual(value("SELECT count(*) FROM public.contacts;"), "1")
        self.assertEqual(value(f"SELECT status || ':' || prospecting_pool::text FROM public.contacts WHERE id='{existing}';"), "Lead:false")
        self.assertEqual(value(f"SELECT status || ':' || contact_id::text FROM public.leads_institucional WHERE id='{lead}';"), f"convertido:{existing}")
        self.assertEqual(value("SELECT count(*) FROM public.activities;"), "1")
        self.assertEqual(as_owner(statement).stdout.strip().splitlines()[-1], existing)
        self.assertEqual(value("SELECT count(*) FROM public.activities;"), "1")

    def test_conflicting_email_and_phone_roll_back(self) -> None:
        sql(f"""INSERT INTO public.contacts(user_id,name,email) VALUES('{OWNER}','A','a@example.test');
            INSERT INTO public.contacts(user_id,name,phone) VALUES('{OWNER}','B','11999999999');""")
        lead = value("""INSERT INTO public.leads_institucional(lead,email,whatsapp)
            VALUES('Mixed','a@example.test','11999999999') RETURNING id;""")
        result = as_owner(f"SELECT public.convert_institutional_lead('{lead}');", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("identity conflict", result.stderr)
        self.assertEqual(value(f"SELECT status FROM public.leads_institucional WHERE id='{lead}';"), "novo")
        self.assertEqual(value("SELECT count(*) FROM public.contacts;"), "2")

    def test_generic_interest_does_not_erase_customer_product(self) -> None:
        existing = value(f"""INSERT INTO public.contacts(user_id,name,email,status,produto)
            VALUES('{OWNER}','Customer','customer@example.test','Cliente','barberias') RETURNING id;""")
        lead = value("""INSERT INTO public.leads_institucional(lead,email,produto)
            VALUES('Customer','customer@example.test','Interesse geral') RETURNING id;""")
        linked = as_owner(f"SELECT public.convert_institutional_lead('{lead}');").stdout.strip().splitlines()[-1]
        self.assertEqual(linked, existing)
        self.assertEqual(value(f"SELECT status || ':' || produto FROM public.contacts WHERE id='{existing}';"), "Cliente:barberias")

    def test_concurrent_forms_share_one_contact(self) -> None:
        leads = [value("""INSERT INTO public.leads_institucional(lead,email)
            VALUES('Same Person','same@example.test') RETURNING id;""") for _ in range(2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda lead: as_owner(f"SELECT public.convert_institutional_lead('{lead}');", check=False), leads))
        self.assertTrue(all(result.returncode == 0 for result in results), results[0].stderr)
        self.assertEqual(value("SELECT count(*) FROM public.contacts;"), "1")
        self.assertEqual(value("SELECT count(DISTINCT contact_id) FROM public.leads_institucional;"), "1")

    def test_anonymous_cannot_convert(self) -> None:
        lead = value("INSERT INTO public.leads_institucional(lead) VALUES('Anonymous') RETURNING id;")
        result = sql(f"SET ROLE anon; SELECT public.convert_institutional_lead('{lead}');", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(value("SELECT count(*) FROM public.contacts;"), "0")

    def test_converted_form_does_not_reveal_another_owners_contact(self) -> None:
        other_contact = value(f"""INSERT INTO public.contacts(user_id,name,email)
            VALUES('{OTHER}','Other','other@example.test') RETURNING id;""")
        lead = value(f"""INSERT INTO public.leads_institucional(lead,status,contact_id)
            VALUES('Other','convertido','{other_contact}') RETURNING id;""")
        result = as_owner(f"SELECT public.convert_institutional_lead('{lead}');", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(other_contact, result.stderr)


if __name__ == "__main__":
    unittest.main()
