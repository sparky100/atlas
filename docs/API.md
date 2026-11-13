# Atlas read-only API (v1)

Read your organisation's models from another tool. Read-only: only `GET` works. See ADR-031 for the design.

## Get a key

An organisation owner opens **Organisation settings → API access**, names a key and presses **Create key**. The key is shown once; copy it then. Owners can revoke it from the same list. Treat a key like a password.

## Call it

```sh
curl -H "Authorization: Bearer atl_…" \
  "https://<project-ref>.supabase.co/functions/v1/api/v1/models"
```

A key reads only its own organisation, and only the current agreed version of each model (never a change in progress).

| Endpoint | Returns |
| --- | --- |
| `GET /v1/models` | Your organisation's models (id, name, slug, description). |
| `GET /v1/models/{model}` | One model. `{model}` is its id or slug. |
| `GET /v1/models/{model}/elements` | Elements (applications, capabilities, containers, actors, value streams). Filters: `type`, `q` (text in the name). |
| `GET /v1/models/{model}/elements/{id}` | One element with its aliases and every attribute value with its source, confidence and date. |
| `GET /v1/models/{model}/capabilities` | Capabilities with `parent_id` and `supported_by` (system ids). Build the tree from `parent_id`. |
| `GET /v1/models/{model}/relationships` | Relationships. Filters: `type`, `element` (either end). |
| `GET /v1/models/{model}/findings` | The same problem checks as "Where to focus", each with a count. |
| `GET /v1/models/{model}/findings/{key}` | The elements one finding flags. |

## Responses

```json
{ "data": [ … ],
  "page": { "limit": 50, "next_cursor": "…", "total": 212 },
  "meta": { "api_version": "v1", "model": { "id": "…", "name": "…" }, "commit_id": "…" } }
```

- **Paging:** `?limit=` (1 to 200, default 50) and `?cursor=` (pass back `next_cursor`; it is opaque). `next_cursor` is `null` on the last page.
- **Errors:** `{ "error": { "code", "message" } }` with status `400` (bad filter, limit or cursor), `401` (missing, unknown or revoked key), `404`, `405` (anything but GET), `429` (see below).
- **Rate limit:** 120 requests a minute per key. Over it you get `429` with a `Retry-After` header in seconds.
- **Versioning:** the version is in the path. New fields may appear in v1; nothing is renamed or removed without `/v2`.

## Deploying (maintainers)

```sh
git pull
pnpm release                  # pushes migration 20261112030000_api_keys.sql
pnpm functions:deploy:api     # bundles and deploys with --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically. Deploying without `--no-verify-jwt` makes every API call fail with 401 from the platform.
