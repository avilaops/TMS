import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import "../landing.css";
import "../mobile.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="mello-shell"><SiteHeader /><main id="main-content" className="mello-main">{children}</main><SiteFooter /></div>;
}
