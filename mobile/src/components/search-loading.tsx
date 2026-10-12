import { Text, View } from 'react-native';
import { useAppearance } from '../lib/appearance';
import { FeedSkeleton, ListSkeleton, SkeletonBlock } from './skeleton';
/** Preserve result geometry throughout debounce and fetch; static by design on lower-end phones. */
export function SearchLoading({ label, shape = 'list', hasResults = false }: { label: string; shape?: 'products' | 'posts' | 'list'; hasResults?: boolean }) {
  const { theme } = useAppearance();
  return <View accessibilityState={{busy:true}} style={{gap:12,paddingVertical:12}}>
    <Text accessibilityLiveRegion="polite" style={{fontFamily:theme.font.medium,color:theme.textMuted,fontSize:13}}>{hasResults ? 'Updating results…' : label}</Text>
    {shape === 'posts' ? <FeedSkeleton count={hasResults?1:2}/> : shape === 'products' ? <View style={{flexDirection:'row',gap:12}}>{[0,1].map(i=><View key={i} style={{flex:1,gap:10}}><SkeletonBlock height="auto" radius={12} style={{aspectRatio:1}}/><SkeletonBlock width="82%"/><SkeletonBlock width="50%" height={18}/></View>)}</View> : <ListSkeleton count={hasResults?1:3}/>}
  </View>;
}
