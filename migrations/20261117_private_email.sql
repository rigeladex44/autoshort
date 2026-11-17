BEGIN;
-- Metadata only: message content remains in the email provider, scoped by inbox.
CREATE TABLE IF NOT EXISTS public.email_domains (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 domain TEXT NOT NULL UNIQUE,
 provider_id TEXT UNIQUE,
 sending_ready BOOLEAN NOT NULL DEFAULT FALSE,
 receiving_ready BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS public.email_mailboxes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 domain_id UUID NOT NULL,
 address TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL DEFAULT '',
 provider_id TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(domain_id,user_id) REFERENCES public.email_domains(id,user_id),
 UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS public.email_send_requests (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL,
 mailbox_id UUID NOT NULL,
 payload_hash TEXT NOT NULL,
 provider_message_id TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(mailbox_id,user_id) REFERENCES public.email_mailboxes(id,user_id)
);
CREATE INDEX IF NOT EXISTS email_domains_owner ON public.email_domains(user_id);
CREATE INDEX IF NOT EXISTS email_mailboxes_owner ON public.email_mailboxes(user_id);
CREATE INDEX IF NOT EXISTS email_send_quota ON public.email_send_requests(user_id,created_at);
ALTER TABLE public.email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_domains,public.email_mailboxes,public.email_send_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.email_domains,public.email_mailboxes TO authenticated;
GRANT ALL ON public.email_domains,public.email_mailboxes,public.email_send_requests TO service_role;
DROP POLICY IF EXISTS email_domains_owner ON public.email_domains;
CREATE POLICY email_domains_owner ON public.email_domains FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS email_mailboxes_owner ON public.email_mailboxes;
CREATE POLICY email_mailboxes_owner ON public.email_mailboxes FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE OR REPLACE FUNCTION public.reserve_email_domain(p_user UUID,p_domain TEXT) RETURNS public.email_domains
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.email_domains;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,412));
 SELECT * INTO result FROM email_domains WHERE domain=p_domain;
 IF FOUND THEN
  IF result.user_id<>p_user THEN RAISE EXCEPTION 'domain_unavailable'; END IF;
  RETURN result;
 END IF;
 IF (SELECT count(*) FROM email_domains WHERE user_id=p_user)>=3 THEN RAISE EXCEPTION 'domain_limit'; END IF;
 INSERT INTO email_domains(user_id,domain) VALUES(p_user,p_domain) RETURNING * INTO result;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.reserve_email_mailbox(p_user UUID,p_domain UUID,p_address TEXT,p_name TEXT) RETURNS public.email_mailboxes
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.email_mailboxes;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,412));
 IF NOT EXISTS(SELECT 1 FROM email_domains WHERE id=p_domain AND user_id=p_user AND sending_ready AND receiving_ready) THEN RAISE EXCEPTION 'domain_not_ready'; END IF;
 SELECT * INTO result FROM email_mailboxes WHERE address=p_address;
 IF FOUND THEN
  IF result.user_id<>p_user THEN RAISE EXCEPTION 'mailbox_unavailable'; END IF;
  RETURN result;
 END IF;
 IF (SELECT count(*) FROM email_mailboxes WHERE user_id=p_user)>=10 THEN RAISE EXCEPTION 'mailbox_limit'; END IF;
 INSERT INTO email_mailboxes(user_id,domain_id,address,display_name) VALUES(p_user,p_domain,p_address,p_name) RETURNING * INTO result;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.reserve_email_send(p_user UUID,p_mailbox UUID,p_request UUID,p_hash TEXT) RETURNS public.email_send_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.email_send_requests;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,412));
 IF NOT EXISTS(SELECT 1 FROM email_mailboxes WHERE id=p_mailbox AND user_id=p_user AND provider_id IS NOT NULL) THEN RAISE EXCEPTION 'mailbox_unavailable'; END IF;
 SELECT * INTO result FROM email_send_requests WHERE id=p_request;
 IF FOUND THEN
  IF result.user_id<>p_user OR result.mailbox_id<>p_mailbox OR result.payload_hash<>p_hash THEN RAISE EXCEPTION 'request_conflict'; END IF;
  IF result.state='pending' AND result.created_at<now()-interval '23 hours' THEN RAISE EXCEPTION 'request_expired'; END IF;
  RETURN result;
 END IF;
 IF (SELECT count(*) FROM email_send_requests WHERE user_id=p_user AND created_at>now()-interval '24 hours')>=100 THEN RAISE EXCEPTION 'send_limit'; END IF;
 INSERT INTO email_send_requests(id,user_id,mailbox_id,payload_hash) VALUES(p_request,p_user,p_mailbox,p_hash) RETURNING * INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_email_domain(UUID,TEXT),public.reserve_email_mailbox(UUID,UUID,TEXT,TEXT),public.reserve_email_send(UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_domain(UUID,TEXT),public.reserve_email_mailbox(UUID,UUID,TEXT,TEXT),public.reserve_email_send(UUID,UUID,UUID,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
