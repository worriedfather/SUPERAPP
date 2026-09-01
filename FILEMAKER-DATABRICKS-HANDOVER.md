# BizTracker → Databricks: connection details for the FileMaker team

DA Motors has set up a Databricks workspace to receive BizTracker data. This
document has everything needed to push into it.

**The client secret is deliberately blank below.** It is sent separately —
see "Credentials" — because a secret written into a document ends up in an
inbox, a chat history and someone's Downloads folder.

---

## What has been prepared

A dedicated schema, and a service principal that can write to that schema and
nothing else in the workspace.

| | |
|---|---|
| Workspace URL | `https://dbc-66f2753b-bff4.cloud.databricks.com` |
| Workspace (org) ID | `7474650280709437` |
| Cloud / region | AWS |
| SQL Warehouse ID | `8389efb3df7a24b2` |
| Warehouse HTTP path | `/sql/1.0/warehouses/8389efb3df7a24b2` |
| **Target for all data** | **`workspace.biztracker`** |

The warehouse is serverless: it starts on demand in a few seconds and stops
itself after 10 minutes idle. There is no "always on" endpoint to wait for, but
the first statement of a session will take longer than the rest.

---

## Credentials

Service principal **`filemaker-push`** — OAuth machine-to-machine.

    Client ID      17e4a00f-3c98-4509-a5f6-ebca10adefcb
    Client secret  (sent separately — do not request it by email)

Token endpoint, if your tooling needs it explicitly:

    POST https://dbc-66f2753b-bff4.cloud.databricks.com/oidc/v1/token
    Authorization: Basic base64(client_id:client_secret)
    Content-Type: application/x-www-form-urlencoded

    grant_type=client_credentials&scope=all-apis

Returns a bearer token valid for one hour. Cache it and refresh before expiry
rather than requesting one per statement.

### JDBC

    jdbc:databricks://dbc-66f2753b-bff4.cloud.databricks.com:443/default;
      transportMode=http;
      ssl=1;
      httpPath=/sql/1.0/warehouses/8389efb3df7a24b2;
      AuthMech=11;
      Auth_Flow=1;
      OAuth2ClientId=17e4a00f-3c98-4509-a5f6-ebca10adefcb;
      OAuth2Secret=<the secret>

### What this principal can and cannot do

Granted on `workspace.biztracker` only: `USE SCHEMA`, `CREATE TABLE`, `MODIFY`,
`SELECT`, plus `USE CATALOG` on `workspace`.

It cannot read or write any other schema, cannot administer the workspace, and
cannot see anything else in the account. This is deliberate — it limits what a
mistake or a leaked secret can reach. If something you need is refused, tell us
what and we will grant it specifically; please don't work around it.

---

## What we need back from you

Four things, before we can finish our side:

1. **Push times.** What time(s) of day will the push run? We pull shortly
   afterwards and want the two aligned rather than guessing. Once or twice a
   day is what we have planned for.

2. **Push method.** JDBC/ODBC, the SQL Statement Execution API, a file drop
   into a Volume followed by `COPY INTO`, a Databricks job, or something else?
   This decides whether the service principal needs an extra workspace
   entitlement — it currently has SQL access only, which covers JDBC and the
   API but not jobs or notebooks.

3. **Table names**, once created. We need the exact names in
   `workspace.biztracker` and, ideally, which BizTracker layout each came from.

4. **Full refresh or incremental?** If you replace a table on each push, say so.
   If you append or upsert, tell us which column identifies a row and which one
   marks its last modification.

## Two requests on the data itself

- **Keep the FileMaker `recordId` and modification timestamp** as columns if you
  can. Without them we cannot tell an edited record from a new one, and
  reconciling a disputed figure weeks later gets much harder.

- **Don't pre-aggregate.** Send the records as they are. We do the aggregation
  on our side, and a total we cannot decompose is a total we cannot check
  against BizTracker when someone queries it.

---

## Contact

Tinashe Severa — tinashe.severa@dafuels.com
