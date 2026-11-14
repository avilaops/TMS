'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { pode } from '@/lib/permissoes';
import { carrierPath, emptySiteDraft, type SiteDraft } from '@/lib/carrier-site';
import './site-editor.css';

type State = { draft: SiteDraft; revision: number; slug: string; publishedAt: string | null };

export default function SiteEditor() {
  const { data: session } = useSession();
  const edit = pode(session?.user?.role, 'site');
  const publish = pode(session?.user?.role, 'sitePublicar');
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<SiteDraft>(emptySiteDraft(''));
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = Boolean(state && JSON.stringify(draft) !== JSON.stringify(state.draft));

  async function load() {
    try {
      const response = await fetch('/api/site', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setState(result); setDraft(result.draft); setConflict(false); setFailed(false); setMessage('');
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Não foi possível carregar o site.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/site', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setState(result); setDraft(result.draft); setBusy(false);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setFailed(true); setMessage(error instanceof Error ? error.message : 'Não foi possível carregar o site.'); setBusy(false);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  async function mutate(action: 'save' | 'publish' | 'unpublish') {
    if (!state) return;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      let current = state;
      if (action !== 'unpublish') {
        const saved = await fetch('/api/site', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, draft }) });
        const value = await saved.json();
        if (!saved.ok) { setConflict(saved.status === 409); throw new Error(value.error); }
        current = value; setState(value); setDraft(value.draft);
      }
      if (action !== 'save') {
        const response = await fetch('/api/site/publicacao', { method: action === 'publish' ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: current.revision }) });
        const value = await response.json();
        if (!response.ok) { setConflict(response.status === 409); throw new Error(value.error); }
        setState(value);
        if (action !== 'unpublish') setDraft(value.draft);
      }
      setMessage(action === 'save' ? 'Rascunho salvo. O site público não foi alterado.' : action === 'publish' ? 'Site publicado. Seu conteúdo está disponível no endereço abaixo.' : 'Site retirado do ar. Seu rascunho foi preservado.');
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }

  function change<K extends keyof SiteDraft>(key: K, value: SiteDraft[K]) { setDraft(previous => ({ ...previous, [key]: value })); }
  async function logo(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) { setFailed(true); setMessage('Envie PNG, JPEG ou WebP com até 5 MB.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      change('logo', canvas.toDataURL('image/png'));
    } catch { setFailed(true); setMessage('Não foi possível ler essa imagem.'); }
  }

  return <main className="carrier-editor">
    <header><span className="carrier-editor-badge">INCLUÍDO NO TMS • CORTESIA</span><h1>O site da sua transportadora</h1><p>Apresente sua empresa, seus serviços e suas novidades. Edite com calma e publique quando estiver pronto.</p></header>
    {message && <div className={`carrier-editor-message ${failed ? 'error' : ''}`} role={failed ? 'alert' : 'status'}>{message}</div>}
    {!state ? <button onClick={() => void load()} disabled={busy}>{busy ? 'Carregando…' : 'Tentar novamente'}</button> : <>
      <section className="carrier-editor-status"><div><strong>{state.publishedAt ? 'Publicado' : 'Ainda não publicado'}</strong><span>{dirty ? 'Você tem alterações não salvas.' : 'Rascunho atualizado.'} • Revisão {state.revision}</span><code>https://tms.avilaops.com{carrierPath(state.slug)}</code></div>{state.publishedAt && <a href={carrierPath(state.slug)} target="_blank" rel="noopener noreferrer">Ver site publicado ↗</a>}</section>
      <p className="carrier-editor-note">Sem cobrança adicional pelo módulo. O endereço incluído é o mostrado acima. Um domínio próprio depende de configuração específica. Apenas o administrador pode publicar; dados operacionais nunca são publicados automaticamente.</p>
      {conflict && <button onClick={() => void load()}>Descartar edição local e recarregar a versão salva</button>}
      <fieldset disabled={!edit || busy || conflict} className="carrier-editor-fields">
        <legend>Identidade e apresentação</legend>
        <label>Nome público<input value={draft.name} maxLength={80} onChange={event => change('name', event.target.value)} /></label>
        <label>Chamada principal<input value={draft.headline} maxLength={140} placeholder="O que sua empresa entrega ao cliente?" onChange={event => change('headline', event.target.value)} /></label>
        <label>Descrição para buscadores<textarea value={draft.description} maxLength={300} rows={2} onChange={event => change('description', event.target.value)} /></label>
        <label>Sobre a empresa<textarea value={draft.about} maxLength={8000} rows={6} onChange={event => change('about', event.target.value)} /></label>
        <div className="carrier-editor-two"><label>Cor da marca<input type="color" value={draft.accent} onChange={event => change('accent', event.target.value)} /></label><label>Logo e favicon<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void logo(event.target.files?.[0])} /></label></div>
        {draft.logo && <div className="carrier-editor-logo"><Image src={draft.logo} unoptimized width={64} height={64} alt="Logo selecionado" /><button onClick={() => change('logo', null)}>Remover logo</button></div>}
        <label>Serviços • um por linha<textarea value={draft.services.join('\n')} rows={5} onChange={event => change('services', event.target.value.split('\n').slice(0, 12))} onBlur={() => change('services', draft.services.map(value => value.trim()).filter(Boolean))} /></label>
        <label>Regiões atendidas • uma por linha<textarea value={draft.regions.join('\n')} rows={3} onChange={event => change('regions', event.target.value.split('\n').slice(0, 20))} onBlur={() => change('regions', draft.regions.map(value => value.trim()).filter(Boolean))} /></label>
        <div className="carrier-editor-two"><label>E-mail público<input type="email" value={draft.email} maxLength={160} onChange={event => change('email', event.target.value)} /></label><label>Telefone público<input type="tel" value={draft.phone} maxLength={24} onChange={event => change('phone', event.target.value)} /></label></div>
        <label>WhatsApp • país, DDD e número<input inputMode="numeric" placeholder="5511999999999" value={draft.whatsapp} maxLength={15} onChange={event => change('whatsapp', event.target.value.replace(/\D/g, ''))} /></label>
        <label>Endereço público • opcional<input value={draft.address} maxLength={300} onChange={event => change('address', event.target.value)} /></label>
      </fieldset>
      <section className="carrier-editor-posts"><h2>Blog da transportadora</h2><p>Texto simples, sem códigos. Marcar um artigo o inclui na próxima publicação do site.</p>
        {draft.posts.map((post, index) => <fieldset key={index} disabled={!edit || busy || conflict}><legend>Artigo {index + 1}</legend>
          {(['title', 'slug', 'summary', 'body'] as const).map(key => <label key={key}>{({ title: 'Título', slug: 'Endereço • letras minúsculas, números e hífen', summary: 'Resumo', body: 'Texto' })[key]}{key === 'body' || key === 'summary' ? <textarea rows={key === 'body' ? 7 : 2} maxLength={key === 'body' ? 20000 : 300} value={post[key]} onChange={event => change('posts', draft.posts.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value))} /> : <input value={post[key]} maxLength={key === 'slug' ? 80 : 140} onChange={event => change('posts', draft.posts.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value))} />}</label>)}
          <label className="carrier-editor-check"><input type="checkbox" checked={post.published} onChange={event => change('posts', draft.posts.map((value, i) => i === index ? { ...value, published: event.target.checked } : value))} />Incluir na próxima publicação</label>
          <button onClick={() => change('posts', draft.posts.filter((_, i) => i !== index))}>Remover artigo do rascunho</button>
        </fieldset>)}
        {edit && <button disabled={busy || conflict || draft.posts.length >= 12} onClick={() => change('posts', [...draft.posts, { slug: `artigo-${draft.posts.length + 1}`, title: 'Novo artigo', summary: '', body: '', published: false }])}>Adicionar artigo</button>}
      </section>
      <details className="carrier-editor-preview"><summary>Prévia do rascunho • somente nesta tela</summary><div style={{ borderTop: `6px solid ${draft.accent}` }}><small>{draft.name}</small><h2>{draft.headline || 'Sua chamada principal'}</h2><p>{draft.description}</p><h3>Sobre</h3><p style={{ whiteSpace: 'pre-line' }}>{draft.about}</p><h3>Serviços</h3><ul>{draft.services.map((service, i) => <li key={i}>{service}</li>)}</ul>{draft.posts.filter(post => post.published).map(post => <article key={post.slug}><h3>{post.title}</h3><p>{post.summary}</p><p style={{ whiteSpace: 'pre-line' }}>{post.body}</p></article>)}</div></details>
      <div className="carrier-editor-actions">{edit && <button disabled={busy || conflict} onClick={() => void mutate('save')}>Salvar rascunho</button>}{publish && <><button disabled={busy || conflict} onClick={() => void mutate('publish')}>Salvar e publicar site</button>{state.publishedAt && <button disabled={busy || conflict} onClick={() => void mutate('unpublish')}>Retirar site do ar</button>}</>}{busy && <span role="status">Processando…</span>}</div>
    </>}
  </main>;
}
