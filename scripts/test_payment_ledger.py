"""Integration tests for the payment ledger migration.

The suite starts its own disposable PostgreSQL 17 container and uses only
synthetic identities. It never connects to a shared or production database.
"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "crm-payment-ledger-test"
OWNER = "0af00833-c1f7-42f4-9543-a5e0ff6f55fc"
OTHER = "11111111-1111-4111-8111-111111111111"
ADMIN = "22222222-2222-4222-8222-222222222222"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(args), text=True, encoding="utf-8", capture_output=True
    )
    if check and result.returncode:
        raise AssertionError(result.stderr or result.stdout)
    return result


def sql(statement: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-X",
            "-U",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
        ],
        input=statement,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def ingest(
    external_id: str,
    *,
    amount: str = "100.00",
    status: str = "paid",
    refunded: str = "0",
    email: str = "cliente@example.test",
    phone: str = "5511999999999",
    user_id: str = OWNER,
    currency: str = "BRL",
) -> subprocess.CompletedProcess[str]:
    return sql(
        "SET ROLE service_role; "
        "SELECT public.ingest_payment_transaction("
        f"'{user_id}', 'stripe', '{external_id}', '{status}', {amount}, "
        f"{refunded}, '{currency}', 'Produto teste', now(), 'Cliente Teste', "
        f"'{email}', '{phone}', NULL);",
        check=False,
    )


class PaymentLedger(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        run("docker", "rm", "-f", CONTAINER, check=False)
        run(
            "docker",
            "run",
            "--rm",
            "-d",
            "--name",
            CONTAINER,
            "-e",
            "POSTGRES_PASSWORD=synthetic-only",
            "postgres:17-alpine",
        )
        for _ in range(30):
            if run(
                # The image starts a socket-only temporary server during init.
                # Wait for the final TCP listener so the next psql call cannot
                # race with the temporary server shutting down.
                "docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", check=False
            ).returncode == 0:
                break
            time.sleep(1)
        else:
            raise AssertionError("Disposable PostgreSQL did not become ready")

        sql(
            f"""
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE ROLE service_role NOLOGIN BYPASSRLS;
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid
            LANGUAGE sql STABLE
            AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            CREATE TABLE auth.users(id uuid PRIMARY KEY);
            INSERT INTO auth.users(id) VALUES ('{OWNER}'), ('{OTHER}'), ('{ADMIN}');

            CREATE TABLE public.admin_users(id uuid PRIMARY KEY REFERENCES auth.users(id));
            INSERT INTO public.admin_users(id) VALUES ('{ADMIN}');

            CREATE TABLE public.contacts (
              id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
              user_id uuid NOT NULL REFERENCES auth.users(id),
              name text,
              email text,
              phone text,
              whatsapp text,
              documento text,
              company text,
              origin text DEFAULT 'manual',
              status text DEFAULT 'Lead',
              produto text,
              amount numeric(15,2) DEFAULT 0,
              gateway text,
              external_id text,
              closed_at timestamptz,
              created_at timestamptz DEFAULT now(),
              updated_at timestamptz DEFAULT now()
            );
            ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
            CREATE UNIQUE INDEX uq_contacts_user_email
              ON public.contacts(user_id, lower(email)) WHERE email IS NOT NULL AND email <> '';
            CREATE UNIQUE INDEX uq_contacts_user_phone
              ON public.contacts(user_id, regexp_replace(phone, '[^0-9]', '', 'g'))
              WHERE phone IS NOT NULL AND phone <> '';
            CREATE UNIQUE INDEX uq_contacts_user_documento
              ON public.contacts(user_id, regexp_replace(documento, '[^0-9]', '', 'g'))
              WHERE documento IS NOT NULL AND documento <> '';
            CREATE UNIQUE INDEX uq_contacts_gateway_external
              ON public.contacts(gateway, external_id)
              WHERE gateway IS NOT NULL AND external_id IS NOT NULL;

            GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
            GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
            GRANT SELECT ON public.admin_users TO authenticated, service_role;
            GRANT ALL ON public.contacts TO service_role;
            """
        )
        migration = next(
            (ROOT / "supabase" / "migrations").glob("*_create_payment_transactions.sql")
        )
        sql(migration.read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls) -> None:
        run("docker", "rm", "-f", CONTAINER, check=False)

    def setUp(self) -> None:
        sql("TRUNCATE public.payment_transactions, public.contacts CASCADE;")

    def test_same_payment_replay_is_idempotent_under_concurrency(self) -> None:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: ingest("pay_same"), range(8)))
        self.assertTrue(all(result.returncode == 0 for result in results), results[0].stderr)
        self.assertEqual(sql("SELECT count(*) FROM public.payment_transactions;").stdout.strip(), "1")
        self.assertEqual(sql("SELECT count(*) FROM public.contacts;").stdout.strip(), "1")
        self.assertEqual(sql("SELECT amount FROM public.contacts;").stdout.strip(), "100.00")

    def test_two_purchases_share_contact_and_keep_two_transactions(self) -> None:
        first = ingest("pay_first", amount="100.00")
        second = ingest("pay_second", amount="50.00")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(sql("SELECT count(*) FROM public.contacts;").stdout.strip(), "1")
        self.assertEqual(sql("SELECT count(*) FROM public.payment_transactions;").stdout.strip(), "2")
        self.assertEqual(sql("SELECT amount FROM public.contacts;").stdout.strip(), "150.00")

    def test_refund_replay_cannot_restore_revenue(self) -> None:
        self.assertEqual(ingest("pay_refund").returncode, 0)
        refunded = ingest("pay_refund", status="refunded", refunded="100.00")
        stale_paid = ingest("pay_refund", status="paid", refunded="0")
        self.assertEqual(refunded.returncode, 0, refunded.stderr)
        self.assertEqual(stale_paid.returncode, 0, stale_paid.stderr)
        self.assertEqual(
            sql("SELECT status || '|' || net_amount FROM public.payment_transactions;").stdout.strip(),
            "refunded|0.00",
        )
        self.assertEqual(sql("SELECT amount FROM public.contacts;").stdout.strip(), "0.00")

    def test_reversal_without_original_payment_is_rejected(self) -> None:
        result = ingest("pay_missing", status="refunded", refunded="100.00")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not found for reversal", result.stderr)
        self.assertEqual(sql("SELECT count(*) FROM public.contacts;").stdout.strip(), "0")
        self.assertEqual(sql("SELECT count(*) FROM public.payment_transactions;").stdout.strip(), "0")

    def test_replay_with_conflicting_amount_or_currency_is_rejected(self) -> None:
        self.assertEqual(ingest("pay_conflict").returncode, 0)
        wrong_amount = ingest("pay_conflict", amount="101.00")
        wrong_currency = ingest("pay_conflict", currency="USD")
        self.assertNotEqual(wrong_amount.returncode, 0)
        self.assertNotEqual(wrong_currency.returncode, 0)
        self.assertIn("amount or currency conflict", wrong_amount.stderr)
        self.assertIn("amount or currency conflict", wrong_currency.stderr)
        self.assertEqual(
            sql("SELECT amount || '|' || currency FROM public.payment_transactions;").stdout.strip(),
            "100.00|BRL",
        )

    def test_conflicting_identity_is_rejected_without_partial_write(self) -> None:
        sql(
            f"""
            INSERT INTO public.contacts(user_id, name, email)
            VALUES ('{OWNER}', 'Email', 'cliente@example.test');
            INSERT INTO public.contacts(user_id, name, phone)
            VALUES ('{OWNER}', 'Telefone', '5511999999999');
            """
        )
        result = ingest("pay_ambiguous")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ambiguous payment identity", result.stderr)
        self.assertEqual(sql("SELECT count(*) FROM public.payment_transactions;").stdout.strip(), "0")
        self.assertEqual(sql("SELECT count(*) FROM public.contacts;").stdout.strip(), "2")

    def test_migration_can_be_applied_again(self) -> None:
        migration = next(
            (ROOT / "supabase" / "migrations").glob("*_create_payment_transactions.sql")
        )
        sql(migration.read_text(encoding="utf-8"))
        self.assertEqual(ingest("pay_after_reapply").returncode, 0)
        self.assertEqual(sql("SELECT count(*) FROM public.payment_transactions;").stdout.strip(), "1")

    def test_authenticated_access_is_read_only_and_tenant_scoped(self) -> None:
        self.assertEqual(ingest("pay_owner").returncode, 0)
        self.assertEqual(
            ingest(
                "pay_other",
                email="outro@example.test",
                phone="5511888888888",
                user_id=OTHER,
            ).returncode,
            0,
        )
        owner_count = sql(
            f"SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}'; "
            "SELECT count(*) FROM public.payment_transactions;"
        )
        self.assertEqual(owner_count.stdout.strip().splitlines()[-1], "1")
        denied = sql(
            f"SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}'; "
            "INSERT INTO public.payment_transactions"
            "(user_id,gateway,external_id,status,amount) "
            f"VALUES ('{OWNER}','stripe','forbidden','paid',1);",
            check=False,
        )
        self.assertNotEqual(denied.returncode, 0)
        admin_count = sql(
            f"SET ROLE authenticated; SET request.jwt.claim.sub = '{ADMIN}'; "
            "SELECT count(*) FROM public.payment_transactions;"
        )
        self.assertEqual(admin_count.stdout.strip().splitlines()[-1], "2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
