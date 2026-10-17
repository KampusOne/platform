import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { api } from '@/src/lib/api';
import { ToolButton } from '@/src/components/toolkit';
import { KeyboardModal } from '@/src/components/keyboard-viewport';
import { LearningDocument } from '@/src/components/learning-document';
import { TutorialPlayer } from '@/src/components/tutorial-player';
import { ProfileAvatar } from '@/src/components/profile-avatar';
import { VerifiedBadge } from '@/src/components/verified-badge';
import { InlineLoading } from '@/src/components/skeleton';
import { useAppearance } from '@/src/lib/appearance';
import { learningTitle } from '@/src/lib/learning-title';

type Part = { mediaId: string; title: string };
type Resource = { id: string; title: string; description?: string; resource_type: string; can_access: boolean; access_model: string; media_object_id: string | null; course_code?: string; tutor_profile_id?: string; tutor_name?: string; publisher_name?: string; tutor_image_url?: string | null; tutor_verified?: boolean; parts?: Part[] };
function Audio({ url }: { url: string }) {
  const player = useAudioPlayer(url), status = useAudioPlayerStatus(player), { theme } = useAppearance();
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return <View style={{ padding: 24, gap: 20, backgroundColor: theme.surface, borderRadius: 18 }}>
    <Ionicons name="headset-outline" size={44} color={theme.deepBrand} />
    <Text style={{ color: theme.text, fontFamily: theme.font.medium }}>{time(status.currentTime)} / {time(status.duration)}</Text>
    <ToolButton label={status.playing ? 'Pause audio' : 'Play audio'} onPress={() => status.playing ? player.pause() : player.play()} />
    <View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1 }}><ToolButton secondary label="Back 15s" onPress={() => void player.seekTo(Math.max(0, status.currentTime - 15))} /></View><View style={{ flex: 1 }}><ToolButton secondary label="Forward 15s" onPress={() => void player.seekTo(Math.min(status.duration, status.currentTime + 15))} /></View></View>
  </View>;
}
export default function LearningViewer() {
  const { id } = useLocalSearchParams<{ id: string }>(), { theme } = useAppearance();
  const [resource, setResource] = useState<Resource | null>(null), [index, setIndex] = useState(0), [playback, setPlayback] = useState<{ url: string; kind: 'file' | 'embed' } | null>(null);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0), [contentsOpen, setContentsOpen] = useState(false);
  useEffect(() => { setResource(null); setIndex(0); setError(''); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void api<{ resource: Resource }>('/v1/student/tutorial-resources/' + id, { cache: 'no-store', signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setResource(result.resource); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'This material could not load.'); });
    return () => controller.abort();
  }, [id, revision]);
  const parts: Part[] = resource?.parts?.length ? resource.parts : resource?.media_object_id ? [{ mediaId: resource.media_object_id, title: resource.title }] : [];
  const part = parts[index], video = resource?.resource_type === 'VIDEO', audio = resource?.resource_type === 'AUDIOBOOK';
  const canAccess = resource?.can_access || resource?.access_model === 'FREE';
  const title = learningTitle(resource?.title, video ? 'Video lesson' : audio ? 'Audiobook' : 'Learning material'), partTitle = learningTitle(part?.title, parts.length > 1 ? `Lesson ${index + 1}` : title);
  useEffect(() => {
    const controller = new AbortController(); setPlayback(null); setError('');
    if (!resource || !canAccess) return () => controller.abort();
    if (!part?.mediaId) { setError('The file is unavailable. Reopen this material or contact the tutor.'); return () => controller.abort(); }
    void (async () => {
      const media = video ? await api<{ kind: 'file' | 'embed'; url?: string }>(`/v1/tutorial-storage/playback/${part.mediaId}`, { method: 'POST', signal: controller.signal }) : { kind: 'file' as const };
      const url = media.kind === 'embed' ? media.url : (await api<{ url: string }>(`/v1/media/${part.mediaId}/access`, { method: 'POST', signal: controller.signal })).url;
      if (!url || !/^https:\/\//.test(url)) throw new Error('This material is unavailable. Try again to refresh your access.');
      if (!controller.signal.aborted) setPlayback({ url, kind: media.kind });
    })().catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The file could not load.'); });
    return () => controller.abort();
  }, [part?.mediaId, canAccess, video, revision, resource?.id]);
  const back = () => router.canGoBack() ? router.back() : router.replace('/tutorials');
  const selectPart = (next: number) => { setPlayback(null); setError(''); setIndex(next); setContentsOpen(false); };
  const tutorName = resource?.tutor_name || resource?.publisher_name || 'KampusOne tutor';
  const partRow = (item: Part, n: number) => <Pressable accessibilityRole="button" accessibilityLabel={`Open lesson ${n + 1}: ${learningTitle(item.title, `Lesson ${n + 1}`)}`} accessibilityState={{ selected: index === n }} onPress={() => selectPart(n)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: index === n ? theme.deepBrand : theme.border, backgroundColor: index === n ? theme.surfaceTint : theme.surface, opacity: pressed ? 0.7 : 1 })}>
    <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.surfaceTint, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={index === n && video ? 'play' : 'document-text-outline'} size={18} color={theme.deepBrand} /></View>
    <View style={{ flex: 1, gap: 5 }}><Text style={{ color: theme.textMuted, fontSize: 11, fontFamily: theme.font.medium }}>Lesson {n + 1}</Text><Text style={{ color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 }}>{learningTitle(item.title, `Lesson ${n + 1}`)}</Text></View>
    {index === n ? <Ionicons name="checkmark-circle" size={20} color={theme.deepBrand} /> : <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />}
  </Pressable>;
  const state = error ? <View style={{ gap: 16, padding: 24, alignItems: 'center' }}><Ionicons name="cloud-offline-outline" size={32} color={theme.deepBrand} /><Text accessibilityRole="alert" style={{ color: theme.textMuted, fontFamily: theme.font.body, lineHeight: 22, textAlign: 'center' }}>{error}</Text><ToolButton secondary label="Try again" onPress={() => setRevision(n => n + 1)} /></View> : !resource || canAccess && !playback ? <View accessibilityLabel="Opening learning material" style={{ alignItems: 'center', gap: 14, padding: 28 }}><InlineLoading /><Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>Opening your {video ? 'video' : audio ? 'audio' : 'document'}…</Text></View> : !canAccess ? <View style={{ padding: 24, gap: 16 }}><Text style={{ color: theme.text, fontFamily: theme.font.body }}>Get access to open this material and its lesson files.</Text><ToolButton label="Get access" onPress={() => router.push({ pathname: '/learning-checkout', params: { resourceId: id } })} /></View> : null;
  return <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.canvas }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={back} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="arrow-back" size={24} color={theme.text} /></Pressable>
      <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 19 }}>{title}</Text>{resource?.course_code ? <Text numberOfLines={1} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 }}>{resource.course_code} · {video ? 'Video lesson' : audio ? 'Audiobook' : 'Document'}</Text> : null}</View>
      {parts.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`Open contents, ${parts.length} lessons`} onPress={() => setContentsOpen(true)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="list-outline" size={23} color={theme.deepBrand} /></Pressable> : null}
    </View>
    {!video && !audio ? <View style={{ flex: 1 }}>
      {parts.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Choose document part" onPress={() => setContentsOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, minHeight: 44, backgroundColor: theme.surfaceTint }}><Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontFamily: theme.font.medium, fontSize: 12 }}>{index + 1} of {parts.length} · {partTitle}</Text><Ionicons name="chevron-down" size={16} color={theme.deepBrand} /></Pressable> : null}
      {state ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{state}</View> : playback ? <LearningDocument key={part?.mediaId} url={playback.url} title={partTitle} onRefresh={()=>setRevision(n=>n+1)} /> : null}
    </View> : <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      {video ? <View accessibilityLabel="Lesson video player" style={{ aspectRatio: 16 / 9, backgroundColor: playback && !state ? '#14110f' : theme.surfaceTint, minHeight: 210 }}>{playback && !state ? <TutorialPlayer key={part?.mediaId} {...playback} label={partTitle} /> : state}</View> : playback && !state ? <View style={{ padding: 18 }}><Audio key={part?.mediaId} url={playback.url} /></View> : state}
      <View style={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 7 }}><Text style={{ color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 12 }}>{parts.length > 1 ? `Lesson ${index + 1} of ${parts.length}` : video ? 'Your video lesson' : 'Your audiobook'}</Text><Text style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 24, lineHeight: 31 }}>{partTitle}</Text></View>
        {resource ? <Pressable disabled={!resource.tutor_profile_id} accessibilityRole="button" accessibilityLabel={`View tutor ${tutorName}`} onPress={() => resource.tutor_profile_id && router.push({ pathname: '/student-service', params: { id: resource.tutor_profile_id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}><ProfileAvatar name={tutorName} imageUrl={resource.tutor_image_url} size={42} /><View style={{ flex: 1, gap: 4 }}><Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11 }}>Your tutor</Text><View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}><Text style={{ color: theme.text, fontFamily: theme.font.semibold, flexShrink: 1 }}>{tutorName}</Text>{resource.tutor_verified === true ? <VerifiedBadge label="Verified tutor" size={14} /> : null}</View></View>{resource.tutor_profile_id ? <Ionicons name="chevron-forward" color={theme.textMuted} size={18} /> : null}</Pressable> : null}
        {resource?.description ? <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 22 }}>{resource.description}</Text> : null}
        {parts.length > 1 ? <View style={{ gap: 12, paddingTop: 8 }}><Text style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 20 }}>Course contents</Text>{parts.map((item, n) => <View key={item.mediaId}>{partRow(item, n)}</View>)}</View> : null}
      </View>
    </ScrollView>}
    <KeyboardModal visible={contentsOpen} transparent animationType="slide" onRequestClose={() => setContentsOpen(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.35)' }}><SafeAreaView edges={['bottom']} style={{ maxHeight: '75%', backgroundColor: theme.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 14 }}><View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ flex: 1, color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 22 }}>Contents</Text><Pressable accessibilityRole="button" accessibilityLabel="Close contents" onPress={() => setContentsOpen(false)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={24} color={theme.text} /></Pressable></View><FlatList data={parts} keyExtractor={item => item.mediaId} contentContainerStyle={{ gap: 10 }} renderItem={({ item, index: n }) => partRow(item, n)} /></SafeAreaView></View></KeyboardModal>
  </SafeAreaView>;
}
