# Connecting Atlas to MuleSoft Anypoint (no file needed)

Instead of running the export script and uploading a file, an owner can connect Atlas to Anypoint once. Importing then takes one button, **Fetch from MuleSoft**. The result is exactly the file the script would have written, so everything after it is unchanged: the same conversion, the same review queue, nothing changes in your model until you accept and apply. The file import keeps working and is still the right choice for a one-off or for an organisation too large to fetch in one go.

**Status:** built and tested against canned responses and a real local database. It has not been run against a live Anypoint organisation, and the Anypoint endpoints and permission names below come from MuleSoft's public documentation. The **Test connection** button is how you find out whether your setup works.

## Set it up (an owner, once)

1. **In Anypoint, find your organisation ID.** Open **Access Management**; the organisation (or business group) ID is on its page. Use a business group's ID if you only want that group's APIs.
2. **Create a connected app.** In Access Management open **Connected Apps** and create an app that **acts on its own behalf** (client credentials).
3. **Give it read-only access.** It needs to read **API Manager** (APIs and their contracts) and to view the organisation's **environments**, for the environments you want. Atlas never writes to Anypoint and never needs more than read. Anypoint's wording for these permissions varies by plan; if something is missing, **Test connection** says so.
4. **Copy the client ID and client secret.** The secret is shown once.
5. **In Atlas**, open **Organisation settings**, then **Connections**. Choose your region (United States, Europe or US government), paste the organisation ID, client ID and client secret, and list the environments to read, for example `Production, Sandbox`. Choose **Save**.
6. Choose **Test connection**. It signs in and checks the environments exist, and tells you plainly if it can't.

The client secret is saved encrypted (Supabase Vault) and is never shown again, not even to you. To change the settings without re-entering the secret, leave the secret box blank. To replace it, type the new one. **Remove connection** deletes the settings and the stored secret.

Owners can set it up and remove it; architects can see it and press **Test connection**. Nobody else sees it.

## Use it

1. Open **Import**, choose **MuleSoft Anypoint**, press **Fetch from MuleSoft**.
2. Atlas shows what it found and any warnings, exactly as it does for a file. Optionally map backend hostnames to your systems (or save them once on the system's page under **Add an external reference**).
3. **Start capture run**, then review and apply as usual.

## What it reads

Only what the script reads, with the same allow-list of fields: API instances (id, asset, version, label, description, backend endpoint, deprecated) and each API's contracts (status and the client application's id and name). No secrets, no payloads, no analytics. It never writes to Anypoint.

## If something goes wrong

| You see | Likely cause |
| --- | --- |
| Anypoint refused the client ID and secret | Wrong ID or secret, the wrong region, or the app is not a client-credentials app. |
| The connected app is not allowed to read… | The app lacks read access to API Manager or to the environment list. Add it in Anypoint. |
| Anypoint could not find… | Wrong organisation ID or environment name. |
| …ran out of time… | A large organisation. The fetch stops reading contracts after about 100 seconds and says the export is incomplete. Fetch again, or use the export script. |
| Could not reach the connector service | The `connector-fetch` function has not been deployed. |

A warning on the import (for example "Contracts for API 123 could not be read") means that part of the result is missing, not that it failed.

## For maintainers

- Design: `docs/ADR-032-connectors.md`. The pattern is reusable: a connector signs in to another tool, reads it, and returns the file that tool's import source already reads (`src/connectors/registry.ts`).
- Deploy: apply the migration (`pnpm release`), then `pnpm functions:deploy:connector-fetch`. Both are needed.
- Known gap: if the API list omits an API's backend endpoint, the host is simply not mapped; the converter says so in its report.
