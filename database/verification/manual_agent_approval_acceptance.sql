-- Read-only verification. Functional actor/revision/age/payout checks are in
-- server/tests/manual-agent-approval.test.ts against an isolated PostgreSQL DB.
do $$
declare payout_definition text;
begin
 if to_regprocedure('app_private.approve_reviewed_agent(uuid,uuid,text,boolean,text,text)')is null then raise exception 'MANUAL_APPROVAL_FUNCTION_MISSING';end if;
 if to_regclass('app_private.agent_manual_approvals')is null then raise exception 'MANUAL_APPROVAL_HISTORY_MISSING';end if;
 if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid='app_private.agent_manual_approvals'::regclass and a.grantee=0)then raise exception 'MANUAL_APPROVAL_HISTORY_PUBLIC';end if;
 if not exists(select 1 from pg_trigger where tgrelid='app_private.agent_manual_approvals'::regclass and tgname='agent_manual_approvals_immutable' and tgenabled='O')then raise exception 'MANUAL_APPROVAL_HISTORY_NOT_IMMUTABLE';end if;
 select pg_get_functiondef('app_private.payout_identity_eligible(uuid,uuid,uuid,text,text)'::regprocedure)into payout_definition;
 if position('bank_status=''VERIFIED''' in payout_definition)=0 or position('agent_manual_approvals' in payout_definition)>0 then raise exception 'PAYOUT_VERIFICATION_BOUNDARY_CHANGED';end if;
end $$;
