# Microsoft sign-in for your company

This guide is for a company that wants its people to sign in to Atlas with their work Microsoft account. It has two halves: one for the **Atlas owner** and one for the company's **IT administrator**. Setup takes about ten minutes.

What it does: anyone who signs in to Atlas with a work Microsoft account from your company joins your Atlas organisation as a **Viewer**. You then change anyone's role in Organisation settings. Leavers can no longer sign in once their Microsoft account is disabled. They stay in your member list until an owner removes them.

What it does not do: it does not give anyone more than Viewer access, and it does not remove people automatically.

---

## Part 1. The Atlas owner

1. Find your company's **tenant ID**. In the Azure portal (portal.azure.com) or the Microsoft Entra admin center (entra.microsoft.com), open **Microsoft Entra ID**, then **Overview**. Copy the **Tenant ID**, a code like `72f988bf-86f1-41af-91ab-2d7cd011db47`. If you cannot open it, ask your IT administrator for it.
2. Sign in to Atlas as an owner, open your organisation, then **Organisation settings**, then **Microsoft sign-in**.
3. Paste the tenant ID and click **Save**. You should see "Saved. People who sign in with a Microsoft account from this tenant now join as Viewers."
   - "That Microsoft tenant is already connected to another organisation": another Atlas organisation holds it. Remove it there first, or contact us.
   - "That doesn't look like a Microsoft tenant ID": check you copied the whole code, not a domain name.
4. Ask your IT administrator to do Part 2, then tell your people to use **Sign in with Microsoft** on the Atlas sign-in page.

To stop new people joining this way, click **Remove** in the same panel. Existing members keep their access until you remove them under Members.

## Part 2. The IT administrator

Atlas needs a one-off approval from an administrator of your Microsoft tenant before your people can use it. This is the standard Microsoft step for any app, and approving it does not give Atlas access to your people's mail or files. Atlas only asks to sign people in and read their name and email address.

**The simplest way:** an administrator (a Global Administrator, Application Administrator or Cloud Application Administrator) opens Atlas, clicks **Sign in with Microsoft**, signs in with their own account, and when Microsoft shows the permission screen, ticks **Consent on behalf of your organization** and clicks **Accept**.

**Or approve it without signing in to Atlas:** open this address in a browser while signed in as an administrator, replacing the two placeholders:

`https://login.microsoftonline.com/<your tenant ID>/adminconsent?client_id=<Atlas client ID>`

(Atlas client ID: ask the Atlas team. After you accept, the browser may land on a plain page or an error from our sign-in service. That is expected; the approval has still been recorded.)

Afterwards you can check it under Microsoft Entra ID, **Enterprise applications**, **Atlas**. The permissions Atlas holds are: sign you in (`openid`), see your basic profile (`profile`), see your email address (`email`), and read your user profile (`User.Read`).

If your tenant requires an approval workflow for apps, you will see "Need admin approval". Send the request to an administrator.

## What your people will see

1. On the Atlas sign-in page they click **Sign in with Microsoft**.
2. They sign in with their normal work account (the first time, a permission screen if the administrator has not already approved Atlas for the company).
3. They land in your Atlas organisation as a Viewer.

## If something goes wrong

| What happens | What to do |
|---|---|
| Microsoft says "Need admin approval" | The IT administrator has not done Part 2 yet. |
| The person lands on "Your company hasn't set up Atlas yet" | The owner has not saved the tenant ID (Part 1), or saved a different one. Check it matches Entra, Overview, Tenant ID. |
| The person signs in but is not in the organisation | Same cause, or their account is from a different Microsoft tenant, such as a guest or contractor account. |
| The person is sent back to the Atlas sign-in page with no message | Their Microsoft account has no email address set. The administrator opens the user in Entra, Properties, Contact information, and fills in **Email**. |
| Personal accounts (outlook.com, hotmail.com) | Not supported. Work or school accounts only. |

Questions about this guide: contact the Atlas team.
