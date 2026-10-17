"use client";
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { PortalShell } from './portal-shell';
import { useAdminContext } from './admin-context';
import { portalApi } from '@/lib/api';
type Article = {
    id: string;
    revision: number;
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    cover_url: string;
    author_name: string;
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    is_demo: boolean;
};
type Settings = {
    waitlist_enabled: boolean;
    ios_url: string;
    play_store_url: string;
};
type Entry = {
    id: string;
    email: string;
    full_name: string;
    university_name: string;
    platform: string;
    created_at: string;
};
export function WebsiteWorkspace() {
    const { can, access } = useAdminContext(), [articles, setArticles] = useState<Article[]>([]), [settings, setSettings] = useState<Settings | null>(null), [entries, setEntries] = useState<Entry[]>([]), [total, setTotal] = useState(0), [draft, setDraft] = useState<Article | null>(null), [tab, setTab] = useState<'articles' | 'waitlist' | 'settings'>('articles'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [version, setVersion] = useState(0), [coverFile, setCoverFile] = useState<File | null>(null), [coverPreview, setCoverPreview] = useState(''), [uploadingCover, setUploadingCover] = useState(false);
    const write = can('content.manage') && Boolean(access?.allUniversities);
    useEffect(() => { let active = true; if (!can('content.view') || !access?.allUniversities)
        return; void Promise.all([portalApi<{
            articles: Article[];
        }>('/v1/website/admin/articles'), portalApi<Settings>('/v1/website/admin/settings'), portalApi<{
            entries: Entry[];
            total: number;
        }>('/v1/website/admin/waitlist')]).then(([a, s, w]) => { if (active) {
        setArticles(a.articles);
        setSettings(s);
        setEntries(w.entries);
        setTotal(w.total);
        setError('');
    } }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [can, access?.allUniversities, version]);
    useEffect(() => () => { if (coverPreview)
        URL.revokeObjectURL(coverPreview); }, [coverPreview]);
    function editArticle(article: Article | null) { if (busy)
        return; setDraft(article); setCoverFile(null); setCoverPreview(''); setError(''); setNotice(''); }
    function chooseCover(file: File | undefined) {
        if (!file)
            return;
        setError('');
        setNotice('');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setError('Choose a JPG, PNG or WebP cover image.');
            return;
        }
        if (file.size < 1 || file.size > 4 * 1024 * 1024) {
            setError('Choose a cover image up to 4 MB.');
            return;
        }
        setCoverFile(file);
        setCoverPreview(URL.createObjectURL(file));
    }
    async function saveArticle(e: React.FormEvent) {
        e.preventDefault();
        if (!draft || busy || !write)
            return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setError('You are offline. Reconnect before saving your article.');
            return;
        }
        setBusy(true);
        setNotice('');
        setError('');
        try {
            let coverUrl = draft.cover_url;
            if (coverFile) {
                setUploadingCover(true);
                const media = await portalApi<{
                    url: string;
                    kind: string;
                    private: boolean;
                }>(`/v1/media?kind=post&name=${encodeURIComponent(coverFile.name)}`, { method: 'POST', body: coverFile, headers: { 'Content-Type': coverFile.type } });
                if (!media.url || media.kind !== 'post' || media.private || !media.url.startsWith('https://'))
                    throw new Error('The cover image could not be uploaded. Please try again.');
                coverUrl = media.url;
                // Keep the durable upload after a failed article save so retry reuses it.
                setDraft(current => current?.id === draft.id ? { ...current, cover_url: coverUrl } : current);
                setCoverFile(null);
                setCoverPreview('');
                setUploadingCover(false);
            }
            const r = await portalApi<{
                article: {
                    id: string;
                    revision: number;
                };
            }>('/v1/website/admin/articles', { method: 'PUT', body: JSON.stringify({ id: draft.id, revision: draft.revision, slug: draft.slug, title: draft.title, excerpt: draft.excerpt, body: draft.body, coverUrl, authorName: draft.author_name, status: draft.status }) });
            setDraft({ ...draft, ...r.article, cover_url: coverUrl, is_demo: false });
            setVersion(v => v + 1);
            setNotice(draft.status === 'PUBLISHED' ? 'Article published on the website.' : 'Article saved.');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Article could not be saved.');
        }
        finally {
            setUploadingCover(false);
            setBusy(false);
        }
    }
    async function saveSettings(e: React.FormEvent) { e.preventDefault(); if (!settings || busy || !write)
        return; setBusy(true); setNotice(''); setError(''); try {
        await portalApi('/v1/website/admin/settings', { method: 'PUT', body: JSON.stringify({ waitlistEnabled: settings.waitlist_enabled, iosUrl: settings.ios_url, playStoreUrl: settings.play_store_url }) });
        setNotice('Website settings saved.');
        setVersion(v => v + 1);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save settings.');
    }
    finally {
        setBusy(false);
    } }
    const field = (key: keyof Article, value: string) => setDraft(current => current ? { ...current, [key]: value } : null);
    return <PortalShell active="admin" eyebrow="Public website" title="Website & journal" description="Publish articles, manage app links and open or close the waitlist."><div className="workspace-toolbar">{(['articles', 'waitlist', 'settings'] as const).map(t => <button key={t} className={'button ' + (tab === t ? 'button--primary' : 'button--secondary')} disabled={busy} onClick={() => setTab(t)}>{t === 'articles' ? 'Journal' : t === 'waitlist' ? `Waitlist · ${total}` : 'Website settings'}</button>)}</div>{notice && <p className="workspace-notice" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}{!can('content.view') || !access?.allUniversities ? <p className="state-panel">The public website requires global content access.</p> : tab === 'articles' ? <><div className="form-actions">{write && <button className="button button--primary" disabled={busy} onClick={() => editArticle({ id: crypto.randomUUID(), revision: 1, slug: '', title: '', excerpt: '', body: '', cover_url: '', author_name: 'KampusOne team', status: 'DRAFT', is_demo: false })}>Write an article</button>}<a className="button button--secondary" href="https://kampusone.app/blog" target="_blank" rel="noopener noreferrer">Open journal ↗</a></div>{draft && <form className="form-stack panel" aria-busy={busy} onSubmit={e => void saveArticle(e)}><fieldset className="form-stack" disabled={busy || !write} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><h2>{draft.title || 'New article'}</h2><label>Title<input required minLength={3} maxLength={180} value={draft.title} onChange={e => field('title', e.target.value)}/></label><label>URL name<input required pattern="[a-z0-9][a-z0-9-]{1,119}" placeholder="my-campus-story" value={draft.slug} onChange={e => field('slug', e.target.value)}/></label><label>Short introduction<textarea maxLength={600} value={draft.excerpt} onChange={e => field('excerpt', e.target.value)}/></label><label>Story<textarea required minLength={10} maxLength={80000} rows={14} value={draft.body} onChange={e => field('body', e.target.value)}/></label><p className="field-help">Leave a blank line between paragraphs.</p><label>Cover image <span className="field-help">optional</span><input key={draft.id} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="cover-image-help" onChange={e => { chooseCover(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}/></label><p id="cover-image-help" className="field-help">Choose an image from your device. JPG, PNG or WebP, up to 4 MB.</p>{(coverPreview || draft.cover_url) && <div className="form-stack"><Image src={coverPreview || draft.cover_url} alt="Blog cover preview" width={720} height={405} unoptimized style={{ width: '100%', maxWidth: 720, height: 'auto', maxHeight: 360, objectFit: 'contain', borderRadius: 12 }}/>{coverFile && <p className="field-help">{coverFile.name} · Ready to upload when you save.</p>}<div className="form-actions"><button type="button" className="button button--secondary" onClick={() => { setCoverFile(null); setCoverPreview(''); field('cover_url', ''); }}>Remove cover image</button></div></div>}<label>Author name<input required minLength={2} maxLength={120} value={draft.author_name} onChange={e => field('author_name', e.target.value)}/></label><label>Status<select value={draft.status} onChange={e => field('status', e.target.value)}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label></fieldset><div className="form-actions"><button disabled={!write || busy} className="button button--primary">{uploadingCover ? 'Uploading image…' : busy ? 'Saving…' : 'Save article'}</button><button type="button" className="button button--secondary" disabled={busy} onClick={() => editArticle(null)}>Close editor</button></div></form>}<div className="table-scroll"><table className="operational-table"><thead><tr><th>Article</th><th>Status</th><th>Author</th><th /></tr></thead><tbody>{articles.map(a => <tr key={a.id}><td>{a.title}{a.is_demo && <small className="catalogue-ids">Original website sample · editable</small>}</td><td>{a.status}</td><td>{a.author_name}</td><td><button disabled={busy} onClick={() => editArticle(a)}>Edit</button>{a.status === 'PUBLISHED' && <a href={'https://kampusone.app/blog/' + a.slug} target="_blank" rel="noopener noreferrer">View ↗</a>}</td></tr>)}</tbody></table></div></> : tab === 'waitlist' ? <><p>{total} people have joined. Showing the latest {entries.length} entries.</p><div className="table-scroll"><table className="operational-table"><thead><tr><th>Name</th><th>Email</th><th>University</th><th>Device</th><th>Joined</th></tr></thead><tbody>{entries.map(e => <tr key={e.id}><td>{e.full_name}</td><td>{e.email}</td><td>{e.university_name || 'Not provided'}</td><td>{e.platform}</td><td>{new Date(e.created_at).toLocaleString()}</td></tr>)}</tbody></table>{!entries.length && <p className="table-empty">No waitlist entries yet.</p>}</div></> : settings ? <form className="form-stack panel" onSubmit={e => void saveSettings(e)}><label className="consent-row"><input type="checkbox" checked={settings.waitlist_enabled} onChange={e => setSettings({ ...settings, waitlist_enabled: e.target.checked })}/>Open the public waitlist</label><p className="field-help">When closed, /waitlist returns 404 and the signup form stops accepting entries.</p><label>iOS App Store or TestFlight URL<input type="url" value={settings.ios_url} onChange={e => setSettings({ ...settings, ios_url: e.target.value })}/></label><label>Google Play URL<input type="url" value={settings.play_store_url} onChange={e => setSettings({ ...settings, play_store_url: e.target.value })}/></label><p className="field-help">Android APK downloads use the latest verified build automatically. Store links are optional.</p><button className="button button--primary" disabled={!write || busy}>{busy ? 'Saving…' : 'Save website settings'}</button></form> : <p className="state-panel">Loading website settings…</p>}</PortalShell>;
}
