import { useCallback,useState } from 'react';
import { useFocusEffect,router } from 'expo-router';
import { Pressable,Text,View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { currentExamPeriod,formatExamDate,type ExamPeriod as Exam } from "@/src/lib/exam-period";
export function AcademicExamStatus(){
 const {theme}=useAppearance(),[period,setPeriod]=useState<Exam|null>(null);
 useFocusEffect(useCallback(()=>{let live=true;void api<{examPeriods:Exam[]}>('/v1/calendar/exam-periods').then(data=>{if(live)setPeriod(currentExamPeriod(data.examPeriods));}).catch(()=>undefined);return()=>{live=false;};},[]));
 if(!period)return null;
 const date=formatExamDate;
 return <Pressable accessibilityRole="button" accessibilityLabel="View exam period countdown" onPress={()=>router.push('/exam-countdown')} style={{marginTop:10,marginBottom:10,padding:12,borderWidth:1,borderColor:theme.border,borderRadius:14,backgroundColor:theme.surfaceMuted,flexDirection:'row',gap:10,alignItems:'center',width:'100%'}}><Ionicons name="calendar-outline" size={21} color={theme.deepBrand}/><View style={{flex:1,minWidth:0,gap:3}}><Text numberOfLines={1} style={{fontSize:13,fontFamily:theme.font.semibold,color:theme.text}}>{period.status==='ongoing'?'Exam period is underway':'Exam period countdown'}</Text><Text numberOfLines={1} style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:11,lineHeight:16}}>{date(period.startsOn)} to {date(period.endsOn)}</Text></View><Ionicons name="chevron-forward" size={18} color={theme.textMuted}/></Pressable>;
}
