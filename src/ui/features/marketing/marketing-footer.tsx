import Link from "next/link";
import { Zap } from "lucide-react";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-secondary/40 mt-20">
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-14 grid grid-cols-2 md:grid-cols-5 gap-10 text-sm">
        <div className="col-span-2 md:col-span-2 space-y-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 font-semibold group"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card group-hover:bg-primary-strong transition-colors">
              <Zap className="h-4 w-4" />
            </span>
            <span className="font-display tracking-tight">Renewal Radar</span>
          </Link>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            SaaS renewal intelligence for IT &amp; Ops leads at 25–500-person
            companies. We watch every notice deadline; you stay in control of
            every external communication.
          </p>
        </div>

        <FooterCol title="Product">
          <FooterLink href="/#features">Features</FooterLink>
          <FooterLink href="/pricing">Pricing</FooterLink>
          <FooterLink href="/#how-it-works">How it works</FooterLink>
          <FooterLink href="/#faq">FAQ</FooterLink>
        </FooterCol>

        <FooterCol title="Resources">
          <FooterLink href="/blog">Blog</FooterLink>
          <FooterLink href="/security">Security</FooterLink>
          <FooterLink href="/contact">Contact</FooterLink>
          <FooterLink href="mailto:security@renewalradar.com">
            Security disclosure
          </FooterLink>
        </FooterCol>

        <FooterCol title="Legal">
          <FooterLink href="/privacy">Privacy</FooterLink>
          <FooterLink href="/terms">Terms</FooterLink>
          <FooterLink href="/legal/dpa">DPA</FooterLink>
        </FooterCol>
      </div>

      <div className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} Renewal Radar · Built in the United States
          </span>
          <span>We never pool, share, or sell your contract data.</span>
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
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80 font-medium">
        {title}
      </div>
      <ul className="space-y-2.5">{children}</ul>
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
        className="text-sm text-foreground/80 hover:text-foreground transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}
