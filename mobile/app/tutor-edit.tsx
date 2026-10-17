import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/auth/auth-context';
import { useAppearance } from '@/src/lib/appearance';
import { api } from '@/src/lib/api';
import { getDeviceCacheRevision } from '@/src/lib/device-cache';
import { cacheScopeForUser } from '@/src/lib/request-policy';
import { pickAndUpload } from '@/src/lib/uploads';
import { useOwnedDraftRestore } from '@/src/lib/use-owned-draft-restore';
import { useOwnedDraftSave } from '@/src/lib/use-owned-draft-save';
import { restoreTutorEditDraft, tutorEditForm, tutorEditMatches, tutorEditPayload, type TutorEditForm, type TutorListing } from '@/src/lib/tutor-listing-editor';
import { ToolButton, ToolField, ToolPage } from '@/src/components/toolkit';
import { ChoiceField } from '@/src/components/choice-field';
import { DraftRecovery } from '@/src/components/draft-recovery';
import { MediaImage } from '@/src/components/media-image';
import { RetryIconButton } from '@/src/components/retry-icon-button';
import { ScreenSkeleton } from '@/src/components/skeleton';
import { useToast } from '@/src/components/toast';

export default function TutorEdit() {
  const { user } = useAuth(), { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  return <TutorEditScreen key={`${user ? cacheScopeForUser(user) : 'signed-out'}:${kind}:${id}`} />;
}
function TutorEditScreen() {
  const { user } = useAuth(), { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  const material = kind === 'resource', { theme } = useAppearance(), toast = useToast();
  const [row, setRow] = useState<TutorListing | null>(null), [form, setForm] = useState<TutorEditForm | null>(null);
  const [revision, setRevision] = useState(''), [loading, setLoading] = useState(true), [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false), [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const draft = useRef<ReturnType<typeof restoreTutorEditDraft> | null>(null), lock = useRef(false), photoLock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const draftKey = `listing-draft.${user ? cacheScopeForUser(user) : 'anonymous'}.tutor.edit.${kind}.${id}`;
  const restored = useOwnedDraftRestore<unknown>(draftKey, value => {
    if (value !== null) { draft.current = restoreTutorEditDraft(value); setForm(draft.current.form); setRevision(draft.current.revision); }
  }, Boolean(user));
  const saved = useOwnedDraftSave(draftKey, { form, revision }, restored.ready && ready && !busy);

  useEffect(() => {
    if (!restored.ready || !user) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setReady(false); setError('');
    void api<{ resources: TutorListing[]; listings: TutorListing[] }>('/v1/agents/tutorials', { cache: 'reload', signal: controller.signal }).then(result => {
      if (!active) return;
      const current = (material ? result.resources : result.listings)?.find(item => item.id === id && item.status !== 'ARCHIVED');
      if (!current?.revision) throw new Error('This listing is no longer available to edit.');
      if (!(material ? ['DRAFT', 'REJECTED', 'PUBLISHED'] : ['DRAFT', 'REJECTED', 'PAUSED', 'PUBLISHED']).includes(current.status))
        throw new Error('This listing is under review. You can edit it after the review is complete.');
      setRow(current);
      const local = draft.current;
      let alreadySaved = false;
      if (local) { try { alreadySaved = tutorEditMatches(current, tutorEditPayload(current, local.form, local.revision)); } catch { /* Keep incomplete edits. */ } }
      const changed = Boolean(local && local.revision !== current.revision && !alreadySaved);
      if (!local || alreadySaved) { setForm(tutorEditForm(current)); setRevision(current.revision); }
      setConflict(changed);
      if (changed) setError('This listing changed after your saved edit. Reload its latest details before saving.');
      setReady(true);
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Listing details could not load.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [restored.ready, id, material, retry]);

  function change(key: keyof TutorEditForm, value: string) { setForm(current => current ? { ...current, [key]: value } : current); }
  async function photo() {
    if (busy || uploading || photoLock.current || !ready || conflict) return;
    photoLock.current = true; setUploading(true); setError('');
    const ownerRevision = getDeviceCacheRevision();
    try { const image = await pickAndUpload('product'); if (alive.current && ownerRevision === getDeviceCacheRevision() && image) change('cover', image.url); }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Cover upload failed.'); }
    finally { photoLock.current = false; if (alive.current) setUploading(false); }
  }
  async function save() {
    if (!alive.current || lock.current || uploading || !ready || conflict || !row || !form || !restored.ready) return;
    lock.current = true; setBusy(true); setError('');
    const ownerRevision = getDeviceCacheRevision();
    try {
      const data = tutorEditPayload(row, form, revision);
      await saved.persist({ form, revision });
      if (!alive.current || ownerRevision !== getDeviceCacheRevision()) return;
      try { await api(`/v1/agents/${material ? 'tutorial-resources' : 'tutorials'}/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify(data) }); }
      catch (caught) {
        const fresh = await api<{ resources: TutorListing[]; listings: TutorListing[] }>('/v1/agents/tutorials', { cache: 'reload' }).catch(() => null);
        if (!alive.current || ownerRevision !== getDeviceCacheRevision()) return;
        const current = (material ? fresh?.resources : fresh?.listings)?.find(item => item.id === row.id);
        if (!current || !tutorEditMatches(current, data)) {
          if (current && current.revision !== revision) setConflict(true);
          throw caught;
        }
      }
      if (!alive.current || ownerRevision !== getDeviceCacheRevision()) return;
      saved.discard(); await saved.persist(null).catch(() => undefined);
      if (!alive.current) return;
      toast(material ? 'Material updated' : 'Tutorial updated', 'success'); router.back();
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'Your changes could not be saved. Try again.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const editable = ready && !busy && !uploading && !conflict;
  const field = (key: keyof TutorEditForm) => ({ value: form?.[key] ?? '', onChangeText: (value: string) => change(key, value), editable });
  return <ToolPage title={material ? 'Edit material' : 'Edit tutorial'}>
    <DraftRecovery loading={restored.loading} error={restored.error} onRetry={restored.retry} />
    {loading && restored.ready ? <ScreenSkeleton variant="list" compact /> : null}
    {saved.warning ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{saved.warning}</Text> : null}
    {ready && form ? <View style={{ gap: 16 }}>
      {material ? <>
        {form.cover ? <MediaImage uri={form.cover} accessibilityLabel="Material cover photo" resizeMode="cover" style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 14 }} /> : null}
        <ToolButton secondary label={uploading ? 'Uploading cover…' : form.cover ? 'Change cover photo' : 'Add cover photo'} disabled={!editable} onPress={() => void photo()} />
        {form.cover ? <ToolButton secondary label="Remove cover photo" disabled={!editable} onPress={() => change('cover', '')} /> : null}
      </> : null}
      <ToolField label="Title" {...field('title')} maxLength={material ? 180 : 160} />
      <ToolField label="Description" {...field('description')} multiline maxLength={2000} />
      <ToolField label="Course code" {...field('courseCode')} autoCapitalize="characters" maxLength={24} />
      {material ? <>
        <ToolField label="Subject" {...field('subject')} maxLength={80} />
        <ChoiceField label="Access" value={form.access} disabled={!editable} onChange={value => change('access', value)} options={[
          { value: 'FREE', label: 'Free' }, { value: 'PAID', label: 'Paid' },
          ...(row?.access_model === 'BOOKING_INCLUDED' ? [{ value: 'BOOKING_INCLUDED', label: 'For booked students' }] : []),
        ]} />
      </> : <>
        <ChoiceField label="Format" value={form.format} disabled={!editable} onChange={value => change('format', value)} options={[{ value: 'IN_PERSON', label: 'In person' }, { value: 'ONLINE', label: 'Online' }, { value: 'HYBRID', label: 'Hybrid' }]} />
        <ToolField label="Capacity" {...field('capacity')} keyboardType="number-pad" />
        <ToolField label="Location" {...field('location')} maxLength={160} />
        <ToolField label="Cancellation cutoff (hours)" {...field('cutoff')} keyboardType="number-pad" />
      </>}
      {!material || form.access === 'PAID' ? <ToolField label="Price (₦)" {...field('price')} keyboardType="decimal-pad" /> : null}
      <ToolButton label={busy ? 'Saving…' : 'Save changes'} disabled={!editable} onPress={() => void save()} />
    </View> : null}
    {error ? <View style={{ gap: 10, marginVertical: 16 }}><Text accessibilityRole="alert" style={{ color: theme.error, fontFamily: theme.font.body }}>{error}</Text>
      {conflict ? <ToolButton secondary label="Reload latest details" disabled={busy || uploading} onPress={() => Alert.alert('Reload listing?', 'Replace your unsaved changes with the latest details?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reload', onPress: () => { draft.current = null; setRetry(value => value + 1); } }])} />
        : !ready && !loading ? <RetryIconButton label="Retry loading listing" onPress={() => setRetry(value => value + 1)} /> : null}
    </View> : null}
  </ToolPage>;
}
