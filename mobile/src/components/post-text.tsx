import { useState } from "react";
import { Linking, Pressable, Text, View, type TextStyle, type StyleProp } from "react-native";
import { router } from "expo-router";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { postExcerpt, postTokens } from "@/src/lib/post-rich-text";

export function RichPostText({ text, style, onError }: { text: string; style?: StyleProp<TextStyle>; onError?(message: string): void }) {
  const { theme } = useAppearance();
  return <Text style={style}>{postTokens(text).map((token, index) => token.kind === "text" ? token.text : <Text
    key={index} accessibilityRole="link" style={{ color: theme.accentText, fontFamily: theme.font.semibold }}
    onPress={(event) => {
      event.stopPropagation();
      if (token.kind === "hashtag") router.push({ pathname: "/(tabs)/feed", params: { hashtag: token.target } });
      else if(token.kind === "mention") void api<{id:string}>(`/v1/people/by-username/${encodeURIComponent(token.text.slice(1))}`).then(person=>router.push({pathname:'/student-profile',params:{id:person.id}})).catch(()=>onError?.('This profile could not be opened. Try again when you are online.'));
      else void Linking.openURL(token.target!).catch(() => onError?.("This link could not be opened. Please try again."));
    }}
  >{token.text}</Text>)}</Text>;
}

export function PostText({ title, paragraphs, detail = false, style, titleStyle, onError }: {
  title: string; paragraphs: string[]; detail?: boolean; style?: StyleProp<TextStyle>; titleStyle?: StyleProp<TextStyle>; onError?(message: string): void;
}) {
  const { theme } = useAppearance();
  const [expanded, setExpanded] = useState(false);
  const whole = [title, ...paragraphs].filter(Boolean).join("\n\n");
  const excerpt = postExcerpt(whole);
  const collapsed = !detail && !expanded && excerpt.collapsed;
  return <View style={{ gap: 4 }}>
    {collapsed ? <RichPostText text={excerpt.text} style={style} {...(onError ? { onError } : {})} /> : <>
      {title ? <RichPostText text={title} style={titleStyle ?? style} {...(onError ? { onError } : {})} /> : null}
      {paragraphs.map((paragraph, index) => <RichPostText key={index} text={paragraph} style={style} {...(onError ? { onError } : {})} />)}
    </>}
    {!detail && excerpt.collapsed ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} style={{ minHeight: 32, justifyContent: "center", alignSelf: "flex-start" }}><Text style={{ color: theme.accentText, fontFamily: theme.font.semibold, fontSize: 13 }}>{expanded ? "See less" : "See more"}</Text></Pressable> : null}
  </View>;
}
