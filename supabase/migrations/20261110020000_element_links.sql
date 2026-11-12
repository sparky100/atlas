-- Document links on any element (ADR-030): labelled pointers to where a
-- document lives (Confluence, SharePoint, a shared drive). Atlas stores the
-- label and the pointer, never the document. A pointer is either an http(s)
-- link or a plain reference such as "SharePoint > Business cases".
--
-- Reference material, not architecture fact: this is a workflow-tier table
-- on the same tier as `evidence` and `project_links` — never a delta, never
-- folded into a head, never in a version. Owners and architects write it
-- directly; everyone in the organisation can read it. Editing or removing a
-- link is NOT in History (accepted risk, ADR-030); who added it and when is
-- kept on the row.

create table element_links (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  element_id uuid not null,
  label text not null check (length(btrim(label)) > 0),
  pointer text not null check (length(btrim(pointer)) > 0),
  kind text not null check (kind in ('link', 'reference')),
  -- A web link is always http(s); anything else must be a reference.
  constraint element_links_kind_matches_pointer check ((kind = 'link') = (pointer ~* '^https?://\S+$')),
  added_by uuid not null references auth.users (id),
  added_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz
);

comment on table element_links is 'ADR-030: labelled document links on an element. Pointers only; Atlas never stores documents. Workflow tier (like evidence): not a delta, owner/architect write directly, edits are not in History.';

create index element_links_model_element_idx on element_links (model_id, element_id);

-- The element must exist in the link's own model (checked against permanent
-- history, like comment anchors and project scope); model/org must agree.
create or replace function atlas.check_element_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from models where id = new.model_id and org_id = new.org_id) then
    raise exception 'check_element_link: model % is not in organisation %', new.model_id, new.org_id using errcode = '23503';
  end if;
  if tg_op = 'INSERT' or new.element_id is distinct from old.element_id then
    if not exists (select 1 from deltas where kind = 'element_create' and subject_id = new.element_id and model_id = new.model_id) then
      raise exception 'check_element_link: no element % in this model', new.element_id using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger element_links_check
  before insert or update on element_links
  for each row execute function atlas.check_element_link();

alter table element_links enable row level security;
alter table element_links force row level security;

create policy element_links_select on element_links
  for select to authenticated
  using (atlas.is_member(org_id));

create policy element_links_insert on element_links
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') and added_by = auth.uid());

create policy element_links_update on element_links
  for update to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'))
  with check (atlas.has_role(org_id, 'owner', 'architect'));

create policy element_links_delete on element_links
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'));

-- Only the human-editable columns are updatable; identity and who/when added are fixed.
grant select, insert, delete on element_links to authenticated;
grant update (label, pointer, kind, updated_by, updated_at) on element_links to authenticated;
