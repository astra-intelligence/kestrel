/** When a published post's archive address answers (SPEC §5): one rule for the archive page
 *  and every link the API reports to it, so the two cannot disagree. */

/**
 * Whether a published post's archive address shows its page. Only a reserved address ever
 * does (SPEC §4), and only while the post is listed, so making a post email only takes the
 * address down while keeping it reserved for the post. The exception is a post whose
 * published send carries that address as its "view in browser" link (a send frozen before
 * unlisted links, `webLink: "archive"`): every copy of that email links there, so it answers
 * whatever the listing.
 */
export function archiveAnswers(post: {
  reserved: boolean;
  emailOnly: boolean;
  webLink: "unlisted" | "archive";
}): boolean {
  return post.reserved && (!post.emailOnly || post.webLink === "archive");
}
