import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/src/lib/api";
import { useAppearance } from "@/src/lib/appearance";
import { activeHashtag } from "@/src/lib/post-rich-text";

export function HashtagSuggestions({ text, cursor, onSelect }: { text: string; cursor: number; onSelect(next: string): void }) {
  const { theme } = useAppearance();
  const active = activeHashtag(text, cursor);
  const query = active?.query;
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  useEffect(() => {
    setTags([]);
    if (query === undefined) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api<{ hashtags: { tag: string; count: number }[] }>(`/v1/student/feed/hashtags?q=${encodeURIComponent(query)}`, { signal: abort.signal }).then((result) => { if (!abort.signal.aborted) setTags(result.hashtags); }).catch(() => {});
    }, 220);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query]);
  if (!active) return null;
  const options = tags.map((item) => item.tag);
  if (active.query && !options.some((tag) => tag.toLocaleLowerCase() === active.query.toLocaleLowerCase())) options.unshift(active.query);
  if (!options.length) return null;
  return <View style={{ gap: 3, borderTopWidth: 1, borderColor: theme.border, marginBottom: 14 }}>
    {options.slice(0, 5).map((tag) => <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Add hashtag ${tag}`} onPress={() => onSelect(`${text.slice(0, active.start)}#${tag} ${text.slice(active.end)}`)} style={{ minHeight: 42, justifyContent: "center", paddingHorizontal: 10 }}><Text style={{ color: theme.accentText, fontFamily: theme.font.semibold }}>#{tag} <Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:11}}>{tags.find(item=>item.tag===tag)?.count??0} posts</Text></Text></Pressable>)}
  </View>;
}
