/** One call to action. At most one per message, deliberately. */
export type Cta = { label: string; url: string };

/**
 * What a message says, before it is any particular format. Both the HTML
 * and the plain-text parts are built from this -- the text is never
 * scraped out of the HTML, which is how text parts end up full of stray
 * markup.
 */
export type Body = {
  subject: string;
  headline: string;
  paragraphs: string[];
  cta: Cta | null;
  footerNote: string;
};

export type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
