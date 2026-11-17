import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new PGlite();
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
try {
  await db.exec(
    `CREATE SCHEMA auth; CREATE TABLE auth.users(id UUID PRIMARY KEY); INSERT INTO auth.users VALUES('${a}'),('${b}'); CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role; CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
  );
  const migration = readFileSync(
    new URL("../migrations/20261117_private_email.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  const domain = (
    await db.query("SELECT (public.reserve_email_domain($1,$2)).*", [
      a,
      "own.example",
    ])
  ).rows[0];
  assert.equal(domain.user_id, a);
  assert.equal(
    (
      await db.query("SELECT (public.reserve_email_domain($1,$2)).id", [
        a,
        "own.example",
      ])
    ).rows[0].id,
    domain.id,
  );
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_domain($1,$2)", [b, "own.example"]),
    /domain_unavailable/,
  );
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_mailbox($1,$2,$3,$4)", [
        a,
        domain.id,
        "admin@own.example",
        "Admin",
      ]),
    /domain_not_ready/,
  );
  await db.query(
    "UPDATE public.email_domains SET sending_ready=true,receiving_ready=true WHERE id=$1",
    [domain.id],
  );
  const box = (
    await db.query("SELECT (public.reserve_email_mailbox($1,$2,$3,$4)).*", [
      a,
      domain.id,
      "admin@own.example",
      "Admin",
    ])
  ).rows[0];
  await db.query(
    "UPDATE public.email_mailboxes SET provider_id=$1 WHERE id=$2",
    ["provider-box", box.id],
  );
  await db.exec(
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${b}';`,
  );
  assert.equal(
    (await db.query("SELECT * FROM public.email_domains")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT * FROM public.email_mailboxes")).rows.length,
    0,
  );
  await db.exec("ROLLBACK;");
  await db.exec(
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${a}';`,
  );
  assert.equal(
    (await db.query("SELECT * FROM public.email_domains")).rows.length,
    1,
  );
  assert.equal(
    (await db.query("SELECT * FROM public.email_mailboxes")).rows.length,
    1,
  );
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_domain($1,$2)", [
        a,
        "unauthorized.example",
      ]),
    /permission denied/,
  );
  await db.exec("ROLLBACK;");
  const id = randomUUID();
  await db.query("SELECT public.reserve_email_send($1,$2,$3,$4)", [
    a,
    box.id,
    id,
    "hash",
  ]);
  await db.query("SELECT public.reserve_email_send($1,$2,$3,$4)", [
    a,
    box.id,
    id,
    "hash",
  ]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.email_send_requests",
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_send($1,$2,$3,$4)", [
        a,
        box.id,
        id,
        "changed",
      ]),
    /request_conflict/,
  );
  for (let i = 1; i < 100; i++)
    await db.query("SELECT public.reserve_email_send($1,$2,$3,$4)", [
      a,
      box.id,
      randomUUID(),
      "hash",
    ]);
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_send($1,$2,$3,$4)", [
        a,
        box.id,
        randomUUID(),
        "hash",
      ]),
    /send_limit/,
  );
  await db.query(
    "UPDATE public.email_send_requests SET created_at=now()-interval '24 hours' WHERE id=$1",
    [id],
  );
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_send($1,$2,$3,$4)", [
        a,
        box.id,
        id,
        "hash",
      ]),
    /request_expired/,
  );
  for (const name of ["second.example", "third.example"])
    await db.query("SELECT public.reserve_email_domain($1,$2)", [a, name]);
  await assert.rejects(
    () =>
      db.query("SELECT public.reserve_email_domain($1,$2)", [
        a,
        "fourth.example",
      ]),
    /domain_limit/,
  );
  console.log(
    "PASS isolated PostgreSQL: repeatable migration, owner RLS, restricted writes/RPC, DNS gating, idempotency, quota and expired-retry protection",
  );
} finally {
  await db.close();
}
