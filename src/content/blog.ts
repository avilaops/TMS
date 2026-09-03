/**
 * Conteudo do blog da Mello Transportes.
 *
 * As materias sao escritas aqui como blocos tipados, sem MDX nem dependencia
 * nova. Para publicar uma materia nova, acrescente um objeto em `posts` e o
 * resto do site se ajusta sozinho: indice, pagina, sitemap e dados
 * estruturados.
 *
 * Regra de conteudo: nada de numero de entregas, cliente ou tempo de mercado
 * sem confirmacao do comercial. Os dados operacionais citados vem de
 * src/data/serviceAreas.csv e src/data/fleet.ts.
 */

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "note"; title: string; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

export type Post = {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
  body: Block[];
  /**
   * Capa da matéria, gerada pelo fluxo do n8n na identidade da marca e
   * publicada em /blog-capas/<slug>.png. Matéria sem capa continua válida: o
   * índice e a página caem no layout tipográfico de antes.
   */
  coverImage?: string;
  coverImageAlt?: string;
};

/** Capa de uma matéria, ou a imagem padrão do site quando ela não tem. */
export function coverOf(post: Post): { url: string; alt: string } {
  return {
    url: post.coverImage ?? "/preview-whatsapp-v1.png",
    alt: post.coverImageAlt ?? `Mello Transportes: ${post.title}`,
  };
}

