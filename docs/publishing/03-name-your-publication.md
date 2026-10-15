# Name your publication

Give your newsletter a name and a look before your first post. Set the name, tagline, and logo under **Settings → Publication identity**. They appear in every email your template prints them in, on the public pages readers see, and in the confirmation email new subscribers get.

All three are optional and can change at any time. Left blank, the name falls back to your emails' From name. Pick a logo at least 256 × 256 px: Kestrel shows it square everywhere, cropping a wider or taller image to its center. An email already sent, and its archive page, keep the identity they went out with.

## When to provide a mailing address

**Probably not, if your newsletter is mostly your own writing. Yes, if you use it to sell.** The address is optional, and you can add it or remove it at any time.

US law (CAN-SPAM) requires a postal address in commercial email. That's email whose primary purpose is to advertise or promote a product or service, at any volume. In its [2008 rule](https://www.ftc.gov/sites/default/files/documents/federal_register_notices/definitions-and-implementation-under-can-spam-act-16-cfr-part-316/080521canspamact.pdf), the FTC treats a newsletter someone subscribed to as a "transactional or relationship" message instead. That holds when it's mainly content, even with ads mixed in. A subscription that's purely advertising, like a catalog, stays commercial.

An email whose primary purpose is selling is a different matter. The FTC's [primary-purpose test](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.3) looks at what the email says and what its subject line suggests. So you probably need an address in:

- An email that's mainly selling, such as a launch, a sale, a paid course, or event tickets.
- A post that's mostly sponsor content or promotions.
- A mixed email whose subject line reads like an ad.

A nonprofit isn't exempt as a kind of sender. What the email says decides it. Canada's anti-spam law (CASL) usually counts more email as commercial, and asks for a mailing address in it too ([Government of Canada guidance](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en)). Gmail and Yahoo don't ask for one: their [rules for bulk senders](https://support.google.com/a/answer/14229414) are authentication, one-click unsubscribe, and a low spam-complaint rate.

**What counts.** A street address, a USPS P.O. box, or a private mailbox registered with the Postal Service. You never have to publish a home address.

**Adding it.** Under **Settings → Publication identity**, choose **Add a mailing address**. The built-in and starting templates print it in the footer once it's set. They keep it off each post's public page, so your address isn't on the web. If your own template doesn't include `{{ .Publication.Address }}`, Kestrel warns you when you save.

This is general information, not legal advice. The FTC's [CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) is the plain-language source, and [Sending rules](02-sending-rules.md) covers the rest of what the law asks of a newsletter.

## The email template

Every post is sent in one template, HTML that Kestrel fills in when it sends. The built-in one works as it comes. To change it, choose **Template** in the sidebar, edit, and save. **Start from example** offers two starting points, and **Send test email** sends a sample post through your saved template.

Kestrel won't save a template without `{{ .Post.Body }}` and `{{ .Email.UnsubscribeURL }}`. Every email has to carry the post and a way to leave. Wrap a part in `{{ if .IsEmail }}` and `{{ end }}` to keep it off each post's public page. The starting templates do this with the unsubscribe link and mailing address.

| Variable | What it holds |
| --- | --- |
| `{{ .Post.Body }}` | Your post, rendered from Markdown. Required. |
| `{{ .Post.Subject }}` | The post's subject line. |
| `{{ .Publication.Name }}` | Your publication's name. |
| `{{ .Publication.Tagline }}` | Your tagline. |
| `{{ .Publication.Logo }}` | Your logo as an image, or nothing when no logo is set. |
| `{{ .Publication.LogoURL }}` | Your logo's address, or empty. |
| `{{ .Publication.Address }}` | Your mailing address, or empty. |
| `{{ .Email.SentTo }}` | The address this email was sent to. |
| `{{ .Email.UnsubscribeURL }}` | This reader's one-click unsubscribe link. Required. |
| `{{ .Email.ViewInBrowserURL }}` | The post's public page. |

## Changes and scheduled posts

A scheduled post's email is made when you schedule it. So a change to the template, or to a part of your identity it prints, re-makes each scheduled post's email. Its content and send time stay the same. A dialog lists those posts and asks before it saves, and a logo change asks the same way.

Afterwards, each of those posts says its look changed since your last test, until you send a fresh one. Send it, since your earlier test no longer shows what goes out.

- **A post about to send,** within the minimum lead of its send time, blocks the change. Kestrel says when you can try again, once that post has gone out.
- **Posts already sending or sent** never change.

## Who sets the From name and address

Whoever manages your Kestrel instance sets the From name and address your emails come from, and **Settings → Email sender** shows them read-only. [Connect Amazon SES](../get-started/04-ses.md#8-set-the-provider-and-deploy) covers setting them.

Next, [Check your setup](10-check-your-setup.md).
