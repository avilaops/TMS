import Link from 'next/link';
import { ArrowUpRight, FileText } from 'lucide-react';
import { PUBLIC_POSTS } from '@/content/public-posts';

export function PostCards() {
  return <div className="public-post-grid">{PUBLIC_POSTS.map(post => <Link className="public-post-card" key={post.slug} href={`/blog/${post.slug}`}>
    <div className="public-post-art" aria-hidden="true"><span>{post.label}</span><FileText size={74} strokeWidth={1.1} /><small>{post.model}</small></div>
    <div className="public-post-copy"><span className="public-eyebrow">Universo Fiscal</span><h3>{post.title}<ArrowUpRight size={20} aria-hidden="true" /></h3><p>{post.summary}</p><span className="public-post-meta">14 nov 2026 <span>•</span> {post.readingMinutes} min de leitura</span></div>
  </Link>)}</div>;
}
