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

3. Put both in a file outside this repo, e.g. `~/.config/common-clearing/dns.env`:

   ```sh
   export CLOUDFLARE_API_TOKEN='...'
   export CLOUDFLARE_ACCOUNT_ID='...'
   ```

   `chmod 600` it.

## Usage

```sh
source ~/.config/common-clearing/dns.env
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
- **CAA restricts issuance to Let's Encrypt**, which is what Fly provisions. If certs are
  ever moved to another CA, this record must be updated *first* or issuance will fail.
- **This domain sends no email.** The null SPF (`v=spf1 -all`), `p=reject` DMARC policy,
  and empty DKIM wildcard exist to make the domain unusable for spoofing. Notification
  email comes from theborderland.se via Mailgun. If commonclearing.org ever needs to send
  mail, all three records must change together.
- `common-clearing-website.fly.dev` and `common-clearing.fly.dev` do not exist yet.
  `dnscontrol push` will happily create records pointing at them regardless — DNS does not
  validate targets — so deploy the Fly apps first, or expect NXDOMAIN until you do.
