"""PostgreSQL integration tests for Instagram webhook and offer integrity.

Uses only synthetic identities in the disposable ``crm-instagram-integrity-test``
container. Never point this script at a shared or production database.
"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "crm-instagram-integrity-test"
OWNER = "0af00833-c1f7-42f4-9543-a5e0ff6f55fc"
OTHER = "11111111-1111-4111-8111-111111111111"


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


class InstagramIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        sql(
            f"""
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE ROLE service_role NOLOGIN;
            CREATE SCHEMA auth;
            CREATE TABLE auth.users(id uuid PRIMARY KEY);
            INSERT INTO auth.users(id) VALUES ('{OWNER}'), ('{OTHER}');

            CREATE TABLE public.contacts (
              id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
              user_id uuid NOT NULL REFERENCES auth.users(id),
              name text NOT NULL,
              email text,
              phone text,
              company text,
              status text DEFAULT 'Lead',
              produto text,
              origin text DEFAULT 'manual',
              instagram text,
              instagram_id text,
              instagram_oferta_em timestamptz,
              created_at timestamptz DEFAULT now(),
              updated_at timestamptz DEFAULT now()
            );
            CREATE UNIQUE INDEX contacts_instagram_id_key
              ON public.contacts(instagram_id) WHERE instagram_id IS NOT NULL;
            ALTER TABLE public.contacts ADD CONSTRAINT contacts_origin_check
              CHECK (origin IN ('web','prospeccao','whatsapp','email','manual','compra','instagram'));

            CREATE TABLE public.activities (
              id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
              user_id uuid NOT NULL REFERENCES auth.users(id),
              contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
              type text NOT NULL,
              channel text,
              content text,
              created_at timestamptz DEFAULT now()
            );
            ALTER TABLE public.activities ADD CONSTRAINT activities_channel_check
              CHECK (channel IS NULL OR channel IN ('whatsapp','email','telefone','presencial','sistema','instagram'));
            """
        )
        migration = next(
            (ROOT / "supabase" / "migrations").glob(
                "*_harden_instagram_lead_offer_integrity.sql"
            )
        )
        sql(migration.read_text(encoding="utf-8"))

    def setUp(self) -> None:
        sql(
            """
            TRUNCATE automation_private.instagram_events,
                     automation_private.instagram_offer_dispatches,
                     public.activities,
                     public.contacts CASCADE;
            """
        )

    def register(self, event_id: str, instagram_id: str = "123456789"):
        return sql(
            "SELECT contact_id, novo, oferta_ja_enviada, evento_novo "
            "FROM public.registrar_lead_instagram("
            f"'{instagram_id}', 'lead_teste', 'GUIA', 'Automação', "
            f"'direct', '{event_id}');",
            check=False,
        )

    def test_owner_is_explicit_not_selected_by_contact_volume(self) -> None:
        sql(
            f"INSERT INTO public.contacts(user_id,name) "
            f"SELECT '{OTHER}', 'Importado ' || n FROM generate_series(1,20) n;"
        )
        result = self.register("evt-owner")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            sql("SELECT user_id FROM public.contacts WHERE instagram_id='123456789';")
            .stdout.strip(),
            OWNER,
        )

    def test_same_event_is_idempotent_under_concurrency(self) -> None:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.register("evt-same"), range(8)))
        self.assertTrue(all(r.returncode == 0 for r in results), results[0].stderr)
        self.assertEqual(
            sql("SELECT count(*) FROM public.contacts WHERE instagram_id='123456789';")
            .stdout.strip(),
            "1",
        )
        self.assertEqual(sql("SELECT count(*) FROM public.activities;").stdout.strip(), "1")
        self.assertEqual(
            sql("SELECT count(*) FROM automation_private.instagram_events;")
            .stdout.strip(),
            "1",
        )
        self.assertEqual(sum(r.stdout.strip().endswith("|t") for r in results), 1)

    def test_distinct_events_share_contact_but_keep_interactions(self) -> None:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda i: self.register(f"evt-{i}"), range(8)))
        self.assertTrue(all(r.returncode == 0 for r in results), results[0].stderr)
        self.assertEqual(
            sql("SELECT count(*) FROM public.contacts WHERE instagram_id='123456789';")
            .stdout.strip(),
            "1",
        )
        self.assertEqual(sql("SELECT count(*) FROM public.activities;").stdout.strip(), "8")

    def test_only_one_offer_claim_wins_under_concurrency(self) -> None:
        self.register("evt-offer")

        def reserve(_: int):
            return sql(
                "SELECT reservado FROM public.reservar_oferta_instagram("
                "'123456789','Automação');",
                check=False,
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(reserve, range(8)))
        self.assertTrue(all(r.returncode == 0 for r in results), results[0].stderr)
        self.assertEqual(sum(r.stdout.strip() == "t" for r in results), 1)
        self.assertEqual(
            sql(
                "SELECT count(*) FROM automation_private.instagram_offer_dispatches "
                "WHERE state='reserved';"
            ).stdout.strip(),
            "1",
        )

    def test_completion_and_retry_are_idempotent(self) -> None:
        self.register("evt-complete")
        sql("SELECT * FROM public.reservar_oferta_instagram('123456789','Automação');")
        first = sql("SELECT public.concluir_oferta_instagram('123456789','Automação');")
        second = sql("SELECT public.concluir_oferta_instagram('123456789','Automação');")
        self.assertEqual(first.stdout.strip(), "t")
        self.assertEqual(second.stdout.strip(), "f")
        self.assertEqual(
            sql("SELECT count(*) FROM public.activities WHERE type='disparo';")
            .stdout.strip(),
            "1",
        )
        self.assertEqual(
            sql(
                "SELECT count(*) FROM public.contacts "
                "WHERE instagram_oferta_em IS NOT NULL;"
            ).stdout.strip(),
            "1",
        )

    def test_reserved_unknown_delivery_is_not_automatically_retried(self) -> None:
        self.register("evt-unknown")
        first = sql("SELECT reservado FROM public.reservar_oferta_instagram('123456789','Automação');")
        retry = sql("SELECT reservado FROM public.reservar_oferta_instagram('123456789','Automação');")
        self.assertEqual(first.stdout.strip(), "t")
        self.assertEqual(retry.stdout.strip(), "f")
        self.assertEqual(
            sql(
                "SELECT instagram_oferta_em IS NULL FROM public.contacts "
                "WHERE instagram_id='123456789';"
            ).stdout.strip(),
            "t",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
