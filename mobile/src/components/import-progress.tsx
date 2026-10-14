import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import {Ionicons} from '@expo/vector-icons';
import { useAppearance } from "@/src/lib/appearance";
import { importProgress, type ImportStage } from "@/src/lib/import-progress";
import { useReducedMotionPreference } from './visual-system';
export function useImportProgress(){
  const [stage,setValue]=useState<ImportStage|null>(null);
  const previous=useRef<ImportStage>("selecting");
  const setStage=(value:ImportStage|null)=>{if(value&&value!=="failed")previous.current=value;setValue(value);};
  return {stage,setStage,failureStage:previous.current};
}
export type { ImportStage } from "@/src/lib/import-progress";

/** Report actual uploaded bytes. AI parsing has no measurable percentage and
 * intentionally uses an indeterminate indicator instead of a fake progress bar. */
export function ImportProgress({ stage, uploadFraction, subject = "document", filename, fileType, fileReceived, failureStage, error }: {
  stage: ImportStage;
  failureStage?: ImportStage;
  uploadFraction?: number;
  subject?: string;
  filename?: string | undefined;
  fileReceived?: boolean;
  fileType?: string | undefined;
  error?: string | undefined;
}) {
  const { theme } = useAppearance();
  const progress = importProgress(stage, subject, uploadFraction);
  const failureTitles: Partial<Record<ImportStage,string>>={selecting:"File selection failed",validating:"File checking failed",uploading:"Upload interrupted",uploaded:"File preparation failed",reading:"Document reading failed",analysing:"AI analysis did not finish",saving:"Changes could not be saved"};
  const {detail,percent,busy}=progress;
  const reducedMotion = useReducedMotionPreference();
  const movement = useRef(new Animated.Value(0)).current;
  const [barWidth, setBarWidth] = useState(240);
  useEffect(() => {
    movement.setValue(0);
    if (!busy || percent !== null || reducedMotion) return;
    const animation = Animated.loop(Animated.timing(movement, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [busy, percent, reducedMotion, movement]);
  const title=stage==="failed"?failureTitles[failureStage??"reading"]??progress.title:progress.title;
  return (
    <View accessibilityLabel={title}
      style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 16,
        backgroundColor: theme.surface, padding: 16, gap: 9, marginVertical: 12 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 }}>
          {title}
        </Text>
        {percent !== null?<Text accessible={false} style={{color:theme.text,fontFamily:theme.font.medium}}>{percent}%</Text>:null}
      </View>
      {filename ? <Text numberOfLines={2} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12 }}>{filename}{fileReceived ? " · Uploaded" : ""}{fileType ? ` · ${fileType}` : ""}</Text> : null}
      <View accessibilityRole="progressbar" accessibilityLabel={title}
          accessibilityState={{ busy }}
          accessibilityValue={percent !== null ? { min: 0, max: 100, now: percent } : { text: title }}
          onLayout={event => setBarWidth(event.nativeEvent.layout.width)}
          style={{ height: 6, borderRadius: 3, backgroundColor: theme.surfaceMuted, overflow: "hidden" }}>
          {busy && percent === null ? <Animated.View style={{ width: '28%', height: 6, borderRadius: 3, backgroundColor: theme.brand,
            transform: [{ translateX: reducedMotion ? barWidth * .36 : movement.interpolate({ inputRange: [0, 1], outputRange: [-barWidth * .28, barWidth] }) }] }} />
            : <View style={{ width: `${percent ?? (stage === 'review' || stage === 'completed' ? 100 : 0)}%` as `${number}%`, height: 6,
              borderRadius: 3, backgroundColor: stage === 'failed' ? theme.error : theme.brand }} />}
        </View>
      {percent === null ? <View accessibilityLabel={title} style={{flexDirection:'row',gap:10,flexWrap:'wrap'}}>
          {(['uploaded','reading','analysing','finishing'] as const).map((step,index)=>{
            const actual=stage==='failed'?failureStage:stage,steps=['uploaded','reading','analysing','finishing','review','saving','completed'];
            const position=steps.indexOf(actual??''),done=position>index,current=actual===step;
            return <View key={step} style={{flexDirection:'row',gap:4,alignItems:'center'}}><Ionicons name={done?'checkmark-circle':current?'ellipse':'ellipse-outline'} size={14} color={done||current?theme.deepBrand:theme.textMuted}/><Text style={{fontFamily:theme.font.body,fontSize:11,color:done||current?theme.deepBrand:theme.textMuted}}>{['Uploaded','Reading','Analysing','Finishing'][index]}</Text></View>;
          })}
        </View> : null}
      <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18 }}>
        {error || detail}
      </Text>
    </View>
  );
}
