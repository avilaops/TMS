// Fluxo do n8n que recebe os avisos do TMS (README, "Integração") e manda um
// resumo por WhatsApp pelo serviço whatsapp.avilaops.com. É o código do fluxo
// "TMS - Avisos da Mello" (n8n.avilaops.com), no formato do SDK de workflows do
// n8n. O caminho do webhook é sorteado por empresa e não fica neste arquivo.
//
// O serviço de WhatsApp só envia para destinos fixos: "eu" é o número do
// responsável. Mensagem direta para o cliente da transportadora não passa por aqui.
import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

const receber = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Aviso do TMS',
    parameters: { httpMethod: 'POST', path: 'tms-<empresa>-<código sorteado>', responseMode: 'onReceived', options: {} },
  },
});

const montar = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Montar mensagem',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Transforma o aviso do TMS num texto curto de WhatsApp. Tipo sem texto definido não gera mensagem.
const STATUS = {
  PENDING: 'Coleta pedida pelo portal, aguardando confirmação',
  CONFIRMED: 'Coleta confirmada',
  COLLECTED: 'Carga coletada',
  ROUTE: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Coleta cancelada',
  REJECTED: 'Coleta recusada',
};
const TIPO_DO_CHAMADO = { DELAY: 'Atraso', DAMAGE: 'Avaria', LOSS: 'Extravio', BILLING: 'Cobrança', REDELIVERY: 'Reentrega', OTHER: 'Outro' };
const STATUS_DO_CHAMADO = { OPEN: 'Aberto', ANALYSIS: 'Em análise', IN_PROGRESS: 'Em tratamento', RESOLVED: 'Resolvido', CLOSED: 'Encerrado' };
const reais = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'a cotar');
const data = (d) => (d ? d.split('-').reverse().join('/') : 'sem vencimento');
const saida = [];
for (const item of \$input.all()) {
  const aviso = item.json.body ?? {};
  const d = aviso.dados ?? {};
  const linhas = [];
  if (aviso.tipo === 'coleta.status' && d.coleta) {
    const c = d.coleta;
    linhas.push('*' + (STATUS[d.para] ?? d.para) + '*');
    linhas.push((c.cliente?.nome ?? 'Cliente') + ' · ' + c.origem + ' → ' + c.destino);
    linhas.push(c.volumes + ' vol · ' + c.peso + ' kg · frete ' + reais(c.frete));
    if (c.destinatario) linhas.push('Destinatário: ' + c.destinatario);
    if (c.motorista?.nome) linhas.push('Motorista: ' + c.motorista.nome);
    if (c.rastreio?.link) linhas.push('Rastreio: ' + c.rastreio.link);
  } else if (typeof aviso.tipo === 'string' && aviso.tipo.startsWith('fatura.') && d.fatura) {
    const f = d.fatura;
    const titulo = { 'fatura.emitida': 'Fatura emitida', 'fatura.paga': 'Fatura paga', 'fatura.reaberta': 'Fatura reaberta', 'fatura.cancelada': 'Fatura cancelada' }[aviso.tipo];
    linhas.push('*' + titulo + ' nº ' + f.numero + '*');
    linhas.push((f.cliente?.nome ?? 'Cliente') + ' · ' + reais(f.total) + ' · vence ' + data(f.vencimento));
    linhas.push(f.cargas + (f.cargas === 1 ? ' carga' : ' cargas'));
    // Só na emissão, e só quando a empresa tem chave Pix: o código vai numa linha própria, para copiar inteiro.
    if (aviso.tipo === 'fatura.emitida' && f.pixCopiaECola) linhas.push('Pix copia e cola:\\n' + f.pixCopiaECola);
  } else if (aviso.tipo === 'cobranca.vencida' && d.titulo && d.titulo.emAberto) {
    const t = d.titulo;
    linhas.push('*Título vencido*');
    linhas.push((t.cliente?.nome ?? t.pagador ?? 'Sem cliente informado') + ' · ' + reais(t.valor));
    linhas.push('Venceu em ' + data(t.vencimento) + ' (' + t.diasDeAtraso + (t.diasDeAtraso === 1 ? ' dia' : ' dias') + ' de atraso)');
    linhas.push(t.fatura ? 'Fatura nº ' + t.fatura.numero : t.descricao);
    if (t.cliente?.telefone) linhas.push('Contato: ' + (t.cliente.contato ? t.cliente.contato + ' · ' : '') + t.cliente.telefone);
    if (t.pixCopiaECola) linhas.push('Pix copia e cola:\\n' + t.pixCopiaECola);
  } else if ((aviso.tipo === 'ocorrencia.aberta' || aviso.tipo === 'ocorrencia.status') && d.ocorrencia) {
    const o = d.ocorrencia;
    const status = STATUS_DO_CHAMADO[o.status] ?? o.status;
    linhas.push('*Chamado nº ' + o.numero + (aviso.tipo === 'ocorrencia.aberta' ? ' aberto' : ': ' + status) + '*');
    linhas.push((TIPO_DO_CHAMADO[o.tipo] ?? o.tipo) + ' · ' + o.titulo + (o.prioridade === 'HIGH' ? ' · prioridade alta' : ''));
    linhas.push((o.cliente?.nome ?? 'Sem cliente') + (o.abertaPor === 'CLIENT' ? ' · aberto pelo portal' : ''));
    if (o.carga) linhas.push('Carga ' + (o.carga.rastreio?.codigo ?? 'sem código') + ' · ' + o.carga.destinatario + ' · ' + o.carga.destino);
    if (o.painel) linhas.push('Abrir: ' + o.painel);
  } else if (aviso.tipo === 'teste') {
    linhas.push('*Teste do TMS recebido*');
    linhas.push('A integração com o n8n está funcionando.');
  }
  if (linhas.length === 0) continue;
  saida.push({ json: { texto: 'TMS · ' + (aviso.empresa?.nome ?? '') + '\\n' + linhas.join('\\n'), tipo: aviso.tipo, entrega: aviso.id } });
}
return saida;`,
    },
  },
});

const enviar = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Enviar no WhatsApp',
    parameters: {
      method: 'POST',
      url: 'http://172.31.0.15:8080/enviar',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ destino: "eu", tipo: "texto", texto: $json.texto }) }}'),
      options: {},
    },
    credentials: { httpHeaderAuth: { id: 'O81eaaQfALZxflt8', name: 'WhatsApp Avila Ops (apikey)' } },
  },
});

export default workflow('tms-avisos-mello', 'TMS - Avisos da Mello').add(receber).to(montar).to(enviar);
