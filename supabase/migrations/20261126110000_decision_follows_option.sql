-- Approach first, then product (proposals/PROPOSAL-approach-then-product.md;
-- Simon chose it 2026-11-26). When a decision's chosen option is Buy, a
-- second decision picks the product: "Which product for: <option>?". It
-- carries over the need, the outcome and the products, and points back at
-- the Buy option it details.
--
-- * decisions.follows_option_id: the chosen Buy option of another decision
--   that this product decision details. Set when the decision is created,
--   never changed afterwards (there is no column update grant).
-- * One invoker trigger checks it on insert: the option's decision is in the
--   same organisation, accepted, with that option chosen, and the option is
--   Buy. Only one product decision follows an option unless the earlier one
--   was cancelled. Two people starting it at once are serialised.
--
-- Advisor discipline (CLAUDE.md rule 9), following decision_benefit_checks:
-- * no SECURITY DEFINER function and no new grant, so the "signed-in users
--   can execute SECURITY DEFINER" count is unchanged;
-- * the trigger function is an invoker function with all execute revoked and
--   a fixed search_path;
-- * the column carries no foreign key, so it needs no covering index and adds
--   no unindexed-foreign-key or unused-index finding (decision_packs
--   precedent). Options are never hard-deleted by application code, and the
--   trigger checks the option exists when the pointer is written.

alter table decisions add column follows_option_id uuid;

comment on column decisions.follows_option_id is 'Approach first, then product: the chosen Buy option of another decision that this decision picks a product for. Set on insert, checked by atlas.check_decision_follows_option, never updated. Null for an ordinary decision.';

create function atlas.check_decision_follows_option()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_option decision_options;
  v_parent decisions;
begin
  if new.follows_option_id is null then
    return new;
  end if;
  -- Serialise two people starting the product decision for one option.
  perform pg_advisory_xact_lock(hashtextextended('follows:' || new.follows_option_id::text, 0));
  -- Read through the caller's own RLS: an option in another organisation is not found.
  select * into v_option from decision_options where id = new.follows_option_id;
  if v_option.id is null then
    raise exception 'start_product_decision: option % not found', new.follows_option_id using errcode = '22023';
  end if;
  select * into v_parent from decisions where id = v_option.decision_id;
  if v_parent.id is null or v_parent.org_id is distinct from new.org_id or v_parent.model_id is distinct from new.model_id then
    raise exception 'start_product_decision: the option belongs to another organisation or model' using errcode = '22023';
  end if;
  if v_parent.status <> 'accepted' or v_parent.chosen_option_id is distinct from v_option.id then
    raise exception 'start_product_decision: choose the option before deciding which product' using errcode = '22023';
  end if;
  if v_option.approach is distinct from 'buy' then
    raise exception 'start_product_decision: only a Buy option has a product to choose' using errcode = '22023';
  end if;
  if exists (select 1 from decisions d where d.follows_option_id = new.follows_option_id and d.status <> 'rejected' and d.id <> new.id) then
    raise exception 'start_product_decision: a product decision for this option is already open or decided' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function atlas.check_decision_follows_option() from public, anon, authenticated;

create trigger decisions_check_follows_option
  before insert on decisions
  for each row execute function atlas.check_decision_follows_option();
