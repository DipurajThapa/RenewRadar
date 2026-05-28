import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t bg-muted/20 mt-24">
      <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
        <div className="col-span-2 md:col-span-1">
          <div className="font-semibold flex items-center gap-2">
            <span aria-hidden>⚡</span>
            <span>Renewal Radar</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 max-w-xs">
            SaaS subscription and notice-deadline manager for IT/Ops leads at
            25–500 person companies.
          </p>
        </div>

        <FooterCol title="Product">
          <FooterLink href="/#features">Features</FooterLink>
          <FooterLink href="/pricing">Pricing</FooterLink>
          <FooterLink href="/#how-it-works">How it works</FooterLink>
          <FooterLink href="/#faq">FAQ</FooterLink>
        </FooterCol>

        <FooterCol title="Company">
          <FooterLink href="mailto:hello@renewalradar.com">Contact</FooterLink>
          <FooterLink href="mailto:security@renewalradar.com">
            Security disclosure
          </FooterLink>
        </FooterCol>

        <FooterCol title="Legal">
          <FooterLink href="/privacy">Privacy</FooterLink>
          <FooterLink href="/terms">Terms</FooterLink>
        </FooterCol>
      </div>

      <div className="border-t">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} Renewal Radar · Built in the United States
          </span>
          <span>
            We never pool, share, or sell your contract data
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="text-sm text-foreground hover:underline"
      >
        {children}
      </Link>
    </li>
  );
}
