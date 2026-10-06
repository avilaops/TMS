import { hubs, serviceAreas } from "@/data/serviceAreas";

export function routeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const publicServices = [
  {
    slug: "coletas-comerciais", title: "Coletas comerciais", summary: "Da sua empresa para a próxima entrega.",
    description: "Organize a retirada da mercadoria na sua empresa, com origem, destino e volumes informados antes da coleta.",
    image: "/blog-capas/conferencia-entrega.webp",
    steps: ["Informe os endereços de coleta e entrega.", "Envie a quantidade de volumes, peso e dimensões.", "A equipe confirma a rota, o valor e a disponibilidade antes da retirada."],
    preparation: ["Contato de quem libera a carga", "Data e período desejados", "Mercadoria embalada e identificada", "Nota fiscal e observações de acesso"],
  },
  {
    slug: "entregas-regionais", title: "Entregas regionais", summary: "Rio Preto e cidades da região.",
    description: "Envie sua mercadoria para cidades atendidas pelas rotas da Mello. Consulte o destino e confirme a programação com a equipe.",
    image: "/images/van-mello.webp",
    steps: ["Consulte a cidade de destino.", "Informe a carga e o endereço completo do destinatário.", "Confirme a programação e acompanhe as atualizações da entrega."],
    preparation: ["Nome e telefone do destinatário", "Endereço com bairro e referência", "Horário de recebimento", "Restrições de acesso ou descarga"],
  },
  {
    slug: "distribuicao-por-polos", title: "Distribuição por polos", summary: "Destinos organizados por região.",
    description: "Consulte os polos regionais e as cidades atendidas para planejar seus envios. A equipe avalia a programação conforme os destinos e a carga.",
    image: "/images/vuc-mello.webp",
    steps: ["Consulte o polo de cada cidade de destino.", "Separe os volumes e documentos de cada entrega.", "Confirme com a equipe a programação para os seus envios."],
    preparation: ["Relação dos destinos", "Volumes identificados por destinatário", "Peso e dimensões por envio", "Contatos e horários de recebimento"],
  },
  {
    slug: "transporte-de-volumes", title: "Transporte de volumes", summary: "Caixas, peças e cargas fracionadas.",
    description: "Solicite uma avaliação para transportar seus volumes. O tipo de mercadoria, o peso e as dimensões ajudam a definir o veículo e a cotação.",
    image: "/blog-capas/preparo-carga.webp",
    steps: ["Conte e meça os volumes embalados.", "Informe o peso, a mercadoria e os cuidados necessários.", "Receba a confirmação de viabilidade e a cotação da equipe."],
    preparation: ["Quantidade de volumes", "Comprimento, largura e altura", "Peso aproximado", "Informações sobre fragilidade e documentação"],
  },
];

export const publicFleet = [
  { slug: "fiat-strada", title: "Strada com capota", summary: "Coletas leves em compartimento fechado.", image: "/images/strada-mello.webp", description: "Um utilitário compacto com capota alta fechada para coletas e entregas de volumes menores. A equipe confirma a compatibilidade da carga e a disponibilidade na rota.", uses: ["Peças e pedidos de pequeno volume", "Coletas com acesso urbano", "Envios fracionados compatíveis com o veículo"] },
  { slug: "van-de-carga", title: "Van de carga", summary: "Mais espaço para seus volumes.", image: "/images/van-mello.webp", description: "O compartimento fechado da van acomoda caixas e volumes para distribuição regional. Informe as dimensões para a equipe avaliar o espaço necessário.", uses: ["Lotes de caixas e embalagens", "Mercadorias em compartimento fechado", "Coletas e distribuição regional"] },
  { slug: "vuc-bau", title: "VUC de baú", summary: "Para cargas de maior volume.", image: "/images/vuc-mello.webp", description: "O veículo urbano de carga com baú atende envios de maior volume, conforme avaliação da equipe. Confirme as dimensões da mercadoria e as condições de carga e descarga.", uses: ["Lotes de maior volume", "Mercadorias com necessidade de baú", "Entregas com acesso e descarga previamente confirmados"] },
];

export const publicHubs = hubs.map((name) => ({
  name: name.replace("São José Do Rio Preto", "São José do Rio Preto"),
  slug: routeSlug(name),
  areas: serviceAreas.filter((area) => area.hub === name),
}));