export const posts: Post[] = [
  {
    slug: "peso-cubado-como-calcular",
    title: "Peso cubado: por que uma carga leve pode custar como uma pesada",
    description:
      "Entenda como o volume da mercadoria entra no cálculo do frete, como chegar ao peso cubado e o que fazer para não pagar por espaço vazio.",
    excerpt:
      "Uma caixa de isopor de 4 kg pode custar o mesmo que um fardo de 80 kg. Não é erro de cotação: é o peso cubado fazendo o seu trabalho.",
    category: "Cotação",
    publishedAt: "2026-08-31",
    readingMinutes: 6,
    body: [
      {
        type: "p",
        text: "Quase toda dúvida sobre valor de frete termina no mesmo lugar. O cliente pesa a mercadoria, vê 4 kg no visor da balança e recebe uma cotação que parece alta demais para aquele peso. A explicação quase sempre é a mesma: o veículo não é limitado só pelo peso que aguenta, mas também pelo espaço que tem dentro.",
      },
      {
        type: "p",
        text: "Um baú fecha por dois motivos. Ou o eixo chegou no limite de carga, ou não cabe mais nada. Quando a carga é leve e volumosa, o segundo limite chega muito antes do primeiro. É por isso que o transporte trabalha com o conceito de **peso cubado**, também chamado de peso volumétrico ou peso taxável.",
      },
      { type: "h2", text: "Como o cálculo funciona na prática" },
      {
        type: "p",
        text: "O caminho tem três passos e nenhum deles exige planilha complicada.",
      },
      {
        type: "ol",
        items: [
          "Meça o volume em metros. Comprimento, largura e altura de cada volume, com a embalagem já fechada e o palete incluído, se houver.",
          "Multiplique os três para achar a cubagem em metros cúbicos. Uma caixa de 0,80 m por 0,60 m por 0,50 m dá 0,24 m³.",
          "Multiplique a cubagem pelo fator de cubagem da transportadora. O resultado é o peso cubado, em quilos.",
        ],
      },
      {
        type: "p",
        text: "Depois disso, a comparação é direta: vale o que for maior entre o peso real da balança e o peso cubado. Esse é o peso que entra na cotação.",
      },
      {
        type: "note",
        title: "O fator de cubagem varia",
        text: "Não existe um número único para o mercado inteiro. O fator muda conforme o modal, o tipo de operação e a transportadora, e costuma ficar entre 166 e 300 quilos por metro cúbico no rodoviário fracionado. Confirme o fator aplicado à sua operação com o nosso comercial antes de fechar contas na sua planilha.",
      },
      { type: "h2", text: "Um exemplo com números" },
      {
        type: "p",
        text: "Considere duas cargas que saem no mesmo dia, na mesma rota, e um fator hipotético de 300 quilos por metro cúbico.",
      },
      {
        type: "table",
        head: ["Carga", "Peso real", "Cubagem", "Peso cubado", "Peso taxável"],
        rows: [
          ["Caixa de peças metálicas", "80 kg", "0,06 m³", "18 kg", "80 kg"],
          ["Caixa de embalagens plásticas", "4 kg", "0,90 m³", "270 kg", "270 kg"],
        ],
      },
      {
        type: "p",
        text: "A segunda carga pesa vinte vezes menos e ocupa quinze vezes mais espaço. No fim, ela é a mais cara das duas. Nada aqui é penalidade: é o custo real de rodar com o baú cheio de ar.",
      },
      { type: "h2", text: "O que dá para fazer para pagar menos" },
      {
        type: "ul",
        items: [
          "**Reveja a embalagem.** Caixa muito maior que o produto vira metro cúbico cobrado. Reduzir 10 cm de altura em cada caixa de um lote muda a conta.",
          "**Paletize com cuidado.** Palete mal montado, com carga sobrando nas bordas ou com altura irregular, é medido pelo maior ponto.",
          "**Junte envios.** Dois pedidos pequenos para o mesmo destino, no mesmo dia, costumam sair melhor num volume só do que em dois.",
          "**Informe as medidas na hora de pedir.** Cotação feita só com o peso quase sempre muda depois da conferência, e ninguém gosta de valor que muda.",
        ],
      },
      { type: "h2", text: "Por que insistimos nas medidas" },
      {
        type: "p",
        text: "No formulário de coleta do site existe um campo de dimensões que é opcional. Ele é o campo que mais evita retrabalho. Quando as medidas chegam junto com o pedido, a cotação sai uma vez só e o valor combinado é o valor da fatura.",
      },
      {
        type: "p",
        text: "Se ficar qualquer dúvida sobre como medir a sua carga, fale com a equipe pelo WhatsApp antes de embalar. É mais barato ajustar a caixa do que ajustar o frete.",
      },
    ],
  },
  {
    slug: "prazo-24h-48h-como-funciona",
    title: "Até 24h ou até 48h: o que decide o prazo da sua entrega",
    description:
      "Como os polos regionais organizam as rotas da Mello Transportes e por que duas cidades vizinhas podem ter prazos diferentes.",
    excerpt:
      "Duas cidades a 40 km uma da outra podem ter prazos diferentes. A distância explica pouco; a rota explica quase tudo.",
    category: "Operação",
    publishedAt: "2026-08-31",
    readingMinutes: 5,
    body: [
      {
        type: "p",
        text: "A relação pública de cidades atendidas traz dois prazos: até 24h e até 48h. A pergunta que mais aparece é por que uma cidade mais distante às vezes tem prazo menor que uma cidade mais próxima.",
      },
      {
        type: "p",
        text: "A resposta está na forma como a operação é montada. O transporte regional não funciona por linha reta entre origem e destino. Funciona por rota, e rota é uma sequência planejada de paradas.",
      },
      { type: "h2", text: "O que é um polo regional" },
      {
        type: "p",
        text: "Cada cidade atendida está ligada a um polo. O polo é a referência da rota que passa por ela: define qual veículo roda, em que ordem as paradas acontecem e em quais dias aquela região é servida.",
      },
      {
        type: "p",
        text: "Uma cidade que fica no começo do trajeto de um polo tende a ser atendida no mesmo ciclo. Uma cidade no fim do trajeto, ou que depende da rota do dia seguinte para fechar, aparece como até 48h. A quilometragem entra na conta, mas a posição na rota pesa mais.",
      },
      {
        type: "note",
        title: "Onde consultar",
        text: "A consulta de cidade na página inicial devolve o prazo e o polo regional de cada localidade da relação pública. A busca ignora acentos e maiúsculas, então basta digitar o nome como vier à cabeça.",
      },
      { type: "h2", text: "O que mais mexe no prazo" },
      {
        type: "ul",
        items: [
          "**Horário do pedido.** Coleta solicitada no fim da tarde entra no ciclo do dia seguinte. Uma hora de diferença no pedido pode significar um dia inteiro na entrega.",
          "**Endereço de destino.** Zona rural, condomínio com horário restrito de recebimento e local sem ninguém para receber mudam o desenho da rota.",
          "**Janela de recebimento.** Muita empresa recebe mercadoria só até certo horário. Se a rota chega depois, a entrega fica para o próximo ciclo.",
          "**Documentação da carga.** Volume sem nota fiscal correta trava na conferência e não embarca.",
        ],
      },
      { type: "h2", text: "Prazo é compromisso, não adivinhação" },
      {
        type: "p",
        text: "Os prazos publicados são os prazos das rotas cadastradas, e servem para você planejar. Quando alguma coisa sai do previsto, o combinado é avisar, não deixar o cliente descobrir sozinho.",
      },
      {
        type: "p",
        text: "Se a sua operação tem uma janela apertada, diga isso na hora de solicitar a coleta. É bem mais fácil encaixar uma entrega na rota certa do que corrigir uma entrega já em trânsito.",
      },
    ],
  },
  {
    slug: "checklist-antes-de-solicitar-coleta",
    title: "O que ter em mãos antes de solicitar uma coleta",
    description:
      "Um checklist curto com as informações que fazem a coleta sair no mesmo dia, sem idas e vindas no WhatsApp.",
    excerpt:
      "A maior parte da demora entre o pedido e a coleta não está na estrada. Está no vaivém de mensagens para completar o que faltou.",
    category: "Operação",
    publishedAt: "2026-08-31",
    readingMinutes: 4,
    body: [
      {
        type: "p",
        text: "Um pedido de coleta completo entra direto na programação. Um pedido incompleto vira conversa, e conversa consome o tempo que faltava para o veículo passar naquele dia. Separamos abaixo o que a equipe precisa saber para colocar a sua carga na rota já no primeiro contato.",
      },
      { type: "h2", text: "Sobre quem está pedindo" },
      {
        type: "ul",
        items: [
          "Nome e empresa.",
          "Telefone com WhatsApp, que é o canal por onde o atendimento confirma tudo.",
          "E-mail, se você quiser receber os documentos por lá.",
        ],
      },
      { type: "h2", text: "Sobre a coleta" },
      {
        type: "ul",
        items: [
          "Endereço completo, com bairro e ponto de referência quando o local for difícil de achar.",
          "Data desejada e o período em que há alguém no local para entregar a mercadoria.",
          "Restrições de acesso, como horário de portaria, doca, rampa ou rua sem espaço para caminhão.",
        ],
      },
      { type: "h2", text: "Sobre a entrega" },
      {
        type: "ul",
        items: [
          "Cidade de destino, que vale conferir antes na consulta de cidades do site.",
          "Endereço ou referência clara.",
          "Nome de quem vai receber e, se possível, um telefone de contato no destino.",
          "Janela de recebimento, caso o destinatário só aceite mercadoria em determinados horários.",
        ],
      },
      { type: "h2", text: "Sobre a carga" },
      {
        type: "ul",
        items: [
          "**Quantidade de volumes.** Três caixas amarradas continuam sendo três volumes na conferência.",
          "**Peso aproximado**, somando tudo.",
          "**Dimensões de cada volume.** Esse é o dado que mais evita cotação refeita, porque entra no cálculo do peso cubado.",
          "**Tipo de mercadoria**, principalmente se for frágil, líquida, perecível ou de valor alto.",
          "**Nota fiscal**, informando se acompanha a carga e qual é a chave da NF-e.",
          "**Necessidade de ajudante**, quando a carga é pesada ou o local não tem estrutura para carregar.",
        ],
      },
      {
        type: "note",
        title: "O formulário já pergunta tudo isso",
        text: "A central de coletas do site organiza esses campos em etapas e monta a mensagem pronta para o WhatsApp, com um protocolo local para você guardar. O rascunho fica salvo no seu navegador, então dá para começar agora e terminar depois.",
      },
      { type: "h2", text: "Um detalhe que economiza discussão" },
      {
        type: "p",
        text: "Vale fotografar a carga embalada antes de despachar, principalmente em mercadoria frágil ou de valor alto. A foto no momento da coleta e o comprovante no momento da entrega fecham o ciclo e resolvem em minutos qualquer dúvida sobre avaria.",
      },
    ],
  },
  {
    slug: "escolher-veiculo-certo-para-a-carga",
    title: "Utilitário, van ou VUC: qual veículo a sua carga pede",
    description:
      "As diferenças práticas entre os veículos usados nas rotas regionais e como o tipo de carga e o local de entrega definem a escolha.",
    excerpt:
      "Escolher o veículo grande demais custa dinheiro. Escolher o pequeno demais custa uma segunda viagem.",
    category: "Frota",
    publishedAt: "2026-08-31",
    readingMinutes: 5,
    body: [
      {
        type: "p",
        text: "Toda coleta passa por uma decisão que o cliente raramente vê: qual veículo atende aquela carga naquele endereço. A escolha muda o custo, muda o prazo e às vezes muda a viabilidade da entrega.",
      },
      { type: "h2", text: "Os três perfis de veículo das rotas" },
      { type: "h3", text: "Utilitário leve" },
      {
        type: "p",
        text: "É o veículo das coletas ágeis e dos volumes pequenos. Entra bem em rua estreita, centro comercial e endereço sem doca, e é o que costuma resolver documentos, amostras, peças e pedidos fracionados de pouco volume.",
      },
      { type: "h3", text: "Van de carga" },
      {
        type: "p",
        text: "Furgão de capacidade média, com carga fechada e protegida da chuva. É o meio termo da distribuição regional: leva bem mais que o utilitário, mantém a agilidade urbana e serve para lotes de caixas, embalagens e mercadoria que não pode pegar tempo.",
      },
      { type: "h3", text: "Caminhão VUC de até 3,7 m" },
      {
        type: "p",
        text: "O veículo urbano de carga foi desenhado justamente para circular onde caminhão grande não entra. É a escolha para palete, carga volumosa e lote maior, mantendo acesso a áreas com restrição de circulação.",
      },
      { type: "h2", text: "Como decidir" },
      {
        type: "table",
        head: ["Se a sua carga", "O caminho costuma ser"],
        rows: [
          ["Cabe em poucas caixas e precisa sair rápido", "Utilitário leve"],
          ["Tem várias caixas e não pode molhar", "Van de carga"],
          ["Está paletizada ou é volumosa", "Caminhão VUC"],
          ["Vai para local com restrição de acesso", "Confirmar com a equipe antes"],
        ],
      },
      {
        type: "note",
        title: "O veículo segue a rota, não só a carga",
        text: "Cada polo regional tem um veículo cadastrado para a rota. Isso significa que a definição final considera a carga, o endereço e a programação do dia. Por isso a confirmação de veículo é sempre feita pela equipe.",
      },
      { type: "h2", text: "O que informar para acertar de primeira" },
      {
        type: "ul",
        items: [
          "Se a carga está paletizada e qual a altura do palete montado.",
          "Se existe empilhadeira, doca ou rampa na origem e no destino.",
          "Se há restrição de horário ou de tamanho de veículo na rua do destino.",
          "Se a mercadoria exige cuidado especial, como carga frágil ou que não pode tombar.",
        ],
      },
      {
        type: "p",
        text: "Esses quatro pontos resolvem a maior parte das surpresas de última hora. Na dúvida, mande uma foto da carga pelo WhatsApp: em geral a equipe responde a escolha do veículo olhando a imagem.",
      },
    ],
  },
  {
    slug: "documentos-no-transporte-de-carga",
    title: "Nota fiscal, CT-e e comprovante: o papel de cada documento",
    description:
      "O que cada documento do transporte representa, quem emite, e por que o comprovante de entrega é o que fecha a operação.",
    excerpt:
      "Três documentos diferentes, três funções diferentes, e uma confusão que só aparece quando alguma coisa dá errado.",
    category: "Documentos",
    publishedAt: "2026-08-31",
    readingMinutes: 5,
    body: [
      {
        type: "p",
        text: "Documento de transporte é assunto que só vira urgente quando falta. Vale entender antes o que cada um faz, porque eles não se substituem.",
      },
      { type: "h2", text: "Nota fiscal eletrônica, a NF-e" },
      {
        type: "p",
        text: "É emitida por quem está vendendo ou remetendo a mercadoria, nunca pela transportadora. Ela descreve o que está sendo transportado, o valor, o remetente e o destinatário. A chave de acesso da NF-e, aquela sequência longa de números, é o que amarra a carga ao documento fiscal dentro do sistema.",
      },
      {
        type: "p",
        text: "Sem NF-e correta, a mercadoria não embarca. Não é preciosismo da transportadora: é a fiscalização na estrada que exige.",
      },
      { type: "h2", text: "Conhecimento de transporte eletrônico, o CT-e" },
      {
        type: "p",
        text: "Esse é o documento da prestação do serviço de transporte, e quem emite é a transportadora. Ele registra o trecho contratado, quem paga o frete, qual carga está sendo movida e qual NF-e está vinculada.",
      },
      {
        type: "p",
        text: "Na prática, a NF-e responde o que está indo e o CT-e responde quem está levando, de onde para onde e por quanto.",
      },
      { type: "h2", text: "Comprovante de entrega" },
      {
        type: "p",
        text: "É o documento que fecha o ciclo. Registra data, hora, quem recebeu, o nome e o documento de identificação do recebedor, e cada vez mais traz também assinatura digital, fotos e localização.",
      },
      {
        type: "p",
        text: "É o comprovante que sustenta a cobrança, encerra a responsabilidade sobre a carga e resolve qualquer discussão posterior sobre o que chegou e em que estado chegou.",
      },
      {
        type: "table",
        head: ["Documento", "Quem emite", "Para que serve"],
        rows: [
          ["NF-e", "Remetente da mercadoria", "Descreve a mercadoria e ampara a circulação"],
          ["CT-e", "Transportadora", "Formaliza o serviço de transporte contratado"],
          ["Comprovante de entrega", "Transportadora, no destino", "Prova que a carga chegou e a quem foi entregue"],
        ],
      },
      {
        type: "note",
        title: "Guarde os três",
        text: "Em caso de avaria, extravio ou divergência de quantidade, a análise começa comparando o que a NF-e declarou, o que o CT-e transportou e o que o comprovante registrou na chegada. Faltando uma peça, a apuração fica mais lenta para todo mundo.",
      },
      { type: "h2", text: "O que fazer no dia a dia" },
      {
        type: "ul",
        items: [
          "Envie a chave da NF-e junto com o pedido de coleta, e não depois.",
          "Confira se a quantidade de volumes da nota bate com o que vai ser despachado de verdade.",
          "Peça o comprovante de entrega sempre, mesmo quando a entrega correu bem.",
          "Arquive os documentos por cliente e por período, para não depender de busca no WhatsApp meses depois.",
        ],
      },
      {
        type: "p",
        text: "Se restar dúvida sobre a documentação de alguma operação específica, fale com o comercial antes de despachar. Carga parada em conferência por documento errado é o tipo de atraso que dá para evitar por completo.",
      },
    ],
  },
];

export function getPost(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}

export const sortedPosts: Post[] = [...posts].sort((a, b) =>
  b.publishedAt.localeCompare(a.publishedAt),
);
