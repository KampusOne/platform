import { Text } from 'react-native';
import { useScreenSync } from '../lib/screen-read';
import { useAppearance } from '../lib/appearance';
export function SyncStatus({path}:{path:string}) {
  const status=useScreenSync(path),{theme}=useAppearance();
  if(!status?.stale)return null;
  return <Text accessibilityLiveRegion="polite" style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12,lineHeight:18,marginBottom:12}}>Saved copy · last synced {new Date(status.savedAt).toLocaleString('en-NG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}. Updates need a connection.</Text>;
}
