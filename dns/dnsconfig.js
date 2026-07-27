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
var APP_FLY = "commonclearing.fly.dev";

D(
  "commonclearing.org",
  REG_NONE,
  DnsProvider(CF),

  // --- website -------------------------------------------------------------
  ALIAS("@", WEBSITE_FLY + "."),
  CNAME("www", WEBSITE_FLY + "."),

  // --- hosted instance of the app ------------------------------------------
  // Convenience alias for the single running instance, whose primary hostname
  // is clearing.theborderland.se. Not a separate deployment: that instance is
  // scoped to Borderland 2026 memberships under either name.
  CNAME("app", APP_FLY + "."),

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
