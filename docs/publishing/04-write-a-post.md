# Write and send a post

You write a post in Markdown, test it, and schedule it. Scheduling locks the post and makes the exact email that will go out. Then you send yourself a test of that copy, so the email you tested is the one your list receives.

**New post**, on the Dashboard or under **Drafts**, opens a draft. Kestrel saves as you type, and **Preview** shows the email as it will look.

## Writing

- **Subject and slug.** The **Subject** is the email's subject line, and a post needs one to schedule. The **Slug** ends the post's permanent public address, such as `newsletter.example.com/archive/spring-update`. It follows the subject until you type your own, and it's fixed once the post is scheduled.
- **Markdown.** Kestrel reads GitHub's flavor, and the toolbar covers the common cases. In an email, a single line break doesn't start a new line, so leave a blank line between paragraphs.
- **HTML.** It works where Markdown falls short. Kestrel removes scripts, `<style>` blocks, forms, and event handlers, so style a piece with an inline `style` attribute.
- **The opening lines** are what a mail client shows beside the subject. There's no separate field for that preview, so make them count.
- **Images.** Paste or drop one into the composer. Kestrel uploads it and inserts a reference by file name, such as `![cover.jpg](cover.jpg)`. Replace the words in brackets with a short description, which screen readers read aloud and blocked images show.
- **Image files.** PNG, JPEG, WebP, or GIF, up to 5 MB each. Kestrel doesn't shrink them, and every reader downloads them, so smaller opens faster. Images are public, and fixed once the post is scheduled.
- **Versions.** Every save keeps a whole version of the post. The editor doesn't show that history, but [Claude](07-working-with-claude.md) can read it back.
- **Someone else editing.** If Claude or another tab saves a newer version, a banner says who, and your saves pause until you choose. One save never silently overwrites another.

Whoever manages your Kestrel instance chose the part of the address before the slug, as [Configuration](../reference/01-configuration.md#archive_base_path) describes.

## Test it

**Send test email** sends the real email, through the same template and code as the send, to the addresses you name. **Settings → Default test recipients** fills them in for you. Nobody on your list gets anything, and a test's unsubscribe link unsubscribes no one.

Mail clients each draw email a little differently, so trust a test over **Preview**, especially for tables, code, and HTML. A test needs an email provider, which whoever manages your Kestrel instance connects ([Connect Amazon SES](../get-started/04-ses.md)).

## Schedule and send

Choose **Schedule** at the foot of the editor, pick a time under **Send at**, and confirm. The time must be at least the minimum lead away: five minutes, unless whoever manages your Kestrel instance set a different one ([Configuration](../reference/01-configuration.md#min_lead_seconds)). Neither the dashboard nor Claude can shorten it. Times are to the minute, and one with seconds rounds up.

Scheduling makes the email once, from the post, your template, and your publication's details as they are at that moment. That frozen copy is what goes out, and it's also the post's page in your archive. So the post is locked, and **Preview** and **Send test email** show the frozen copy.

**Send yourself a test now.** It's the copy your list receives, and the time until the send is your window to catch a mistake, including one Claude made.

A change to your template, or to a publication detail it shows, re-makes every scheduled post's email, with the same content and send time. Kestrel asks before it saves, and each re-made post then asks you to send a new test. [Changes and scheduled posts](03-name-your-publication.md#changes-and-scheduled-posts) covers what changes and when a save is refused.

**Send now →**, under the time picker, is for a post you've already reviewed. It still waits out the window, scheduling the post for the minimum lead from now.

### Changing your mind

**Cancel**, on the post's banner or its card under **Sent**, makes the post a draft again at once. Edit it, test again, and schedule it again. **Reschedule** moves the send time without unlocking the post, and your tests still count. You can do either until the send time.

### Who receives it

A post goes to your list as it stands when it sends: every confirmed subscriber, except addresses that bounced, complained, or were blocked. Someone who confirms while it's scheduled receives it. Someone who unsubscribes before their email is handed to your provider doesn't, even partway through the send.

So a recipient count shown before the send is a snapshot. An import that adds subscribers while a post is scheduled adds them to its audience too, and asks you first ([Bring your existing list](01-your-list.md#what-an-import-does)).

### Warnings when you schedule

- **No email provider connected.** The Schedule dialog can't schedule until whoever manages your Kestrel instance connects one. If the provider goes after a post is scheduled, the post is held, stays cancelable, and goes out once one is connected.
- **Daily database writes.** On the free hosting plan, a large send may use up the day's writes. The dialog warns you without stopping you, as [Bring your existing list](01-your-list.md#limits) explains.

### When it sends

At the send time, the post moves to its send page under **Sent**, where you can watch it go out. From then it can't be edited, canceled, or moved. Its archive page goes up at the same moment, showing exactly the copy that was sent, so every email's "view in browser" link works. Whatever interrupts a send, such as your provider's daily quota running out, it waits and resumes where it stopped. No reader gets the same post twice.

If a send needs your attention, the send page and the dashboard say so. [When something's wrong](06-troubleshooting.md) covers each case.
