// Serialize a JSON-LD payload for embedding in a
// <script type="application/ld+json"> block.
//
// The page templates emit this with a triple-stache ({{{schemaJson}}}) because
// the payload is JSON, not HTML — Handlebars' default HTML-escaping would turn
// every quote into &quot; and corrupt the block. That means nothing downstream
// escapes this string, and JSON.stringify does NOT escape "<".
//
// Everything in the graph is operator- or customer-supplied: review text and
// names, the generated narrative, FAQ answers, technician bios. A review
// containing "</script>" would otherwise close the block early and drop
// whatever follows into the published page as live markup — on a static file
// we then commit and serve to customers.
//
// Escaping "<" and ">" to their \u00xx forms keeps the document valid JSON with
// byte-identical parsed values (consumers such as Google read them back
// unchanged), while making a literal "</script" impossible to express. Those
// characters only ever appear inside string literals — JSON's own syntax uses
// none of them — so a whole-document replace cannot damage the structure.
//
// U+2028 and U+2029 are legal inside JSON strings but are line terminators in
// JavaScript, which breaks any consumer that evaluates the block rather than
// parsing it. They get the same treatment. Both are referenced via
// fromCharCode so this file stays pure ASCII and the characters can't be
// silently mangled by an editor or a copy-paste.
const LINE_SEP      = String.fromCharCode(0x2028);
const PARAGRAPH_SEP = String.fromCharCode(0x2029);

const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  [LINE_SEP]: '\\u2028',
  [PARAGRAPH_SEP]: '\\u2029',
};

const UNSAFE = new RegExp('[<>' + LINE_SEP + PARAGRAPH_SEP + ']', 'g');

export function serializeJsonLd(payload) {
  return JSON.stringify(payload, null, 2).replace(UNSAFE, ch => ESCAPES[ch]);
}
