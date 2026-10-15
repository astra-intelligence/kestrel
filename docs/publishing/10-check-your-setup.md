# Check your setup

Before your readers get anything, see it arrive yourself, and make sure a problem will reach you without your watching for it. Send yourself a test and reply to it, subscribe yourself, and set where Kestrel emails you.

**A list of more than about 5,000 subscribers is better on the paid hosting plan.** Whoever manages your Kestrel instance makes the change, so read [Bring your existing list](01-your-list.md) before you import.

## Send yourself a test

Choose **Template** in the sidebar, then **Send test email**, and send a sample post to your own inboxes. When it arrives, check:

- **The From name and address,** which readers see first. Whoever manages your Kestrel instance sets them.
- **Where it lands:** the inbox, Promotions, or spam. If it lands in spam, tell whoever manages your Kestrel instance. [Sending-domain DNS](../reference/02-sending-domain-dns.md) covers what they check.
- **A reply.** Reply to the test, and check that it reaches your inbox. Kestrel never sees replies, so this depends on [forwarding set up by whoever manages your Kestrel instance](../get-started/04-ses.md#3-receive-replies-at-your-from-address).

## Subscribe yourself

Subscribe with a personal address at your publication's address followed by `/subscribe`, and confirm. You see what a new reader sees, and you then appear under **Subscribers** as **Confirmed**. [Share your subscribe link](09-share-your-subscribe-link.md) covers the page and the confirmation email.

## Set your notifications address

Under **Settings → Notifications**, fill in **Send notifications to**, save, and choose **Send a test notification**. Kestrel then emails you when a send finishes or needs you. [Notifications](06-troubleshooting.md#notifications) lists what you're told, and why a second way to send them is worth asking for.

## If email isn't connected

Until whoever manages your Kestrel instance connects an email provider, nothing can be sent, and the dashboard says so. The checklist shows **Connect Amazon SES** in place of this step, as [Connect Amazon SES](../get-started/04-ses.md) describes. **Settings → Email sender** shows your From address, sending domain, and provider, read-only.

## As your list grows

A growing list meets your provider's daily sending quota, longer sends, and on the free hosting plan, a cap on daily database writes. Kestrel tells you when you reach each one. Raising each is for whoever manages your Kestrel instance, as [As your list grows](../get-started/06-go-live.md#as-your-list-grows) describes.

