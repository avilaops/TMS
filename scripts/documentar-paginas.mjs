import fs from 'node:fs';
import path from 'node:path';

// Internal companions document routes, never export records or authenticated HTML.
const root = process.cwd();
const app = path.join(root, 'src/app');
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, item.name);
    if (item.isDirectory()) walk(name);
    else if (item.name === 'page.tsx' || item.name === 'page.mdx') files.push(name);
  }
}
walk(app);
const publicFiles = { '/': 'inicio.mdx', '/sobre': 'sobre.mdx', '/blog': 'blog.mdx', '/privacidade': 'privacidade.mdx', '/cookies': 'cookies.mdx' };
const areas = { dashboard: 'Painel interno de gestão da transportadora. Acesso depende da sessão, da empresa e das capacidades do perfil.', driver: 'Área de trabalho do motorista. Acesso restrito às atividades vinculadas ao motorista autenticado.', portal: 'Portal do cliente da transportadora. Acesso restrito ao cliente autenticado e à sua empresa.', empresa: 'Seleção ou vínculo de empresa da conta autenticada.', plataforma: 'Administração de empresas, com guarda de acesso da plataforma.', login: 'Entrada pela conta Ávila Ops. Esta rota não deve ser indexada.', rastreio: 'Consulta individual de acompanhamento. Resultados e documentos não são indexáveis.', transportadoras: 'Site de cortesia da transportadora. Somente um snapshot publicado de empresa ativa é público; rascunhos ficam no painel.' };
const inventory = [];
for (const file of files.sort()) {
  const relative = path.relative(app, file).replaceAll('\\', '/');
  const route = '/' + relative.replace(/(?:\/)?page\.(?:tsx|mdx)$/, '');
  let doc;
  if (publicFiles[route]) doc = 'src/content/public/' + publicFiles[route];
  else if (route === '/blog/[slug]') doc = 'src/content/public/o-que-e-cte.mdx';
  else {
    const segments = route.split('/').filter(Boolean);
    const title = segments.map(segment => segment.replaceAll('-', ' ')).join(' • ');
    doc = `docs/paginas${route}/pagina.mdx`;
    const content = [`# ${title}`, '', `Rota • \`${route}\``, '', '## Finalidade e acesso', '', areas[segments[0]] || 'Página do TMS.', '', '## Referência de implementação', '', `Componente • \`src/app/${relative}\`.`, '', 'Este arquivo documenta a página e seu padrão de subpáginas. Não contém dados, documentos, credenciais ou exemplos extraídos de clientes.', '', '## Indexação', '', segments[0] === 'transportadoras' ? 'Apenas páginas efetivamente publicadas são incluídas no sitemap. A exportação pública de Markdown usa o mesmo snapshot.' : 'Fora do sitemap público, com política de não indexação. Esta documentação permanece no repositório e não é servida como conteúdo público.', ''].join('\n');
    fs.mkdirSync(path.dirname(path.join(root, doc)), { recursive: true });
    fs.writeFileSync(path.join(root, doc), content);
  }
  inventory.push({ route, source: `src/app/${relative}`, mdx: doc });
}
fs.writeFileSync(path.join(root, 'docs/paginas/inventario.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(`Documentadas ${inventory.length} páginas e padrões de subpáginas.`);
