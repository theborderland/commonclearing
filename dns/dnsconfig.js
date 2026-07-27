// DNS-as-code for commonclearing.org, managed with DNSControl.
//
//   dnscontrol check          validate this file
//   dnscontrol preview        show what would change (read-only)
//   dnscontrol push           apply changes
//
// Credentials come from creds.json, which reads them out of the environment.
// See dns/README.md.

var REG_NONE = NewRegistrar("none"); // domain registered at Cloudflare; registrar not managed here
var CF = NewDnsProvider("cloudflare");

// ---------------------------------------------------------------------------
// Deployment targets.
//
// The website is a static Fly app; the app is the Rust API + PWA. Cloudflare
// flattens the apex CNAME, so both can point at *.fly.dev without hardcoding
// Fly's IPs (which are not guaranteed stable).
// ---------------------------------------------------------------------------
var WEBSITE_FLY = "commonclearing-website.fly.dev";

D(
  "commonclearing.org",
  REG_NONE,
  DnsProvider(CF),

  // --- website -------------------------------------------------------------
  ALIAS("@", WEBSITE_FLY + "."),
  CNAME("www", WEBSITE_FLY + "."),

  // --- no app subdomain, deliberately --------------------------------------
  // The only running instance is The Borderland's, and it lives on their
  // domain at clearing.theborderland.se because it is scoped to Borderland
  // 2026 memberships. Pointing app.commonclearing.org at it would show a
  // login wall for an event most visitors are not members of.
  //
  // A future global instance that anyone can sign up to would need its own
  // Fly app and its own identity provider, at which point it gets designed
  // properly rather than added as a CNAME.

  // --- certificate authority authorisation ---------------------------------
  // Only Let's Encrypt may issue. Fly uses Let's Encrypt for its certs.
  CAA_BUILDER({
    label: "@",
    iodef: "mailto:tech@theborderland.se",
    iodef_critical: true,
    issue: ["letsencrypt.org"],
    issuewild: "none",
  }),

  // --- email: this domain sends no mail ------------------------------------
  // Notification email is sent from theborderland.se via Mailgun, not from
  // here. Publishing a null SPF plus a strict DMARC policy stops this domain
  // being used to spoof mail. Remove these if commonclearing.org ever sends.
  TXT("@", "v=spf1 -all"),
  TXT("_dmarc", "v=DMARC1; p=reject; rua=mailto:tech@theborderland.se"),
  TXT("*._domainkey", "v=DKIM1; p="),
);
