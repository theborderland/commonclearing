# DNS for commonclearing.org

Managed as code with [DNSControl](https://docs.dnscontrol.org/) (v4.44.1+) against Cloudflare.

`creds.json` holds **no secrets** — it interpolates `$CLOUDFLARE_API_TOKEN` and
`$CLOUDFLARE_ACCOUNT_ID` from the environment, so it is safe to commit. The token itself
must never be written to a file in this repo.

## One-time setup

1. In the Cloudflare dashboard, create a **scoped API token**
   (My Profile → API Tokens → Create Token → Custom token) with exactly:

   | Permission | Scope |
   |---|---|
   | Zone → Zone → Read | All zones from the account, or just `commonclearing.org` |
   | Zone → DNS → Edit | Same |

   Do **not** use a Global API Key. It authenticates as your whole account and cannot be
   scoped or revoked independently.

2. Copy the Account ID from the Cloudflare dashboard sidebar (Workers & Pages → Overview,
   or any zone's right-hand column).

3. Put both in a file outside this repo, e.g. `~/.config/commonclearing/dns.env`:

   ```sh
   export CLOUDFLARE_API_TOKEN='...'
   export CLOUDFLARE_ACCOUNT_ID='...'
   ```

   `chmod 600` it.

## Usage

```sh
source ~/.config/commonclearing/dns.env
cd dns

dnscontrol check      # validate dnsconfig.js — no credentials needed
dnscontrol preview    # read-only diff against live Cloudflare state
dnscontrol push       # apply
```

Always run `preview` before `push`. `preview` is read-only and needs only the Read
permission, so it is safe to run at any time.

## Notes on the current config

- **Apex uses `ALIAS`**, not `A`/`AAAA`. Cloudflare flattens it at the edge, so the site
  survives Fly changing its anycast IPs. Fly's IPs are not contractually stable, so
  hardcoding them would rot silently.
- **CAA does not restrict issuance to Let's Encrypt alone**, despite what `dnsconfig.js`
  asks for. Whenever a zone has any CAA record, Cloudflare synthesises additional `issue`
  and `issuewild` entries for its own Universal SSL partner CAs — comodoca.com,
  digicert.com, pki.goog and ssl.com — directly into DNS responses. They are not stored as
  zone records, so `dnscontrol preview` neither shows nor removes them; verify with an
  external resolver, not the Cloudflare dashboard.

  Two consequences: five CAs can issue for this domain, not one; and the `issuewild ";"`
  ("no wildcards") is defeated, because the injected `issuewild` entries permit wildcards
  from those CAs. Accepted deliberately — all five are reputable and domain-validated, and
  the record still excludes every other CA. Disabling Universal SSL (SSL/TLS → Edge
  Certificates) would stop the injection, at the cost of a zone-wide change this site does
  not need. If certs ever move to a CA outside that set, update `dnsconfig.js` *first* or
  issuance will fail.
- **This domain sends no email.** The null SPF (`v=spf1 -all`), `p=reject` DMARC policy,
  and empty DKIM wildcard exist to make the domain unusable for spoofing. Notification
  email comes from theborderland.se via Mailgun. If commonclearing.org ever needs to send
  mail, all three records must change together.
- `commonclearing-website.fly.dev` and `commonclearing.fly.dev` do not exist yet.
  `dnscontrol push` will happily create records pointing at them regardless — DNS does not
  validate targets — so deploy the Fly apps first, or expect NXDOMAIN until you do.
