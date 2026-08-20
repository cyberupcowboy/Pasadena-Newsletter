# Editorial Dashboard

The dashboard in `dashboard/` is a small browser-based editor console for the Pasadena Community Brief review queue.

## Capabilities

- Email/password sign-in through Supabase Auth.
- No public sign-up flow.
- Private editor-membership authorization in `app_private.editor_members`.
- Review queue sorted by Pasadena relevance and urgency.
- Filters by editorial status and category.
- Search across headline, summary, location, and AI rationale.
- Source-page links.
- Editable AI headline, summary, and internal review notes.
- Approve and reject actions.
- Automatic `reviewed_by`, `reviewed_at`, and `last_edited_at` audit fields.

## Security model

The frontend uses the project's publishable Supabase key. This key is public by design. Database access is authorized by the signed-in user's JWT plus Row Level Security.

The backend ingestion `SUPABASE_SECRET_KEY` must never be placed in dashboard code. Secret/service-role keys bypass RLS and remain server-side only.

Only active users present in the private `app_private.editor_members` table can select or update `public.stories` through the Data API. The dashboard has no sign-up action.

The private membership table is not in an exposed schema and is not granted to browser clients. Authorization is checked through `app_private.is_editor()` from the story RLS policies.

## First editor bootstrap

There are currently no Supabase Auth users in the project. Before using the dashboard:

1. Open the Pasadena Community Brief project in Supabase.
2. Go to **Authentication → Users**.
3. Create the editor account with email/password and ensure the email is confirmed.
4. Add that user's UUID to `app_private.editor_members` with role `admin` or `editor`.

Example SQL after the Auth user exists:

```sql
insert into app_private.editor_members (user_id, role)
values ('<auth-user-uuid>', 'admin')
on conflict (user_id) do update
set role = excluded.role,
    active = true;
```

Do not invent or manually insert rows into `auth.users` through SQL. Create Auth users through Supabase Auth user-management flows.

## Local preview

From the repository root:

```bash
python3 -m http.server 8080 -d dashboard
```

Then open `http://localhost:8080` and sign in with the Auth account created above.

## Deployment

`dashboard/` is static and can be hosted by a static-site provider. The browser only contains the publishable key; all story access remains protected by Supabase Auth and RLS.

Before publishing a public URL, keep the no-signup design and ensure every intended editor has an explicit membership row.
