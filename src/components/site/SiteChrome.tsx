import { Mail, Phone, Send } from "lucide-react";
import { company } from "@/config/company";

/**
 * Cabecalho e rodape das paginas servidas fora da landing (hoje o blog).
 *
 * A landing e um client component unico com roteamento por hash, entao o
 * cabecalho dela nao da para reaproveitar sem arrastar o arquivo inteiro para
 * ca. Estes dois componentes repetem a mesma marcacao e as mesmas classes de
 * landing.css, mas com links absolutos, para o visual continuar o mesmo.
 */

function Logo() {
  return (
    <a className="logo" href="/" aria-label="Ir para o início">
      <img src="/logo-mello.png" alt="" />
      <span>
        <strong>
          Mello <b>Transportes</b>
        </strong>
        <small>{company.tagline}</small>
      </span>
    </a>
  );
}

export function SiteHeader() {
  const links: [string, string][] = [
    ["/", "Início"],
    ["/#/cidades", "Cidades"],
    ["/#/frota", "Frota"],
    ["/blog", "Blog"],
    ["/#/duvidas", "Dúvidas"],
  ];

  return (
    <header className="topbar">
      <Logo />
      <nav className="nav">
        {links.map(([href, label]) => (
          <a href={href} key={href}>
            {label}
          </a>
        ))}
        <a href={company.phoneHref}>
          <Phone size={16} />
          {company.phone}
        </a>
        <a className="btn primary" href="/#/coleta">
          <Send size={16} />
          Solicitar coleta
        </a>
      </nav>
      <a className="whats-mini" href="/#/coleta">
        WhatsApp
      </a>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <Logo />
      <p>{company.serviceRegion}</p>
      <p>
        <Phone size={16} /> {company.phone} · {company.whatsapp}
      </p>
      <p>
        <Mail size={16} /> {company.email}
      </p>
      <p>{company.address}</p>
      <small>
        © {new Date().getFullYear()} {company.shortName}. Política de
        privacidade: os dados preenchidos montam a mensagem enviada pelo WhatsApp
        e ficam registrados no sistema comercial da Mello Transportes para o
        atendimento da solicitação.
      </small>
    </footer>
  );
}
