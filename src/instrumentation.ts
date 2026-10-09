/**
 * Roda uma vez quando o servidor sobe. Liga o despachante de eventos
 * (src/lib/eventos.ts), que entrega os eventos pendentes a cada 15 segundos.
 * `TMS_EVENTOS=off` desliga, para rodar uma segunda cópia do servidor sem
 * entregar nada.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.TMS_EVENTOS === "off") return;
  const { iniciarDespacho } = await import("@/lib/eventos");
  iniciarDespacho();
}
