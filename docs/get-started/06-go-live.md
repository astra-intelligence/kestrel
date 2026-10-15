# Go live

This last step makes the newsletter yours, and tells people where to subscribe.

In this guide, you check your publication's name, add a logo, and share your subscribe link. You also see what to change as your list grows.

## Before you begin

- SES production access, granted in the region the app sends from. [Connect Amazon SES](04-ses.md#5-request-production-access) asks for it.
- `SES_MAX_SEND_RATE` set to the maximum send rate on the SES **Account dashboard**, and deployed. [Connect Amazon SES](04-ses.md#8-set-the-provider-and-deploy) sets it to `1` for the sandbox.

In the sandbox, SES refuses the confirmation email to any address you haven't verified, so those signups fail. A post reaches only the addresses you verified in SES.

## 1. Name your publication

Your publication's name, tagline, and logo appear on the public pages readers see, and in every email. You named it in [Connect Amazon SES](04-ses.md#5-request-production-access). Check those, and add a logo before anyone sees your pages.

1. In the editor, open **Settings → Publication identity**.

1. Check the name and tagline, and upload a logo.

1. **(Optional)** Select **Add a mailing address**. US law asks for a postal address in promotional email, and a P.O. box works. The built-in email template prints it in every email's footer.

## 2. Share your subscribe link

Readers subscribe on a page the app hosts. Every signup confirms by email before it joins your list.

1. In the editor, open **Settings → Ways to subscribe**.

1. Copy your subscribe page's link, `https://newsletter.example.com/subscribe`, and share it.

1. **(Optional)** To take signups on your own website, copy the embeddable subscribe form from the same page, and paste it into your site.

1. **(Optional)** Cap how often one visitor can submit the form. The app already sends any one address at most one confirmation every 15 minutes. A Cloudflare rule can also limit each visitor, and the Free plan includes one. See [Rate-limit the subscribe form](../guides/05-rate-limit.md).

## As your list grows

A new instance runs on Cloudflare's free Workers plan with your starting SES limits. That suits a list of up to about 5,000 subscribers. Two upgrades take it further: one with AWS, which helps on either plan, and one with Cloudflare, which a larger list needs.

**Ask AWS to raise your SES limits, on either plan.** SES caps how many emails your account sends a day, and how many a second. A send that hits the daily quota waits, emails you, and resumes on its own once the quota frees up. Raising your maximum send rate to 50 a second costs nothing. Once AWS grants it, set [`SES_MAX_SEND_RATE`](../reference/01-configuration.md#ses_max_send_rate) to match, and deploy again.

**Move to the $5 Workers Paid plan from about 5,000 subscribers.** On the free plan, [D1](https://developers.cloudflare.com/d1/platform/pricing/) allows a fixed number of database writes a day. A send to about 7,000 recipients uses them all, and then the whole app stops until midnight UTC. Workers Paid has no daily limit. After you move, set [`SUBREQUEST_BUDGET`](../reference/01-configuration.md#subrequest_budget) to `10000` and deploy again, so each minute sends far more. Until then, the app warns you before a send or an import that could use up the day.

How long a send takes, with each upgrade:

| Setup | 1,000 subscribers | 5,000 subscribers | 10,000 subscribers |
| --- | --- | --- | --- |
| Free plan, a starting SES rate of 14 | about 18 minutes | about 1.5 hours | over the free plan's daily writes |
| Free plan, SES rate raised to 50 | about 5 minutes | about 25 minutes | over the free plan's daily writes |
| Workers Paid, SES rate of 14 | about 2 minutes | about 7 minutes | about 15 minutes |
| Workers Paid, SES rate of 50 | under a minute | about 2 minutes | about 4 minutes |

## Check it

1. The SES **Account dashboard**, in the region the app sends from, no longer says your account is in the sandbox.

1. `https://newsletter.example.com/subscribe` shows your publication's name and logo.

1. `https://newsletter.example.com/` shows your publication's name, and the post you sent yourself in [Verify it works](05-verify.md#4-send-a-real-post-to-yourself).

## What's next

Each of these guides stands on its own. Pick the ones you want.

- [Connect Claude to the API](../guides/01-connect-claude.md), so Claude can draft, proofread, and schedule posts through the same API the editor uses.
- [Notifications through Cloudflare's email](../guides/03-notifications.md), so you hear about problems even when your email provider has stopped sending.

If someone else writes the newsletter, point them to the docs' Publishing section, written for them, starting with [Bring your existing list](../publishing/01-your-list.md).

When a new release comes out, [Upgrade to a new release](../guides/07-upgrade.md) shows how to move to it.
